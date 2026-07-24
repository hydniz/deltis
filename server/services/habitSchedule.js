// Due-habit engine: computes which SELECTED habits are due on which calendar
// days of a range — and WHY. The planner shows these implicit entries next to
// the explicitly planned ones, and the reason powers the "Warum steht das
// hier?" provenance display.
//
// Schedule modes (per-user, in UserHabitSettings.habitSettings[habitId]):
//   daily     – due every day (default)
//   weekly    – due on scheduleDays (JS getDay values, 0 = Sunday)
//   date      – due only on scheduleDate (one-off)
//   interval  – due every scheduleIntervalDays days, counted from
//               scheduleAnchorDate ("alle 3 Tage ab 14.07.")
//   trigger   – due relative to another event XY:
//               direction 'after':  N days after XY HAPPENED (habit log,
//                 activity log or synced Strava activity of that sport)
//               direction 'before': N days before XY is PLANNED in the
//                 planner (habit plan, activity plan or training plan of
//                 that training type)
const mongoose = require('mongoose');
const HabitDefinition = require('../models/HabitDefinition');
const UserHabitSettings = require('../models/UserHabitSettings');
const HabitLog = require('../models/HabitLog');
const ActivityLog = require('../models/ActivityLog');
const StravaActivity = require('../models/StravaActivity');
const HabitPlan = require('../models/HabitPlan');
const ActivityPlan = require('../models/ActivityPlan');
const TrainingPlan = require('../models/TrainingPlan');
const ActivityType = require('../models/ActivityType');
const TrainingType = require('../models/TrainingType');
const MetricDefinition = require('../models/MetricDefinition');
const MetricLog = require('../models/MetricLog');
const metricAggregate = require('../services/metricAggregate');
const trainingCriteria = require('../services/trainingCriteria');

const MAX_OFFSET_DAYS = 30;
const MAX_RANGE_DAYS = 62;

const DAY_MS = 24 * 60 * 60 * 1000;
const dayKey = (date) => new Date(date).toISOString().slice(0, 10);
const shiftDay = (dayStr, days) =>
  dayKey(new Date(new Date(`${dayStr}T00:00:00.000Z`).getTime() + days * DAY_MS));
const weekdayOf = (dayStr) => new Date(`${dayStr}T00:00:00.000Z`).getUTCDay();
const daysBetween = (fromStr, toStr) =>
  Math.round((new Date(`${toStr}T00:00:00.000Z`) - new Date(`${fromStr}T00:00:00.000Z`)) / DAY_MS);

// Normalized per-habit schedule view from the raw settings blob. Legacy
// settings without an explicit mode derive it from the fields that exist.
function scheduleOf(raw = {}) {
  const mode = ['daily', 'weekly', 'date', 'interval', 'trigger'].includes(raw.scheduleMode)
    ? raw.scheduleMode
    : raw.scheduleDate ? 'date'
    : Array.isArray(raw.scheduleDays) && raw.scheduleDays.length ? 'weekly'
    : 'daily';
  return {
    mode,
    days: Array.isArray(raw.scheduleDays) ? raw.scheduleDays : [],
    date: raw.scheduleDate || null,
    intervalDays: Number.isInteger(raw.scheduleIntervalDays) ? raw.scheduleIntervalDays : null,
    anchorDate: raw.scheduleAnchorDate || null,
    trigger: raw.scheduleTrigger || null,
  };
}

// Collects every day in [start, end] as 'YYYY-MM-DD'.
function daysInRange(startStr, endStr) {
  const days = [];
  for (let d = startStr; d <= endStr; d = shiftDay(d, 1)) {
    days.push(d);
    if (days.length > MAX_RANGE_DAYS) break;
  }
  return days;
}

// Does a logged value satisfy the habit's daily completion target?
// 'none' = any log counts (boolean habits and habits without a target).
function meetsDailyTarget(condition, target, value) {
  if (condition === 'min') return value >= target;
  if (condition === 'max') return value <= target;
  if (condition === 'exact') return value === target;
  return true;
}

// Groups documents into sets of day keys, applying `pick` to get the date.
function daySetBy(docs, pick, match) {
  const map = new Map();
  for (const doc of docs) {
    if (match && !match(doc)) continue;
    const key = dayKey(pick(doc));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(doc);
  }
  return map;
}

