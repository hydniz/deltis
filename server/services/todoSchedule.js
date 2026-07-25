// Due-todo engine: which todos are due on which days of a range, and whether
// they are done. Mirrors services/habitSchedule.js (same schedule modes and
// trigger kinds) and adds `todo` as a trigger source, so a todo can be due
// N days after another todo is completed.
const Todo = require('../models/Todo');
const TodoCompletion = require('../models/TodoCompletion');
const HabitLog = require('../models/HabitLog');
const ActivityLog = require('../models/ActivityLog');
const StravaActivity = require('../models/StravaActivity');
const HabitPlan = require('../models/HabitPlan');
const ActivityPlan = require('../models/ActivityPlan');
const TrainingPlan = require('../models/TrainingPlan');
const HabitDefinition = require('../models/HabitDefinition');
const ActivityType = require('../models/ActivityType');
const TrainingType = require('../models/TrainingType');

const MAX_OFFSET_DAYS = 30;
const MAX_RANGE_DAYS = 62;
const DAY_MS = 24 * 60 * 60 * 1000;

const dayKey = (date) => new Date(date).toISOString().slice(0, 10);
const shiftDay = (dayStr, days) =>
  dayKey(new Date(new Date(`${dayStr}T00:00:00.000Z`).getTime() + days * DAY_MS));
const weekdayOf = (dayStr) => new Date(`${dayStr}T00:00:00.000Z`).getUTCDay();
const daysBetween = (fromStr, toStr) =>
  Math.round((new Date(`${toStr}T00:00:00.000Z`) - new Date(`${fromStr}T00:00:00.000Z`)) / DAY_MS);

function daysInRange(startStr, endStr) {
  const days = [];
  for (let d = startStr; d <= endStr; d = shiftDay(d, 1)) {
    days.push(d);
    if (days.length > MAX_RANGE_DAYS) break;
  }
  return days;
}

function daySetBy(docs, pick) {
  const map = new Map();
  for (const doc of docs) {
    const key = dayKey(pick(doc));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(doc);
  }
  return map;
}

// The schedule reason for a todo on a day, or null when it is not due.
function reasonFor(todo, dayStr, triggerMatchesDay) {
  switch (todo.scheduleMode) {
    case 'once':
      return todo.dueDate === dayStr ? { kind: 'once', date: todo.dueDate } : null;
    case 'daily':
      return { kind: 'daily' };
    case 'weekly':
      return (todo.scheduleDays || []).includes(weekdayOf(dayStr)) ? { kind: 'weekly', days: todo.scheduleDays } : null;
    case 'interval': {
      const n = todo.scheduleIntervalDays;
      const anchor = todo.scheduleAnchorDate;
      return n && anchor && dayStr >= anchor && daysBetween(anchor, dayStr) % n === 0
        ? { kind: 'interval', intervalDays: n, anchorDate: anchor } : null;
    }
    case 'trigger': {
      const t = todo.scheduleTrigger;
      if (!t) return null;
      const offset = Math.min(Math.abs(t.offsetDays || 0), MAX_OFFSET_DAYS);
      const sourceDay = t.direction === 'before' ? shiftDay(dayStr, offset) : shiftDay(dayStr, -offset);
      return triggerMatchesDay(t, sourceDay)
        ? { kind: 'trigger', direction: t.direction, offsetDays: offset, sourceKind: t.kind, sourceDay }
        : null;
    }
    default:
      return null;
  }
}

