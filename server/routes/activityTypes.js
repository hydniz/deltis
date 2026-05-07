const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ActivityType = require('../models/ActivityType');

const DEFAULTS = [
  {
    label: 'Gym',
    showDistance: false,
    showDuration: true,
    customFields: [
      { key: 'workoutPlan', label: 'Trainingsplan', type: 'select', options: ['Push', 'Pull', 'Legs'] }
    ]
  },
  { label: 'Joggen', showDistance: true, showDuration: true, customFields: [] },
  { label: 'Radfahren', showDistance: true, showDuration: true, customFields: [] },
  { label: 'Schwimmen', showDistance: true, showDuration: true, customFields: [] },
  { label: 'Yoga', showDistance: false, showDuration: true, customFields: [] },
  { label: 'Wandern', showDistance: true, showDuration: true, customFields: [] },
  { label: 'Sonstiges', showDistance: false, showDuration: true, customFields: [] },
];

router.get('/', auth, async (req, res) => {
  try {
    let types = await ActivityType.find({ userId: req.user._id }).sort({ createdAt: 1 });
    if (types.length === 0) {
      types = await ActivityType.insertMany(
        DEFAULTS.map(d => ({ ...d, userId: req.user._id, version: 1, nameHistory: [] }))
      );
    }
    res.json(types);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const type = await ActivityType.create({
      userId: req.user._id,
      version: 1,
      nameHistory: [],
      ...req.body,
    });
    res.status(201).json(type);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const current = await ActivityType.findOne({ _id: req.params.id, userId: req.user._id });
    if (!current) return res.status(404).json({ error: 'Nicht gefunden' });

    // Strip internal versioning fields the frontend may echo back
    const { nameHistory: _nh, version: _v, _id: _i, createdAt: _c, userId: _u, __v: _vv, ...safeBody } = req.body;

    if (safeBody.label && safeBody.label !== current.label) {
      // Name changed: archive old name, bump version
      const validFrom = current.nameHistory?.length > 0
        ? current.nameHistory[current.nameHistory.length - 1].validUntil
        : current.createdAt;

      await ActivityType.updateOne(
        { _id: current._id },
        {
          $set: { ...safeBody, version: (current.version || 1) + 1 },
          $push: {
            nameHistory: {
              name: current.label,
              version: current.version || 1,
              validFrom,
              validUntil: new Date(),
            },
          },
        }
      );
    } else {
      await ActivityType.updateOne({ _id: current._id }, { $set: safeBody });
    }

    const type = await ActivityType.findById(current._id);
    res.json(type);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await ActivityType.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
