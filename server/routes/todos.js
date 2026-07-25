// To-do endpoints (/api/todos): CRUD, completion toggle, and the due-todo view
// that powers the planner, dashboard and companion reminders.
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const Todo = require('../models/Todo');
const TodoCompletion = require('../models/TodoCompletion');
const todoSchedule = require('../services/todoSchedule');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

// Normalizes an event trigger. `todo` sources only make sense as 'after'
// (a todo was completed) — 'before' would need the other todo's due days,
// which invites cycles, so it is coerced to 'after'.
function sanitizeTrigger(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = ['habit', 'activityType', 'stravaSport', 'trainingType', 'todo'].includes(raw.kind) ? raw.kind : null;
  if (!kind) return null;
  let direction = raw.direction === 'before' ? 'before' : 'after';
  if (kind === 'stravaSport' || kind === 'todo') direction = 'after';
  if (kind === 'trainingType') direction = 'before';
  const offsetDays = Math.min(Math.max(parseInt(raw.offsetDays, 10) || 0, 0), 30);
  if (kind === 'stravaSport') {
    const sport = typeof raw.sport === 'string' ? raw.sport.trim().slice(0, 50) : '';
    return sport ? { kind, direction, offsetDays, sport } : null;
  }
  if (!mongoose.isValidObjectId(raw.refId)) return null;
  return { kind, direction, offsetDays, refId: String(raw.refId) };
}

// Validates + normalizes the writable fields of a todo.
function sanitizeTodo(body) {
  const errors = [];
  const out = {};
  if (body.title !== undefined) {
    const title = String(body.title).trim();
    if (title.length < 1 || title.length > 200) errors.push('Titel muss 1–200 Zeichen lang sein.');
    out.title = title;
  }
  if (body.notes !== undefined) out.notes = String(body.notes).slice(0, 2000);
  if (body.priority !== undefined) {
    out.priority = ['low', 'normal', 'high'].includes(body.priority) ? body.priority : 'normal';
  }
  if (body.reminderTime !== undefined) {
    out.reminderTime = TIME_RE.test(body.reminderTime) ? body.reminderTime : null;
  }

  const mode = ['once', 'daily', 'weekly', 'interval', 'trigger'].includes(body.scheduleMode) ? body.scheduleMode : 'once';
  out.scheduleMode = mode;
  out.dueDate = mode === 'once' && DATE_RE.test(body.dueDate) ? body.dueDate : (mode === 'once' ? new Date().toISOString().slice(0, 10) : null);
  out.scheduleDays = mode === 'weekly' && Array.isArray(body.scheduleDays)
    ? [...new Set(body.scheduleDays.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : [];
  const iv = parseInt(body.scheduleIntervalDays, 10);
  out.scheduleIntervalDays = mode === 'interval' && iv >= 1 && iv <= 365 ? iv : null;
  out.scheduleAnchorDate = mode === 'interval'
    ? (DATE_RE.test(body.scheduleAnchorDate) ? body.scheduleAnchorDate : new Date().toISOString().slice(0, 10))
    : null;
  out.scheduleTrigger = mode === 'trigger' ? sanitizeTrigger(body.scheduleTrigger) : null;

  if (mode === 'weekly' && out.scheduleDays.length === 0) errors.push('Wähle mindestens einen Wochentag.');
  if (mode === 'interval' && !out.scheduleIntervalDays) errors.push('Gib ein gültiges Intervall an.');
  if (mode === 'trigger' && !out.scheduleTrigger) errors.push('Der Auslöser ist unvollständig.');

  return { out, errors };
}

router.get('/', auth, async (req, res) => {
  try {
    const query = { userId: req.user._id };
    query.deletedAt = req.query.includeDeleted === 'true' ? { $ne: undefined } : null;
    const todos = await Todo.find(query).sort({ createdAt: -1 }).lean();
    res.json(todos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Due todos with completion state — for the planner, dashboard and companion.
router.get('/due', auth, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const start = DATE_RE.test(req.query.startDate) ? req.query.startDate : today;
    const end = DATE_RE.test(req.query.endDate) ? req.query.endDate : start;
    if (end < start) return res.status(400).json({ error: 'endDate liegt vor startDate.' });
    res.json(await todoSchedule.dueTodosForRange(req.user._id, start, end));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { out, errors } = sanitizeTodo(req.body);
    if (!out.title) errors.push('Titel ist erforderlich.');
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    const todo = await Todo.create({ userId: req.user._id, ...out });
    res.status(201).json(todo);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { out, errors } = sanitizeTodo(req.body);
    if (out.title === '') errors.push('Titel ist erforderlich.');
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    const todo = await Todo.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id, deletedAt: null }, { $set: out }, { new: true });
    if (!todo) return res.status(404).json({ error: 'Aufgabe nicht gefunden.' });
    res.json(todo);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const todo = await Todo.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id, deletedAt: null },
      { $set: { deletedAt: new Date() } }, { new: true });
    if (!todo) return res.status(404).json({ error: 'Aufgabe nicht gefunden.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle completion for one occurrence (day). Idempotent per (todo, day).
router.post('/:id/complete', auth, async (req, res) => {
  try {
    const day = DATE_RE.test(req.body.date) ? req.body.date : new Date().toISOString().slice(0, 10);
    const todo = await Todo.findOne({ _id: req.params.id, userId: req.user._id, deletedAt: null });
    if (!todo) return res.status(404).json({ error: 'Aufgabe nicht gefunden.' });
    const date = new Date(`${day}T00:00:00.000Z`);
    await TodoCompletion.updateOne(
      { userId: req.user._id, todoId: todo._id, date },
      { $setOnInsert: { userId: req.user._id, todoId: todo._id, date } },
      { upsert: true });
    res.json({ success: true, done: true, date: day });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id/complete', auth, async (req, res) => {
  try {
    const day = DATE_RE.test(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
    await TodoCompletion.deleteOne({
      userId: req.user._id, todoId: req.params.id, date: new Date(`${day}T00:00:00.000Z`) });
    res.json({ success: true, done: false, date: day });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
