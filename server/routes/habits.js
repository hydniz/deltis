// Habit endpoints (/api/habits): habit definitions, daily logs and per-user
// habit selection.
const express = require('express');
const router = express.Router();
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

// Definitions – returns all habits with a `selected` flag
router.get('/definitions', auth, async (req, res) => {
  try {
    const [definitions, settings] = await Promise.all([
      HabitDefinition.find({ $or: [{ userId: null }, { userId: req.user._id }] })
        .sort({ isPredefined: -1, name: 1 }),
      UserHabitSettings.findOne({ userId: req.user._id }),
    ]);

    const selectedIds = (settings?.selectedHabitIds || []).map(id => id.toString());
    const hiddenIds = (settings?.hiddenHabitIds || []).map(id => id.toString());
    // Without an explicit selection every habit counts as selected (legacy
    // default); once the user saved a choice, an empty list means none.
    const noneSelected = selectedIds.length === 0 && !settings?.hasSelection;
    const habitSettings = settings?.habitSettings || {};

    let result = definitions.map(d => {
      const s = habitSettings[d._id.toString()] || {};
      const hidden = hiddenIds.includes(d._id.toString());
      return {
        ...d.toObject(),
        hidden,
        selected: !hidden && (noneSelected || selectedIds.includes(d._id.toString())),
        missingDayMode: s.missingDayMode || 'none',
        defaultValue: s.defaultValue ?? 0,
        // Weekdays (0 = Sunday … 6 = Saturday) the habit is scheduled on;
        // empty array = every day (default behaviour).
        scheduleDays: Array.isArray(s.scheduleDays) ? s.scheduleDays : [],
        // One-off schedule: habit is only due on this local date (YYYY-MM-DD).
        // Takes precedence over scheduleDays; null = not date-bound.
        scheduleDate: typeof s.scheduleDate === 'string' ? s.scheduleDate : null,
        // Daily completion target: a day only counts as fulfilled when the
        // logged value satisfies condition+value ('none' = any log counts).
        targetCondition: ['min', 'max', 'exact'].includes(s.targetCondition) ? s.targetCondition : 'none',
        targetValue: Number.isFinite(s.targetValue) ? s.targetValue : 0,
      };
    });

    // Hidden ("deleted") predefined habits stay out of every normal listing;
    // the manage modal requests them explicitly to offer restoration.
    if (req.query.includeHidden !== 'true') {
      result = result.filter(d => !d.hidden);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Persist the user's active habit selection
router.put('/selection', auth, async (req, res) => {
  try {
    const { selectedIds } = req.body;
    await UserHabitSettings.findOneAndUpdate(
      { userId: req.user._id },
      { $set: { selectedHabitIds: selectedIds, hasSelection: true } },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
    res.status(201).json(def);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update the name/properties of a custom habit (with version tracking)
router.put('/definitions/:id', auth, async (req, res) => {
  try {
    const current = await HabitDefinition.findOne({ _id: req.params.id, userId: req.user._id });
    if (!current) return res.status(404).json({ error: 'Nicht gefunden oder vordefiniert' });

    const { nameHistory: _nh, version: _v, _id: _i, createdAt: _c, userId: _u, __v: _vv, ...safeBody } = req.body;

    const nameChanged = safeBody.name && safeBody.name !== current.name;
    const unitChanged = safeBody.unitSymbol && safeBody.unitSymbol !== current.unitSymbol;

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

    const def = await HabitDefinition.findById(current._id);
    res.json(def);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/definitions/:id', auth, async (req, res) => {
  try {
    const def = await HabitDefinition.findById(req.params.id);
    if (!def) return res.status(404).json({ error: 'Nicht gefunden' });

    // Predefined habits are global and re-seeded on startup — "deleting"
    // them hides them for this user only (restorable via /restore).
    if (!def.userId) {
      await UserHabitSettings.findOneAndUpdate(
        { userId: req.user._id },
        { $addToSet: { hiddenHabitIds: def._id }, $pull: { selectedHabitIds: def._id } },
        { upsert: true }
      );
      return res.json({ success: true, hidden: true });
    }

    const result = await HabitDefinition.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!result) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bring a hidden ("deleted") predefined habit back for this user.
router.post('/definitions/:id/restore', auth, async (req, res) => {
  try {
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
    const { missingDayMode, defaultValue, scheduleDays, scheduleDate, targetCondition, targetValue } = req.body;
    // Sanitize schedule: unique integer weekdays 0–6, sorted; [] = every day.
    const days = Array.isArray(scheduleDays)
      ? [...new Set(scheduleDays.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
      : [];
    // One-off date must be a plain local date string; anything else = unset.
    const dateOnly = typeof scheduleDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)
      ? scheduleDate
      : null;
    // Completion target: only known conditions with a sane numeric value.
    const condition = ['min', 'max', 'exact'].includes(targetCondition) ? targetCondition : 'none';
    const tValue = condition !== 'none' && Number.isFinite(+targetValue) && +targetValue >= 0
      ? +targetValue
      : 0;
    await UserHabitSettings.findOneAndUpdate(
      { userId: req.user._id },
      { $set: { [`habitSettings.${req.params.id}`]: {
        missingDayMode,
        defaultValue: +defaultValue,
        scheduleDays: days,
        scheduleDate: dateOnly,
        targetCondition: tValue > 0 || condition === 'max' ? condition : 'none',
        targetValue: tValue,
      } } },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
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

    const habitDef = await HabitDefinition.findById(habitId).select('version');
    const habitVersion = habitDef?.version;

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
