// Training type endpoints (/api/training-types): user-defined, reusable
// criteria bundles ("Zone 2", …) usable in goals and the weekly planner.
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const TrainingType = require('../models/TrainingType');
const trainingCriteria = require('../services/trainingCriteria');

function assertValidBody(body) {
  const name = String(body.name ?? '').trim();
  if (!name) {
    const err = new Error('Name darf nicht leer sein.');
    err.status = 400;
    throw err;
  }
  const { valid, errors } = trainingCriteria.validateCriteriaMap(body.criteria);
  if (!valid) {
    const err = new Error(`Ungültige Kriterien: ${errors.join('; ')}`);
    err.status = 400;
    throw err;
  }
  return { name, description: String(body.description ?? '').trim(), criteria: body.criteria ?? {} };
}

router.get('/', auth, async (req, res) => {
  try {
    const types = await TrainingType.find({ userId: req.user._id }).sort({ name: 1 });
    res.json(types);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const data = assertValidBody(req.body);
    const type = await TrainingType.create({ ...data, userId: req.user._id });
    res.status(201).json(type);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Ein Trainingstyp mit diesem Namen existiert bereits.' });
    }
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const data = assertValidBody(req.body);
    const type = await TrainingType.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: data },
      { new: true }
    );
    if (!type) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(type);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Ein Trainingstyp mit diesem Namen existiert bereits.' });
    }
    res.status(err.status || 400).json({ error: err.message });
  }
});

// Deleting a type that goals or planned trainings still reference would leave
// them dangling — refuse with a hint instead.
router.delete('/:id', auth, async (req, res) => {
  try {
    const Goal = require('../models/Goal');
    const TrainingPlan = require('../models/TrainingPlan');
    const [goalCount, planCount] = await Promise.all([
      Goal.countDocuments({ userId: req.user._id, trainingTypeId: req.params.id, isActive: true }),
      TrainingPlan.countDocuments({ userId: req.user._id, trainingTypeId: req.params.id }),
    ]);
    if (goalCount > 0 || planCount > 0) {
      return res.status(409).json({
        error: `Trainingstyp wird noch verwendet (${goalCount} Ziel(e), ${planCount} geplante(s) Training(s)). Bitte zuerst dort entfernen.`,
      });
    }

    const result = await TrainingType.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!result) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
