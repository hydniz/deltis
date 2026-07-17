// Habit endpoints (/api/habits): habit definitions, daily logs and per-user
// habit selection.
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const HabitDefinition = require('../models/HabitDefinition');
const HabitLog = require('../models/HabitLog');
const UserHabitSettings = require('../models/UserHabitSettings');

function enrichLog(logObj) {
  const habit = logObj.habitId;
  const version = logObj.habitVersion;
  if (habit && version && habit.version !== version) {
    const historical = (habit.nameHistory || []).find(h => h.version === version);
    if (historical) {
      if (historical.name !== habit.name) logObj.historicalLabel = historical.name;
      if (historical.unitSymbol && historical.unitSymbol !== habit.unitSymbol) {
        logObj.historicalUnit = historical.unitSymbol;
      }
    }
  }
  if (habit) delete habit.nameHistory;
  return logObj;
}

// Definitions – returns the user's habits with a `selected` flag. Every habit
// is user-owned (migration 004 dissolved the shared global library); deleted
// ones are soft-deleted and only listed on request (trash section).
router.get('/definitions', auth, async (req, res) => {
  try {
    const [definitions, settings] = await Promise.all([
      HabitDefinition.find({ $or: [{ userId: null }, { userId: req.user._id }] })
        .sort({ name: 1 }),
      UserHabitSettings.findOne({ userId: req.user._id }),
    ]);

    const selectedIds = (settings?.selectedHabitIds || []).map(id => id.toString());
    const hiddenIds = (settings?.hiddenHabitIds || []).map(id => id.toString());
    // Opt-in: only explicitly selected habits count as selected. New users
    // start with none; migration 003 grandfathers accounts that used habits
    // under the old all-selected-by-default rule.
    const habitSettings = settings?.habitSettings || {};

    let result = definitions.map(d => {
      const s = habitSettings[d._id.toString()] || {};
      // `hidden` covers legacy global docs a user "deleted" before the
      // library became personal; user-owned docs carry deletedAt instead.
      const hidden = hiddenIds.includes(d._id.toString()) || !!d.deletedAt;
      return {
        ...d.toObject(),
        hidden,
        selected: !hidden && selectedIds.includes(d._id.toString()),
        missingDayMode: s.missingDayMode || 'none',
        defaultValue: s.defaultValue ?? 0,
        // Weekdays (0 = Sunday … 6 = Saturday) the habit is scheduled on;
        // empty array = every day (default behaviour).
        scheduleDays: Array.isArray(s.scheduleDays) ? s.scheduleDays : [],
        // One-off schedule: habit is only due on this local date (YYYY-MM-DD).
        // Takes precedence over scheduleDays; null = not date-bound.
        scheduleDate: typeof s.scheduleDate === 'string' ? s.scheduleDate : null,
        // Extended schedule (interval / event trigger) — see services/habitSchedule.js
        scheduleMode: typeof s.scheduleMode === 'string' ? s.scheduleMode : null,
        scheduleIntervalDays: Number.isInteger(s.scheduleIntervalDays) ? s.scheduleIntervalDays : null,
        scheduleAnchorDate: typeof s.scheduleAnchorDate === 'string' ? s.scheduleAnchorDate : null,
        scheduleTrigger: s.scheduleTrigger || null,
        // Daily completion target: a day only counts as fulfilled when the
        // logged value satisfies condition+value ('none' = any log counts).
        targetCondition: ['min', 'max', 'exact'].includes(s.targetCondition) ? s.targetCondition : 'none',
        targetValue: Number.isFinite(s.targetValue) ? s.targetValue : 0,
      };
    });

    // Deleted habits stay out of every normal listing; the manage modal
    // requests them explicitly for its trash section.
    if (req.query.includeHidden !== 'true' && req.query.includeDeleted !== 'true') {
      result = result.filter(d => !d.hidden);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Static suggestion catalog for onboarding: these are templates, not shared
// documents — picking one creates a personal HabitDefinition for the user.
// Entries whose name the user already has (active or in the trash) are
// filtered out so adopting twice cannot create duplicates.
const HABIT_CATALOG = [
  { name: 'Screen Time', unitSymbol: 'h', type: 'duration' },
  { name: 'Kreatin', unitSymbol: 'g', type: 'amount' },
  { name: 'Zigaretten', unitSymbol: 'Stück', type: 'amount' },
  { name: 'Wasser', unitSymbol: 'ml', type: 'amount' },
  { name: 'Schlaf', unitSymbol: 'h', type: 'duration' },
  { name: 'Meditation', unitSymbol: 'min', type: 'duration' },
  { name: 'Koffein', unitSymbol: 'mg', type: 'amount' },
  { name: 'Alkohol', unitSymbol: 'Gläser', type: 'amount' },
];

router.get('/catalog', auth, async (req, res) => {
  try {
    const existing = await HabitDefinition
      .find({ $or: [{ userId: null }, { userId: req.user._id }] })
      .select('name');
    const taken = new Set(existing.map(d => d.name.trim().toLowerCase()));
    res.json(HABIT_CATALOG.filter(h => !taken.has(h.name.toLowerCase())));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Persist the user's active habit selection
router.put('/selection', auth, async (req, res) => {
  try {
    const { selectedIds } = req.body;
    // Only well-formed ObjectIds enter the selection list.
    const ids = (Array.isArray(selectedIds) ? selectedIds : [])
      .filter(id => mongoose.isValidObjectId(id));
    await UserHabitSettings.findOneAndUpdate(
      { userId: req.user._id },
      { $set: { selectedHabitIds: ids, hasSelection: true } },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Valid schedule trigger payload → normalized object, or null.
// Direction rules keep the semantics honest: a Strava sport can only have
// HAPPENED ('after'), a training type is only meaningful as PLANNED
// ('before'); habits and activity types support both.
function sanitizeScheduleTrigger(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = ['habit', 'activityType', 'stravaSport', 'trainingType'].includes(raw.kind) ? raw.kind : null;
  if (!kind) return null;
  let direction = raw.direction === 'before' ? 'before' : 'after';
  if (kind === 'stravaSport') direction = 'after';
  if (kind === 'trainingType') direction = 'before';
  const offsetDays = Math.min(Math.max(parseInt(raw.offsetDays, 10) || 0, 0), 30);
  if (kind === 'stravaSport') {
    const sport = typeof raw.sport === 'string' ? raw.sport.trim().slice(0, 50) : '';
    return sport ? { kind, direction, offsetDays, sport } : null;
  }
  if (!mongoose.isValidObjectId(raw.refId)) return null;
  return { kind, direction, offsetDays, refId: String(raw.refId) };
}

// Normalizes the per-user settings payload (schedule, missing-day mode,
// completion target) — shared by PUT /settings/:id and the inline settings
// of POST /definitions.
function sanitizeHabitSettings(body, habitType) {
  const {
    missingDayMode, defaultValue, scheduleDays, scheduleDate, targetCondition, targetValue,
    scheduleMode, scheduleIntervalDays, scheduleAnchorDate, scheduleTrigger,
  } = body;
  const mode = ['none', 'default'].includes(missingDayMode) ? missingDayMode : 'none';
  // Sanitize schedule: unique integer weekdays 0–6, sorted; [] = every day.
  const days = Array.isArray(scheduleDays)
    ? [...new Set(scheduleDays.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : [];
  // One-off date must be a plain local date string; anything else = unset.
  const dateOnly = typeof scheduleDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)
    ? scheduleDate
    : null;
  // Extended schedule: explicit mode plus interval/trigger config. An
  // invalid combination falls back to the legacy derivation (date > days >
  // daily) so old clients keep working unchanged.
  const intervalDays = Number.isInteger(+scheduleIntervalDays) && +scheduleIntervalDays >= 1 && +scheduleIntervalDays <= 365
    ? +scheduleIntervalDays
    : null;
  const anchorDate = typeof scheduleAnchorDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(scheduleAnchorDate)
    ? scheduleAnchorDate
    : null;
  const trigger = sanitizeScheduleTrigger(scheduleTrigger);
  let schedMode = ['daily', 'weekly', 'date', 'interval', 'trigger'].includes(scheduleMode) ? scheduleMode : null;
  if (schedMode === 'interval' && !intervalDays) schedMode = null;
  if (schedMode === 'trigger' && !trigger) schedMode = null;
  if (schedMode === 'date' && !dateOnly) schedMode = null;
  if (!schedMode) {
    schedMode = dateOnly ? 'date' : days.length ? 'weekly' : 'daily';
  }
  // Completion target: only known conditions with a sane numeric value —
  // boolean habits have no numeric target at all.
  const condition = habitType !== 'boolean' && ['min', 'max', 'exact'].includes(targetCondition)
    ? targetCondition
    : 'none';
  const tValue = condition !== 'none' && Number.isFinite(+targetValue) && +targetValue >= 0
    ? +targetValue
    : 0;
  // Boolean habits only know done (1) / not done (0) as a default value.
  let defVal = Number.isFinite(+defaultValue) ? +defaultValue : 0;
  if (habitType === 'boolean') defVal = defVal > 0 ? 1 : 0;
  return {
    missingDayMode: mode,
    defaultValue: defVal,
    scheduleMode: schedMode,
    scheduleDays: schedMode === 'weekly' ? days : [],
    scheduleDate: schedMode === 'date' ? dateOnly : null,
    scheduleIntervalDays: schedMode === 'interval' ? intervalDays : null,
    // Anchor defaults to today so "alle N Tage" starts counting immediately.
    scheduleAnchorDate: schedMode === 'interval'
      ? (anchorDate || new Date().toISOString().slice(0, 10))
      : null,
    scheduleTrigger: schedMode === 'trigger' ? trigger : null,
    targetCondition: tValue > 0 || condition === 'max' ? condition : 'none',
    targetValue: tValue,
  };
}

router.post('/definitions', auth, async (req, res) => {
  try {
    const { name, unitSymbol, type } = req.body;
    const def = await HabitDefinition.create({
      userId: req.user._id,
      name,
      unitSymbol,
      type: type || 'amount',
      isPredefined: false,
      version: 1,
      nameHistory: [],
    });

    // Optional inline settings — lets the create form configure the schedule
    // and defaults in one go instead of a second trip to the settings.
    const hasInlineSettings = ['missingDayMode', 'defaultValue', 'scheduleDays', 'scheduleDate', 'targetCondition', 'targetValue']
      .some(key => req.body[key] !== undefined);
    let settings = null;
    if (hasInlineSettings) {
      settings = sanitizeHabitSettings(req.body, def.type);
      await UserHabitSettings.findOneAndUpdate(
        { userId: req.user._id },
        { $set: { [`habitSettings.${def._id}`]: settings } },
        { upsert: true }
      );
    }

    res.status(201).json({ ...def.toObject(), ...(settings || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update the name/properties of a habit (with version tracking)
router.put('/definitions/:id', auth, async (req, res) => {
  try {
    const current = await HabitDefinition.findOne({ _id: req.params.id, userId: req.user._id });
    if (!current) return res.status(404).json({ error: 'Nicht gefunden' });

    const { nameHistory: _nh, version: _v, _id: _i, createdAt: _c, userId: _u, __v: _vv, isPredefined: _p, deletedAt: _d, ...safeBody } = req.body;

    const nameChanged = safeBody.name && safeBody.name !== current.name;
    const unitChanged = safeBody.unitSymbol && safeBody.unitSymbol !== current.unitSymbol;
    const typeChanged = safeBody.type && safeBody.type !== current.type;

    if (nameChanged || unitChanged) {
      const validFrom = current.nameHistory?.length > 0
        ? current.nameHistory[current.nameHistory.length - 1].validUntil
        : current.createdAt;

      await HabitDefinition.updateOne(
        { _id: current._id },
        {
          $set: { ...safeBody, version: (current.version || 1) + 1 },
          $push: {
            nameHistory: {
              name: current.name,
              unitSymbol: current.unitSymbol,
              version: current.version || 1,
              validFrom,
              validUntil: new Date(),
            },
          },
        }
      );
    } else {
      await HabitDefinition.updateOne({ _id: current._id }, { $set: safeBody });
    }

    // A type change ripples into dependent data: open planner entries carry a
    // type snapshot for their completion dialog, and numeric settings stop
    // making sense for yes/no habits. Existing logs keep their values — for
    // boolean habits any value > 0 simply reads as "done".
    if (typeChanged) {
      const HabitPlan = require('../models/HabitPlan');
      const def = await HabitDefinition.findById(current._id).select('type unitSymbol');
      await HabitPlan.updateMany(
        { userId: req.user._id, habitId: current._id, completed: false },
        { $set: { habitType: def.type, unitSymbol: def.unitSymbol } }
      );
      if (def.type === 'boolean') {
        const settings = await UserHabitSettings.findOne({ userId: req.user._id });
        const s = settings?.habitSettings?.[current._id.toString()];
        if (s) {
          await UserHabitSettings.updateOne(
            { userId: req.user._id },
            { $set: { [`habitSettings.${current._id}`]: {
              ...s,
              targetCondition: 'none',
              targetValue: 0,
              defaultValue: s.defaultValue > 0 ? 1 : 0,
            } } }
          );
        }
      }
    }

    const def = await HabitDefinition.findById(current._id);
    res.json(def);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Deleting a habit is always a soft delete: the definition stays in the
// database forever so planner history, logs and old plans keep resolving —
// it just moves into the trash (restorable at any time).
router.delete('/definitions/:id', auth, async (req, res) => {
  try {
    const def = await HabitDefinition.findById(req.params.id);
    if (!def) return res.status(404).json({ error: 'Nicht gefunden' });

    // Legacy global docs (pre-004 exports) are hidden per-user.
    if (!def.userId) {
      await UserHabitSettings.findOneAndUpdate(
        { userId: req.user._id },
        { $addToSet: { hiddenHabitIds: def._id }, $pull: { selectedHabitIds: def._id } },
        { upsert: true }
      );
      return res.json({ success: true, hidden: true });
    }

    const result = await HabitDefinition.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: { deletedAt: new Date() } }
    );
    if (!result) return res.status(404).json({ error: 'Nicht gefunden' });
    await UserHabitSettings.findOneAndUpdate(
      { userId: req.user._id },
      { $pull: { selectedHabitIds: def._id } },
      { upsert: true }
    );
    res.json({ success: true, hidden: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bring a deleted habit back from the trash.
router.post('/definitions/:id/restore', auth, async (req, res) => {
  try {
    await HabitDefinition.updateOne(
      { _id: req.params.id, userId: req.user._id },
      { $set: { deletedAt: null } }
    );
    // Legacy global docs are restored by unhiding them.
    await UserHabitSettings.findOneAndUpdate(
      { userId: req.user._id },
      { $pull: { hiddenHabitIds: req.params.id } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Persist per-user habit settings (missing-day mode, default value, schedule)
router.put('/settings/:id', auth, async (req, res) => {
  try {
    // The id becomes a Mongoose path segment (habitSettings.<id>) — accept
    // only real ObjectIds so no crafted key can be injected.
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Ungültige Habit-ID.' });
    }
    // The habit's type decides which settings make sense (boolean habits
    // have no numeric target and only 0/1 as a default value).
    const def = await HabitDefinition.findOne({
      _id: req.params.id,
      $or: [{ userId: req.user._id }, { userId: null }],
    }).select('type');
    await UserHabitSettings.findOneAndUpdate(
      { userId: req.user._id },
      { $set: { [`habitSettings.${req.params.id}`]: sanitizeHabitSettings(req.body, def?.type) } },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Due habits: which selected habits are scheduled on which days of the
// range, and why (daily / weekdays / date / interval / event trigger).
// Powers the implicit habit entries in the planner and the dashboard.
router.get('/due', auth, async (req, res) => {
  try {
    const habitSchedule = require('../services/habitSchedule');
    const today = new Date().toISOString().slice(0, 10);
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const start = dateRe.test(req.query.startDate) ? req.query.startDate : today;
    const end = dateRe.test(req.query.endDate) ? req.query.endDate : start;
    if (end < start) return res.status(400).json({ error: 'endDate liegt vor startDate.' });
    res.json(await habitSchedule.dueHabitsForRange(req.user._id, start, end));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Logs – read and write daily habit values
router.get('/logs', auth, async (req, res) => {
  try {
    const { startDate, endDate, habitId } = req.query;
    const query = { userId: req.user._id };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }
    if (habitId) query.habitId = habitId;

    const logs = await HabitLog.find(query)
      .populate('habitId', 'name version nameHistory unitSymbol type')
      .sort({ date: -1 });

    res.json(logs.map(l => enrichLog(l.toObject())));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/logs', auth, async (req, res) => {
  try {
    const { habitId, date, value } = req.body;
    const d = new Date(date);
    const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

    // Logs may only reference the user's own or global (predefined) habits.
    const habitDef = await HabitDefinition.findOne({
      _id: habitId,
      $or: [{ userId: req.user._id }, { userId: null }],
    }).select('version');
    if (!habitDef) return res.status(404).json({ error: 'Habit nicht gefunden' });
    const habitVersion = habitDef.version;

    const log = await HabitLog.findOneAndUpdate(
      { userId: req.user._id, habitId, date: { $gte: startOfDay, $lte: endOfDay } },
      { userId: req.user._id, habitId, date: startOfDay, value, habitVersion },
      { upsert: true, new: true }
    );

    res.status(201).json(log);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/logs/:id', auth, async (req, res) => {
  try {
    await HabitLog.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
