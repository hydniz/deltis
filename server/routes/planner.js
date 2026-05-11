const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ActivityPlan = require('../models/ActivityPlan');
const ActivityType = require('../models/ActivityType');
const HabitPlan = require('../models/HabitPlan');
const HabitDefinition = require('../models/HabitDefinition');
const HabitLog = require('../models/HabitLog');

function enrichPlan(planObj) {
  const ref = planObj.activityTypeRef;
  const version = planObj.activityTypeVersion;
  if (ref && version && ref.version !== version) {
    const historical = (ref.nameHistory || []).find(h => h.version === version);
    if (historical) planObj.historicalLabel = historical.name;
  }
  if (ref) delete ref.nameHistory;
  return planObj;
}

router.get('/', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const query = { userId: req.user._id };

    if (startDate || endDate) {
      query.scheduledDate = {};
      if (startDate) query.scheduledDate.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        query.scheduledDate.$lte = end;
      }
    }

    const plans = await ActivityPlan.find(query)
      .populate('activityTypeRef', 'label version nameHistory showDistance showDuration customFields')
      .sort({ scheduledDate: 1 });

    res.json(plans.map(p => enrichPlan(p.toObject())));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { activityType, activityTypeRef, scheduledDate, duration, distance, notes, customValues } = req.body;

    let activityTypeVersion;
    if (activityTypeRef) {
      const typeDoc = await ActivityType.findById(activityTypeRef).select('version');
      activityTypeVersion = typeDoc?.version;
    }

    const plan = await ActivityPlan.create({
      userId: req.user._id,
      activityType,
      activityTypeRef: activityTypeRef || undefined,
      activityTypeVersion,
      scheduledDate: new Date(scheduledDate),
      duration,
      distance,
      notes,
      customValues: customValues || {},
    });
    res.status(201).json(plan);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const plan = await ActivityPlan.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      req.body,
      { new: true }
    );
    if (!plan) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(plan);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await ActivityPlan.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Habit Plans ──────────────────────────────────────────────────────────────

router.get('/habits', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const query = { userId: req.user._id };
    if (startDate || endDate) {
      query.scheduledDate = {};
      if (startDate) query.scheduledDate.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        query.scheduledDate.$lte = end;
      }
    }
    const plans = await HabitPlan.find(query)
      .populate('habitId', 'name unitSymbol type')
      .sort({ scheduledDate: 1 });
    res.json(plans.map(p => p.toObject()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/habits', auth, async (req, res) => {
  try {
    const { habitId, scheduledDate, notes } = req.body;
    const habit = await HabitDefinition.findById(habitId).select('name unitSymbol type');
    const plan = await HabitPlan.create({
      userId: req.user._id,
      habitId,
      habitName: habit?.name,
      unitSymbol: habit?.unitSymbol,
      habitType: habit?.type,
      scheduledDate: new Date(scheduledDate),
      notes: notes || undefined,
    });
    res.status(201).json(plan);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/habits/:id/complete', auth, async (req, res) => {
  try {
    const { value, date } = req.body;
    const plan = await HabitPlan.findOne({ _id: req.params.id, userId: req.user._id });
    if (!plan) return res.status(404).json({ error: 'Nicht gefunden' });
    const logDate = date ? new Date(date) : new Date(plan.scheduledDate);
    await HabitLog.create({
      userId: req.user._id,
      habitId: plan.habitId,
      date: logDate,
      value: value ?? 1,
    });
    plan.completed = true;
    plan.loggedValue = value ?? 1;
    await plan.save();
    res.json(plan);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/habits/:id', auth, async (req, res) => {
  try {
    const plan = await HabitPlan.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      req.body,
      { new: true }
    );
    if (!plan) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(plan);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/habits/:id', auth, async (req, res) => {
  try {
    await HabitPlan.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
