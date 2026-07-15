// Activity type endpoints (/api/activity-types): per-user workout categories
// with custom field definitions; a default set is seeded on first access.
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

// Vergleicht customFields-Arrays ohne _id-Felder auf inhaltliche Gleichheit
function customFieldsChanged(a = [], b = []) {
  const normalize = (fields) => fields.map(f => ({
    key: f.key, label: f.label, type: f.type,
    unit: f.unit ?? null,
    options: f.options ? [...f.options].sort() : [],
  }));
  return JSON.stringify(normalize(a)) !== JSON.stringify(normalize(b));
}

// Stellt sicher, dass bestehende Felder ihren key behalten (verhindert kaputte Metrik-Referenzen)
function preserveExistingKeys(incoming = [], current = []) {
  return incoming.map(field => {
    const existing = current.find(c => c.key === field.key);
    if (existing) return { ...field, key: existing.key };
    // Neues Feld: key aus label generieren (falls leer)
    if (!field.key) {
      field.key = field.label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    }
    return field;
  });
}

// Static list of the predefined types — used by the onboarding wizard to
// let new users pick their set before anything is created.
router.get('/defaults', auth, (_req, res) => {
  res.json(DEFAULTS);
});

// Onboarding: create exactly the chosen predefined types (idempotent).
router.post('/setup', auth, async (req, res) => {
  try {
    const { labels } = req.body;
    const wanted = Array.isArray(labels) ? labels : [];
    const chosen = DEFAULTS.filter(d => wanted.includes(d.label));
    const existing = await ActivityType.find({ userId: req.user._id }).select('label');
    const existingLabels = new Set(existing.map(t => t.label));
    const toCreate = chosen.filter(d => !existingLabels.has(d.label));
    if (toCreate.length > 0) {
      await ActivityType.insertMany(
        toCreate.map(d => ({ ...d, userId: req.user._id, version: 1, nameHistory: [] }))
      );
    }
    const types = await ActivityType.find({ userId: req.user._id }).sort({ createdAt: 1 });
    res.status(201).json(types);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/', auth, async (req, res) => {
  try {
    let types = await ActivityType.find({ userId: req.user._id }).sort({ createdAt: 1 });
    // Legacy auto-seed: only for accounts that never went through the
    // onboarding wizard. Onboarded users chose their set deliberately —
    // an empty list must stay empty. Upserts keep the seed race-safe when
    // several pages request the types in parallel on first load.
    if (types.length === 0 && !req.user.onboardingPending && !req.user.onboardedAt) {
      for (const d of DEFAULTS) {
        await ActivityType.findOneAndUpdate(
          { userId: req.user._id, label: d.label },
          { $setOnInsert: { ...d, userId: req.user._id, version: 1, nameHistory: [] } },
          { upsert: true }
        );
      }
      types = await ActivityType.find({ userId: req.user._id }).sort({ createdAt: 1 });
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

    const { nameHistory: _nh, version: _v, _id: _i, createdAt: _c, userId: _u, __v: _vv, ...safeBody } = req.body;

    // Preserve field order and keys: do not change keys of existing fields
    if (safeBody.customFields) {
      safeBody.customFields = preserveExistingKeys(safeBody.customFields, current.customFields);
    }

    const labelChanged = safeBody.label && safeBody.label !== current.label;
    const fieldsChanged = safeBody.customFields !== undefined &&
      customFieldsChanged(safeBody.customFields, current.customFields.map(f => f.toObject ? f.toObject() : f));

    if (labelChanged || fieldsChanged) {
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
              customFields: current.customFields.map(f => f.toObject ? f.toObject() : f),
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