async function dueTodosForRange(userId, startStr, endStr) {
  const days = daysInRange(startStr, endStr);
  if (days.length === 0) return [];

  const todos = await Todo.find({ userId, deletedAt: null }).lean();
  if (todos.length === 0) return [];

  const triggers = todos.map(t => t.scheduleTrigger).filter(Boolean);
  const maxAfter = Math.min(MAX_OFFSET_DAYS,
    Math.max(0, ...triggers.filter(t => t.direction === 'after').map(t => t.offsetDays || 0)));
  const maxBefore = Math.min(MAX_OFFSET_DAYS,
    Math.max(0, ...triggers.filter(t => t.direction === 'before').map(t => t.offsetDays || 0)));

  const histStart = new Date(`${shiftDay(startStr, -maxAfter - 1)}T00:00:00.000Z`);
  const histEnd = new Date(`${endStr}T23:59:59.999Z`);
  const planStart = new Date(`${startStr}T00:00:00.000Z`);
  const planEnd = new Date(`${shiftDay(endStr, maxBefore)}T23:59:59.999Z`);

  const needs = (kind, dir) => triggers.some(t => t.kind === kind && (!dir || t.direction === dir));

  const [completions, habitLogs, activityLogs, stravaActivities, todoComps, habitPlans, activityPlans, trainingPlans, habitDefs, activityTypes, trainingTypes] = await Promise.all([
    TodoCompletion.find({ userId, date: { $gte: new Date(`${startStr}T00:00:00.000Z`), $lte: histEnd } }).select('todoId date').lean(),
    needs('habit', 'after') ? HabitLog.find({ userId, date: { $gte: histStart, $lte: histEnd } }).select('habitId date').lean() : [],
    needs('activityType', 'after') ? ActivityLog.find({ userId, date: { $gte: histStart, $lte: histEnd } }).select('activityTypeRef date').lean() : [],
    needs('stravaSport') ? StravaActivity.find({ userId, startDate: { $gte: new Date(histStart.getTime() - DAY_MS), $lte: new Date(histEnd.getTime() + DAY_MS) } }).select('sportType startDate startDateLocal').lean() : [],
    needs('todo', 'after') ? TodoCompletion.find({ userId, date: { $gte: histStart, $lte: histEnd } }).select('todoId date').lean() : [],
    needs('habit', 'before') ? HabitPlan.find({ userId, scheduledDate: { $gte: planStart, $lte: planEnd } }).select('habitId scheduledDate').lean() : [],
    needs('activityType', 'before') ? ActivityPlan.find({ userId, scheduledDate: { $gte: planStart, $lte: planEnd } }).select('activityTypeRef scheduledDate').lean() : [],
    needs('trainingType') ? TrainingPlan.find({ userId, scheduledDate: { $gte: planStart, $lte: planEnd } }).select('trainingTypeId scheduledDate').lean() : [],
    HabitDefinition.find({ $or: [{ userId }, { userId: null }] }).select('name').lean(),
    ActivityType.find({ userId }).select('label').lean(),
    TrainingType.find({ userId }).select('name').lean(),
  ]);

  const doneByTodoDay = new Set(completions.map(c => `${c.todoId}|${dayKey(c.date)}`));
  const compByTodoDay = new Map(completions.map(c => [`${c.todoId}|${dayKey(c.date)}`, c]));

  const habitLogsByDay = daySetBy(habitLogs, l => l.date);
  const activityLogsByDay = daySetBy(activityLogs, l => l.date);
  const stravaByDay = daySetBy(stravaActivities, a => a.startDateLocal || a.startDate);
  const todoCompsByDay = daySetBy(todoComps, c => c.date);
  const habitPlansByDay = daySetBy(habitPlans, p => p.scheduledDate);
  const activityPlansByDay = daySetBy(activityPlans, p => p.scheduledDate);
  const trainingPlansByDay = daySetBy(trainingPlans, p => p.scheduledDate);

  const habitNameById = new Map(habitDefs.map(d => [String(d._id), d.name]));
  const activityTypeNameById = new Map(activityTypes.map(t => [String(t._id), t.label]));
  const trainingTypeNameById = new Map(trainingTypes.map(t => [String(t._id), t.name]));
  const todoTitleById = new Map(todos.map(t => [String(t._id), t.title]));

  function triggerSourceName(t) {
    if (t.kind === 'stravaSport') return t.sport;
    if (t.kind === 'habit') return habitNameById.get(String(t.refId)) || 'Gewohnheit';
    if (t.kind === 'activityType') return activityTypeNameById.get(String(t.refId)) || 'Aktivität';
    if (t.kind === 'trainingType') return trainingTypeNameById.get(String(t.refId)) || 'Training';
    if (t.kind === 'todo') return todoTitleById.get(String(t.refId)) || 'Aufgabe';
    return '?';
  }

  function triggerMatchesDay(t, dayStr) {
    if (t.direction === 'after') {
      if (t.kind === 'habit') return (habitLogsByDay.get(dayStr) || []).some(l => String(l.habitId) === String(t.refId));
      if (t.kind === 'activityType') return (activityLogsByDay.get(dayStr) || []).some(l => String(l.activityTypeRef) === String(t.refId));
      if (t.kind === 'stravaSport') return (stravaByDay.get(dayStr) || []).some(a => (a.sportType || '').toLowerCase() === String(t.sport || '').toLowerCase());
      if (t.kind === 'trainingType') return (trainingPlansByDay.get(dayStr) || []).some(p => String(p.trainingTypeId) === String(t.refId));
      if (t.kind === 'todo') return (todoCompsByDay.get(dayStr) || []).some(c => String(c.todoId) === String(t.refId));
      return false;
    }
    if (t.kind === 'habit') return (habitPlansByDay.get(dayStr) || []).some(p => String(p.habitId) === String(t.refId));
    if (t.kind === 'activityType') return (activityPlansByDay.get(dayStr) || []).some(p => String(p.activityTypeRef) === String(t.refId));
    if (t.kind === 'trainingType') return (trainingPlansByDay.get(dayStr) || []).some(p => String(p.trainingTypeId) === String(t.refId));
    return false;
  }

  const results = [];
  for (const todo of todos) {
    for (const dayStr of days) {
      const reason = reasonFor(todo, dayStr, triggerMatchesDay);
      if (!reason) continue;
      if (reason.kind === 'trigger') reason.sourceName = triggerSourceName(todo.scheduleTrigger);
      const done = doneByTodoDay.has(`${todo._id}|${dayStr}`);
      results.push({
        date: dayStr,
        todoId: String(todo._id),
        title: todo.title,
        notes: todo.notes,
        priority: todo.priority,
        scheduleMode: todo.scheduleMode,
        reminderTime: todo.reminderTime,
        done,
        completedAt: done ? compByTodoDay.get(`${todo._id}|${dayStr}`).date : null,
        reason,
      });
    }
  }
  return results;
}

module.exports = { dueTodosForRange, MAX_OFFSET_DAYS, MAX_RANGE_DAYS };
