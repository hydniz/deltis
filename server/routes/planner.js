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

// Resolves an activityTypeRef ONLY when it belongs to the requesting user —
// referencing another user's type is rejected (cross-tenant reference).
async function resolveOwnActivityType(refId, userId) {
  const typeDoc = await ActivityType.findOne({ _id: refId, userId }).select('version');
  if (!typeDoc) {
    const err = new Error('Aktivitätstyp nicht gefunden');
    err.status = 404;
    throw err;
  }
  return typeDoc;
}

router.post('/', auth, async (req, res) => {
  try {
    const { activityType, activityTypeRef, scheduledDate, duration, distance, notes, customValues } = req.body;

    let activityTypeVersion;
    if (activityTypeRef) {
      const typeDoc = await resolveOwnActivityType(activityTypeRef, req.user._id);
      activityTypeVersion = typeDoc.version;
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
    res.status(err.status || 400).json({ error: err.message });
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
    // Field whitelist: userId/_id and version bookkeeping stay server-owned.
    const { activityType, activityTypeRef, scheduledDate, duration, distance, notes, customValues, completed } = req.body;
    const update = {};
    if (activityType !== undefined) update.activityType = activityType;
    if (scheduledDate !== undefined) update.scheduledDate = new Date(scheduledDate);
    if (duration !== undefined) update.duration = duration;
    if (distance !== undefined) update.distance = distance;
    if (notes !== undefined) update.notes = notes;
    if (customValues !== undefined) update.customValues = customValues || {};
    if (completed !== undefined) update.completed = !!completed;
    const unset = {};
    if (activityTypeRef !== undefined) {
      if (activityTypeRef) {
        const typeDoc = await resolveOwnActivityType(activityTypeRef, req.user._id);
        update.activityTypeRef = activityTypeRef;
        update.activityTypeVersion = typeDoc.version;
      } else {
        unset.activityTypeRef = 1;
        unset.activityTypeVersion = 1;
      }
    }

    const plan = await ActivityPlan.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: update, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      { new: true }
    );
    if (!plan) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(plan);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
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
    // Only own or global (predefined) habits may be planned.
    const habit = await HabitDefinition.findOne({
      _id: habitId,
      $or: [{ userId: req.user._id }, { userId: null }],
    }).select('name unitSymbol type');
    if (!habit) return res.status(404).json({ error: 'Habit nicht gefunden' });
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
    // Field whitelist: userId/_id/habitId snapshots stay server-owned.
    const { scheduledDate, notes, completed, loggedValue } = req.body;
    const update = {};
    if (scheduledDate !== undefined) update.scheduledDate = new Date(scheduledDate);
    if (notes !== undefined) update.notes = notes;
    if (completed !== undefined) update.completed = !!completed;
    if (loggedValue !== undefined) update.loggedValue = loggedValue;

    const plan = await HabitPlan.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: update },
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

// Planned trainings (criteria-based, fulfilled by synced activities)

const TrainingPlan = require('../models/TrainingPlan');
const TrainingType = require('../models/TrainingType');
const trainingCriteria = require('../services/trainingCriteria');

// GET /api/planner/trainings?startDate&endDate
// Fulfilment is never stored: a plan counts as completed when a synced
// activity of the same LOCAL calendar day matches its criteria (saved
// training type or ad-hoc criteria map). Late syncs and deleted activities
// therefore stay correct automatically.
router.get('/trainings', auth, async (req, res) => {
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

    const plans = await TrainingPlan.find(query)
      .populate('trainingTypeId', 'name criteria')
      .sort({ scheduledDate: 1 });

    const results = [];
    for (const plan of plans) {
      const obj = plan.toObject();
      const map = obj.trainingTypeId ? (obj.trainingTypeId.criteria || {}) : (obj.criteria || {});
      const dayStr = new Date(obj.scheduledDate).toISOString().slice(0, 10);
      const matches = await trainingCriteria.findMatchesOnDay(req.user._id, map, dayStr);
      obj.trainingTypeName = obj.trainingTypeId?.name || null;
      obj.trainingTypeId = obj.trainingTypeId?._id || null;
      obj.completed = matches.length > 0;
      obj.fulfilledBy = matches[0] || null;
      results.push(obj);
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Shared validation: a plan needs a training type (own!) or ad-hoc criteria.
async function resolveTrainingBody(body, userId) {
  const { trainingTypeId, criteria } = body;
  if (trainingTypeId) {
    const exists = await TrainingType.exists({ _id: trainingTypeId, userId });
    if (!exists) {
      const err = new Error('Trainingstyp nicht gefunden');
      err.status = 404;
      throw err;
    }
    return { trainingTypeId, criteria: null };
  }
  if (criteria == null) {
    const err = new Error('Trainingstyp oder Kriterien erforderlich.');
    err.status = 400;
    throw err;
  }
  const { valid, errors } = trainingCriteria.validateCriteriaMap(criteria);
  if (!valid) {
    const err = new Error(`Ungültige Kriterien: ${errors.join('; ')}`);
    err.status = 400;
    throw err;
  }
  return { trainingTypeId: null, criteria };
}

router.post('/trainings', auth, async (req, res) => {
  try {
    const { scheduledDate, notes } = req.body;
    if (!scheduledDate) return res.status(400).json({ error: 'Datum erforderlich.' });
    const target = await resolveTrainingBody(req.body, req.user._id);
    const plan = await TrainingPlan.create({
      userId: req.user._id,
      ...target,
      scheduledDate: new Date(scheduledDate),
      notes: notes || '',
    });
    res.status(201).json(plan);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.put('/trainings/:id', auth, async (req, res) => {
  try {
    const update = {};
    if (req.body.scheduledDate !== undefined) update.scheduledDate = new Date(req.body.scheduledDate);
    if (req.body.notes !== undefined) update.notes = req.body.notes || '';
    if (req.body.trainingTypeId !== undefined || req.body.criteria !== undefined) {
      Object.assign(update, await resolveTrainingBody(req.body, req.user._id));
    }
    const plan = await TrainingPlan.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: update },
      { new: true }
    );
    if (!plan) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(plan);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.delete('/trainings/:id', auth, async (req, res) => {
  try {
    const result = await TrainingPlan.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!result) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