// Normalizes a per-habit auto-fill binding. `metric` pulls the day value of a
// MetricDefinition; `activity` counts/sums matching Strava/Health activities.
function normalizeAutoSource(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind === 'metric' && raw.metricId) {
    return { kind: 'metric', metricId: String(raw.metricId) };
  }
  if (raw.kind === 'activity' && raw.criteria && typeof raw.criteria === 'object') {
    const metric = ['count', 'distance', 'duration'].includes(raw.metric) ? raw.metric : 'count';
    return { kind: 'activity', criteria: raw.criteria, metric };
  }
  return null;
}

// Derives auto-fill values for every auto-bound habit across the visible days.
// Metric habits read MetricLog (collapsed per day by the metric's aggregation);
// activity habits read matching activities via the training-criteria registry.
async function computeAutoValues(userId, habits, days) {
  const out = new Map(); // `habitId|day` -> value
  if (days.length === 0) return out;
  const rangeStart = new Date(`${days[0]}T00:00:00.000Z`);
  const rangeEnd = new Date(`${days[days.length - 1]}T23:59:59.999Z`);

  // --- metric-bound habits ---
  const metricHabits = habits.filter(h => h.autoSource?.kind === 'metric');
  if (metricHabits.length) {
    const metricIds = [...new Set(metricHabits.map(h => h.autoSource.metricId))];
    const [defs, logs] = await Promise.all([
      MetricDefinition.find({ userId, _id: { $in: metricIds } }).select('dayAggregation').lean(),
      MetricLog.find({ userId, metricId: { $in: metricIds }, date: { $gte: rangeStart, $lte: rangeEnd } })
        .select('metricId date value').lean(),
    ]);
    const dayAggById = new Map(defs.map(d => [String(d._id), d.dayAggregation || 'last']));
    const byMetricDay = new Map(); // `metricId|day` -> [values]
    for (const log of logs) {
      const key = `${log.metricId}|${dayKey(log.date)}`;
      if (!byMetricDay.has(key)) byMetricDay.set(key, []);
      byMetricDay.get(key).push(log.value);
    }
    for (const h of metricHabits) {
      const mode = dayAggById.get(h.autoSource.metricId) || 'last';
      for (const day of days) {
        const values = byMetricDay.get(`${h.autoSource.metricId}|${day}`);
        if (values) out.set(`${h.def._id}|${day}`, metricAggregate.reduce(values, mode));
      }
    }
  }

  // --- activity-bound habits ---
  const activityHabits = habits.filter(h => h.autoSource?.kind === 'activity');
  for (const h of activityHabits) {
    const matches = await trainingCriteria.findMatches(userId, h.autoSource.criteria, rangeStart, rangeEnd)
      .catch(() => []);
    const perDay = new Map(); // day -> { count, distance(km), duration(min) }
    for (const m of matches) {
      const day = dayKey(m.date);
      if (!perDay.has(day)) perDay.set(day, { count: 0, distance: 0, duration: 0 });
      const acc = perDay.get(day);
      acc.count += 1;
      acc.distance += (m.distance || 0) / 1000;
      acc.duration += (m.movingTime || 0) / 60;
    }
    for (const [day, acc] of perDay) {
      const value = Math.round(acc[h.autoSource.metric] * 100) / 100;
      out.set(`${h.def._id}|${day}`, value);
    }
  }

  return out;
}

// The source label for an auto-filled entry ('metric' | 'activity').
function autoSourceKindOf(habits, habitId) {
  const h = habits.find(x => String(x.def._id) === String(habitId));
  return h?.autoSource?.kind || null;
}

