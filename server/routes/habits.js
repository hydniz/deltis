const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const HabitDefinition = require('../models/HabitDefinition');
const HabitLog = require('../models/HabitLog');
const User = require('../models/User');

function enrichLog(logObj) {
  const habit = logObj.habitId;
  const version = logObj.habitVersion;
  if (habit && version && habit.version !== version) {
    const historical = (habit.nameHistory || []).find(h => h.version === version);
    if (historical) logObj.historicalLabel = historical.name;
  }
  if (habit) delete habit.nameHistory;
  return logObj;
}

// Definitions – liefert alle Habits mit `selected`-Flag
router.get('/definitions', auth, async (req, res) => {
  try {
    const definitions = await HabitDefinition.find({
      $or: [{ userId: null }, { userId: req.user._id }]
    }).sort({ isPredefined: -1, name: 1 });

    const selectedIds = (req.user.selectedHabitIds || []).map(id => id.toString());
    const noneSelected = selectedIds.length === 0;

    const result = definitions.map(d => ({
      ...d.toObject(),
      selected: noneSelected || selectedIds.includes(d._id.toString())
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auswahl der aktiven Habits speichern
router.put('/selection', auth, async (req, res) => {
  try {
    const { selectedIds } = req.body;
    await User.findByIdAndUpdate(req.user._id, { selectedHabitIds: selectedIds });
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

// Name/Eigenschaften einer eigenen Gewohnheit ändern (mit Versionsverfolgung)
router.put('/definitions/:id', auth, async (req, res) => {
  try {
    const current = await HabitDefinition.findOne({ _id: req.params.id, userId: req.user._id });
    if (!current) return res.status(404).json({ error: 'Nicht gefunden oder vordefiniert' });

    const { nameHistory: _nh, version: _v, _id: _i, createdAt: _c, userId: _u, __v: _vv, ...safeBody } = req.body;

    if (safeBody.name && safeBody.name !== current.name) {
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
    const result = await HabitDefinition.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!result) return res.status(404).json({ error: 'Nicht gefunden oder vordefiniert' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Logs
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
