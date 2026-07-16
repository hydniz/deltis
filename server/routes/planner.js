// Weekly planner endpoints (/api/planner): planned activities and habits per
// weekday, including completion state derived from the logs.
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

// Copies all plans (activities + habits) from one week to another. Copies are
// created as open plans; entries that already exist on the target day (same
// activity type or habit) are skipped so repeated calls stay idempotent.
router.post('/copy-week', auth, async (req, res) => {
  try {
    const { sourceStart, targetStart } = req.body;
    if (!sourceStart || !targetStart) {
      return res.status(400).json({ error: 'sourceStart und targetStart sind erforderlich' });
    }
    const src = new Date(sourceStart);
    const tgt = new Date(targetStart);
    if (isNaN(src.getTime()) || isNaN(tgt.getTime())) {
      return res.status(400).json({ error: 'Ungültiges Datum' });
    }

    const DAY_MS = 24 * 60 * 60 * 1000;
    const offsetMs = Math.round((tgt - src) / DAY_MS) * DAY_MS;
    const weekEnd = (start) => new Date(start.getTime() + 6 * DAY_MS + (DAY_MS - 1));
    const dayKey = (date) => new Date(date).toISOString().slice(0, 10);

    const [srcActivities, srcHabits, tgtActivities, tgtHabits] = await Promise.all([
      ActivityPlan.find({ userId: req.user._id, scheduledDate: { $gte: src, $lte: weekEnd(src) } }),
      HabitPlan.find({ userId: req.user._id, scheduledDate: { $gte: src, $lte: weekEnd(src) } }),
      ActivityPlan.find({ userId: req.user._id, scheduledDate: { $gte: tgt, $lte: weekEnd(tgt) } }),
      HabitPlan.find({ userId: req.user._id, scheduledDate: { $gte: tgt, $lte: weekEnd(tgt) } }),
    ]);

    const existingActivityKeys = new Set(
      tgtActivities.map(p => `${dayKey(p.scheduledDate)}|${p.activityTypeRef || p.activityType}`)
    );
    const existingHabitKeys = new Set(
      tgtHabits.map(p => `${dayKey(p.scheduledDate)}|${p.habitId}`)
    );

    let skipped = 0;
    const activityDocs = [];
    for (const p of srcActivities) {
      const newDate = new Date(p.scheduledDate.getTime() + offsetMs);
      if (existingActivityKeys.has(`${dayKey(newDate)}|${p.activityTypeRef || p.activityType}`)) {
        skipped++;
        continue;
      }
      activityDocs.push({
        userId: req.user._id,
        activityType: p.activityType,
        activityTypeRef: p.activityTypeRef || undefined,
        activityTypeVersion: p.activityTypeVersion,
        scheduledDate: newDate,
        duration: p.duration,
        distance: p.distance,
        notes: p.notes,
        customValues: p.customValues || {},
      });
    }

    const habitDocs = [];
    for (const p of srcHabits) {
      const newDate = new Date(p.scheduledDate.getTime() + offsetMs);
      if (existingHabitKeys.has(`${dayKey(newDate)}|${p.habitId}`)) {
        skipped++;
        continue;
      }
      habitDocs.push({
        userId: req.user._id,
        habitId: p.habitId,
        habitName: p.habitName,
        unitSymbol: p.unitSymbol,
        habitType: p.habitType,
        scheduledDate: newDate,
        notes: p.notes,
      });
    }

    await Promise.all([
      activityDocs.length ? ActivityPlan.insertMany(activityDocs) : Promise.resolve(),
      habitDocs.length ? HabitPlan.insertMany(habitDocs) : Promise.resolve(),
    ]);

    res.status(201).json({
      copiedActivities: activityDocs.length,
      copiedHabits: habitDocs.length,
      skipped,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

// ─Habit Plans

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