async function dueHabitsForRange(userId, startStr, endStr) {
  const days = daysInRange(startStr, endStr);
  if (days.length === 0) return [];

  const [definitions, settings] = await Promise.all([
    HabitDefinition.find({
      $or: [{ userId }, { userId: null }],
      deletedAt: null,
    }).lean(),
    UserHabitSettings.findOne({ userId }).lean(),
  ]);
  const selectedIds = new Set((settings?.selectedHabitIds || []).map(String));
  const habitSettings = settings?.habitSettings || {};

  const habits = definitions
    .filter(d => selectedIds.has(String(d._id)))
    .map(d => ({
      def: d,
      schedule: scheduleOf(habitSettings[String(d._id)]),
      autoSource: normalizeAutoSource(habitSettings[String(d._id)]?.autoSource),
    }));
  if (habits.length === 0) return [];

  // Auto-fill: habits bound to a metric or to matching activities get their
  // daily value derived from that source instead of a manual log. Map keyed
  // `habitId|day` → number.
  const autoValues = await computeAutoValues(userId, habits, days);

  // Source data window: 'after' triggers look back, 'before' triggers look
  // ahead — clamp per config, never beyond MAX_OFFSET_DAYS.
  const triggers = habits.map(h => h.schedule.trigger).filter(Boolean);
  const maxAfter = Math.min(MAX_OFFSET_DAYS,
    Math.max(0, ...triggers.filter(t => t.direction === 'after').map(t => t.offsetDays || 0)));
  const maxBefore = Math.min(MAX_OFFSET_DAYS,
    Math.max(0, ...triggers.filter(t => t.direction === 'before').map(t => t.offsetDays || 0)));

  const histStart = new Date(`${shiftDay(startStr, -maxAfter - 1)}T00:00:00.000Z`);
  const histEnd = new Date(`${endStr}T23:59:59.999Z`);
  const planStart = new Date(`${startStr}T00:00:00.000Z`);
  const planEnd = new Date(`${shiftDay(endStr, maxBefore)}T23:59:59.999Z`);

  const needsActivityLogs = triggers.some(t => t.kind === 'activityType' && t.direction === 'after');
  const needsStrava = triggers.some(t => t.kind === 'stravaSport');
  const needsHabitPlans = triggers.some(t => t.kind === 'habit' && t.direction === 'before');
  const needsActivityPlans = triggers.some(t => t.kind === 'activityType' && t.direction === 'before');
  const needsTrainingPlans = triggers.some(t => t.kind === 'trainingType');

  const [habitLogs, activityLogs, stravaActivities, habitPlans, activityPlans, trainingPlans, activityTypes, trainingTypes] = await Promise.all([
    HabitLog.find({ userId, date: { $gte: histStart, $lte: histEnd } }).select('habitId date value').lean(),
    needsActivityLogs
      ? ActivityLog.find({ userId, date: { $gte: histStart, $lte: histEnd } }).select('activityTypeRef activityType date').lean()
      : [],
    needsStrava
      ? StravaActivity.find({ userId, startDate: { $gte: new Date(histStart.getTime() - DAY_MS), $lte: new Date(histEnd.getTime() + DAY_MS) } })
          .select('sportType startDate startDateLocal').lean()
      : [],
    needsHabitPlans
      ? HabitPlan.find({ userId, scheduledDate: { $gte: planStart, $lte: planEnd } }).select('habitId scheduledDate').lean()
      : [],
    needsActivityPlans
      ? ActivityPlan.find({ userId, scheduledDate: { $gte: planStart, $lte: planEnd } }).select('activityTypeRef activityType scheduledDate').lean()
      : [],
    needsTrainingPlans
      ? TrainingPlan.find({ userId, scheduledDate: { $gte: planStart, $lte: planEnd } }).select('trainingTypeId scheduledDate').lean()
      : [],
    ActivityType.find({ userId }).select('label').lean(),
    TrainingType.find({ userId }).select('name').lean(),
  ]);

  // Logged state for the visible range ("already ticked off today").
  const logsByHabitDay = new Map();
  for (const log of habitLogs) {
    logsByHabitDay.set(`${log.habitId}|${dayKey(log.date)}`, log);
  }

  const habitNameById = new Map(definitions.map(d => [String(d._id), d.name]));
  const activityTypeNameById = new Map(activityTypes.map(t => [String(t._id), t.label]));
  const trainingTypeNameById = new Map(trainingTypes.map(t => [String(t._id), t.name]));

  const stravaByDay = daySetBy(stravaActivities, a => a.startDateLocal || a.startDate);
  const habitPlansByDay = daySetBy(habitPlans, p => p.scheduledDate);
  const activityPlansByDay = daySetBy(activityPlans, p => p.scheduledDate);
  const trainingPlansByDay = daySetBy(trainingPlans, p => p.scheduledDate);
  const activityLogsByDay = daySetBy(activityLogs, l => l.date);
  const habitLogsByDay = daySetBy(habitLogs, l => l.date);

  // Human-readable source name for a trigger.
  function triggerSourceName(trigger) {
    if (trigger.kind === 'stravaSport') return trigger.sport;
    if (trigger.kind === 'habit') return habitNameById.get(String(trigger.refId)) || 'Gewohnheit';
    if (trigger.kind === 'activityType') return activityTypeNameById.get(String(trigger.refId)) || 'Aktivität';
    if (trigger.kind === 'trainingType') return trainingTypeNameById.get(String(trigger.refId)) || 'Training';
    return '?';
  }

  // Did XY happen / is XY planned on the given day?
  function triggerMatchesDay(trigger, dayStr) {
    if (trigger.direction === 'after') {
      if (trigger.kind === 'habit') {
        return (habitLogsByDay.get(dayStr) || []).some(l => String(l.habitId) === String(trigger.refId));
      }
      if (trigger.kind === 'activityType') {
        return (activityLogsByDay.get(dayStr) || []).some(l => String(l.activityTypeRef) === String(trigger.refId));
      }
      if (trigger.kind === 'stravaSport') {
        return (stravaByDay.get(dayStr) || []).some(a =>
          (a.sportType || '').toLowerCase() === String(trigger.sport || '').toLowerCase());
      }
      if (trigger.kind === 'trainingType') {
        return (trainingPlansByDay.get(dayStr) || []).some(p => String(p.trainingTypeId) === String(trigger.refId));
      }
      return false;
    }
    // 'before': XY must be PLANNED on that day
    if (trigger.kind === 'habit') {
      return (habitPlansByDay.get(dayStr) || []).some(p => String(p.habitId) === String(trigger.refId));
    }
    if (trigger.kind === 'activityType') {
      return (activityPlansByDay.get(dayStr) || []).some(p => String(p.activityTypeRef) === String(trigger.refId));
    }
    if (trigger.kind === 'trainingType') {
      return (trainingPlansByDay.get(dayStr) || []).some(p => String(p.trainingTypeId) === String(trigger.refId));
    }
    return false;
  }

  const results = [];
  for (const { def, schedule } of habits) {
    for (const dayStr of days) {
      let reason = null;

      if (schedule.mode === 'date') {
        if (schedule.date === dayStr) reason = { kind: 'date', date: schedule.date };
      } else if (schedule.mode === 'weekly') {
        if (schedule.days.includes(weekdayOf(dayStr))) {
          reason = { kind: 'weekly', days: schedule.days };
        }
      } else if (schedule.mode === 'interval') {
        const n = schedule.intervalDays;
        const anchor = schedule.anchorDate;
        if (n && anchor && dayStr >= anchor && daysBetween(anchor, dayStr) % n === 0) {
          reason = { kind: 'interval', intervalDays: n, anchorDate: anchor };
        }
      } else if (schedule.mode === 'trigger') {
        const t = schedule.trigger;
        if (t) {
          const offset = Math.min(Math.abs(t.offsetDays || 0), MAX_OFFSET_DAYS);
          const sourceDay = t.direction === 'before'
            ? shiftDay(dayStr, offset)
            : shiftDay(dayStr, -offset);
          if (triggerMatchesDay(t, sourceDay)) {
            reason = {
              kind: 'trigger',
              direction: t.direction,
              offsetDays: offset,
              sourceKind: t.kind,
              sourceName: triggerSourceName(t),
              sourceDate: sourceDay,
            };
          }
        }
      } else {
        reason = { kind: 'daily' };
      }

      if (!reason) continue;
      const log = logsByHabitDay.get(`${def._id}|${dayStr}`);
      const s = habitSettings[String(def._id)] || {};
      const targetCondition = ['min', 'max', 'exact'].includes(s.targetCondition) ? s.targetCondition : 'none';
      const targetValue = Number.isFinite(s.targetValue) ? s.targetValue : 0;

      // A manual log always wins; otherwise fall back to the auto-filled value
      // from the bound metric/activity, if any.
      const autoValue = autoValues.get(`${def._id}|${dayStr}`);
      const hasAuto = !log && autoValue != null;
      const effectiveValue = log ? log.value : (hasAuto ? autoValue : null);

      results.push({
        date: dayStr,
        habitId: String(def._id),
        name: def.name,
        unitSymbol: def.unitSymbol,
        type: def.type,
        targetCondition,
        targetValue,
        logged: !!log || hasAuto,
        loggedValue: effectiveValue,
        auto: hasAuto,
        source: hasAuto ? autoSourceKindOf(habits, def._id) : (log ? 'manual' : null),
        // A day only counts as DONE when the value satisfies the completion
        // target — 0 g logged against a 5 g minimum stays open.
        fulfilled: effectiveValue != null
          ? meetsDailyTarget(targetCondition, targetValue, effectiveValue)
          : false,
        reason,
      });
    }
  }
  return results;
}

module.exports = { dueHabitsForRange, scheduleOf, MAX_OFFSET_DAYS, MAX_RANGE_DAYS };
