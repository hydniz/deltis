// User-defined measurement endpoints (/api/metrics): the generic tracking layer
// behind body fat, resting HR, sleep, blood pressure, hydration, mood, … Each
// MetricDefinition is a metric the user (or a Health Connect import) tracks over
// time; MetricLog holds the readings.
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const MetricDefinition = require('../models/MetricDefinition');
const MetricLog = require('../models/MetricLog');
const catalog = require('../services/metricCatalog');
const { latestValue, dailySeries } = require('../services/metricAggregate');

const { VALUE_TYPES, AGGREGATIONS, DIRECTIONS } = MetricDefinition;

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[äöü]/g, m => ({ ä: 'ae', ö: 'oe', ü: 'ue' }[m]))
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 40) || 'metrik';
}

// Ensures the slug is unique among the user's live metrics.
async function uniqueKey(userId, base) {
  let key = base;
  let n = 2;
  // eslint-disable-next-line no-await-in-loop
  while (await MetricDefinition.exists({ userId, key, deletedAt: null })) {
    key = `${base}_${n++}`.slice(0, 40);
  }
  return key;
}

// Validates and normalizes the user-editable fields of a definition.
function sanitizeDefinition(body) {
  const errors = [];
  const out = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 1 || name.length > 60) errors.push('Name muss 1–60 Zeichen lang sein.');
    out.name = name;
  }
  if (body.unit !== undefined) out.unit = String(body.unit).slice(0, 16);
  if (body.valueType !== undefined) {
    if (!VALUE_TYPES.includes(body.valueType)) errors.push('Ungültiger Werttyp.');
    else out.valueType = body.valueType;
  }
  if (body.scaleMax !== undefined) out.scaleMax = Math.min(Math.max(Number(body.scaleMax) || 5, 2), 100);
  if (body.decimals !== undefined) out.decimals = Math.min(Math.max(parseInt(body.decimals, 10) || 0, 0), 3);
  for (const field of ['dayAggregation', 'aggregation']) {
    if (body[field] !== undefined) {
      if (!AGGREGATIONS.includes(body[field])) errors.push(`Ungültige Aggregation für ${field}.`);
      else out[field] = body[field];
    }
  }
  if (body.direction !== undefined) {
    if (!DIRECTIONS.includes(body.direction)) errors.push('Ungültige Richtung.');
    else out.direction = body.direction;
  }
  for (const field of ['min', 'max', 'groupOrder', 'order']) {
    if (body[field] !== undefined && body[field] !== null) {
      const n = Number(body[field]);
      if (!Number.isFinite(n)) errors.push(`${field} muss eine Zahl sein.`);
      else out[field] = n;
    } else if (body[field] === null && (field === 'min' || field === 'max')) {
      out[field] = null;
    }
  }
  if (out.min != null && out.max != null && out.min > out.max) {
    errors.push('Minimum darf nicht größer als Maximum sein.');
  }
  if (body.groupKey !== undefined) out.groupKey = body.groupKey ? String(body.groupKey).slice(0, 40) : null;
  if (body.icon !== undefined) out.icon = String(body.icon).slice(0, 40);
  if (body.color !== undefined) out.color = String(body.color).slice(0, 20);
  if (body.showOnDashboard !== undefined) out.showOnDashboard = !!body.showOnDashboard;
  return { out, errors };
}

// Enriches a definition with the current value and a light recent history for
// the list/dashboard, mirroring how /habits/definitions enriches.
async function enrich(def, userId) {
  const logs = await MetricLog.find({ userId, metricId: def._id })
    .sort({ date: -1 }).limit(60).select('date value source').lean();
  const chronological = [...logs].reverse();
  const today = new Date().toISOString().slice(0, 10);
  const todayMap = dailySeries(chronological.filter(l => l.date.toISOString().slice(0, 10) === today), def.dayAggregation);
  return {
    ...def,
    latest: logs[0] ? { value: logs[0].value, date: logs[0].date, source: logs[0].source } : null,
    todayValue: todayMap.get(today) ?? null,
    count: logs.length,
  };
}

// The catalog of templates the user can add in one tap (health-backed + manual).
router.get('/catalog', auth, async (req, res) => {
  try {
    const taken = new Set(
      (await MetricDefinition.find({ userId: req.user._id, deletedAt: null }).select('key healthType').lean())
        .flatMap(d => [d.key, d.healthType].filter(Boolean))
    );
    res.json(catalog.fullCatalog().map(t => ({ ...t, added: taken.has(t.key) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A dashboard-ready snapshot: one row per (optionally dashboard-only) metric.
router.get('/summary', auth, async (req, res) => {
  try {
    const query = { userId: req.user._id, deletedAt: null };
    if (req.query.dashboard === 'true') query.showOnDashboard = true;
    const defs = await MetricDefinition.find(query).sort({ order: 1, createdAt: 1 }).lean();
    const rows = await Promise.all(defs.map(async def => {
      const logs = await MetricLog.find({ userId: req.user._id, metricId: def._id })
        .sort({ date: -1 }).limit(30).select('date value').lean();
      return {
        metricId: String(def._id), key: def.key, name: def.name, unit: def.unit,
        icon: def.icon, color: def.color, direction: def.direction,
        groupKey: def.groupKey, decimals: def.decimals,
        value: latestValue(logs), date: logs[0]?.date || null,
      };
    }));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Adds a metric from a catalog template (or the matching Health Connect type).
// Idempotent: returns the existing one if already added.
router.post('/catalog/:key', auth, async (req, res) => {
  try {
    const template = catalog.HEALTH_METRICS[req.params.key] || catalog.EXTRA_CATALOG[req.params.key];
    if (!template) return res.status(404).json({ error: 'Unbekannte Vorlage.' });

    const existing = await MetricDefinition.findOne({
      userId: req.user._id, key: req.params.key, deletedAt: null,
    });
    if (existing) return res.status(200).json(existing);

    const healthType = catalog.HEALTH_METRICS[req.params.key] ? req.params.key : null;
    const def = await MetricDefinition.create({
      userId: req.user._id,
      ...catalog.definitionFromTemplate(req.params.key, template),
      healthType,
      builtin: req.params.key,
    });
    res.status(201).json(def);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// List all live metrics, enriched with their current value.
router.get('/', auth, async (req, res) => {
  try {
    const query = { userId: req.user._id };
    query.deletedAt = req.query.includeDeleted === 'true' ? { $ne: undefined } : null;
    const defs = await MetricDefinition.find(query).sort({ order: 1, createdAt: 1 }).lean();
    res.json(await Promise.all(defs.map(d => enrich(d, req.user._id))));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a hand-defined metric.
router.post('/', auth, async (req, res) => {
  try {
    const { out, errors } = sanitizeDefinition(req.body);
    if (!out.name) errors.push('Name ist erforderlich.');
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });

    const key = await uniqueKey(req.user._id, slugify(req.body.key || out.name));
    const def = await MetricDefinition.create({ userId: req.user._id, key, ...out });
    res.status(201).json(def);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update a metric. A changed name/unit is a versioned rename so old logs stay
// attributable to the label they were recorded under.
router.put('/:id', auth, async (req, res) => {
  try {
    const current = await MetricDefinition.findOne({ _id: req.params.id, userId: req.user._id });
    if (!current) return res.status(404).json({ error: 'Messwert nicht gefunden.' });

    const { out, errors } = sanitizeDefinition(req.body);
    if (out.name === '') errors.push('Name ist erforderlich.');
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });

    const renamed = (out.name && out.name !== current.name) || (out.unit != null && out.unit !== current.unit);
    const update = { $set: out };
    if (renamed) {
      const validFrom = current.nameHistory?.length
        ? current.nameHistory[current.nameHistory.length - 1].validUntil
        : current.createdAt;
      update.$set.version = (current.version || 1) + 1;
      update.$push = {
        nameHistory: {
          name: current.name, unit: current.unit,
          version: current.version || 1, validFrom, validUntil: new Date(),
        },
      };
    }
    const def = await MetricDefinition.findByIdAndUpdate(current._id, update, { new: true });
    res.json(def);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Soft-delete; readings are preserved so a restore brings the history back.
router.delete('/:id', auth, async (req, res) => {
  try {
    const def = await MetricDefinition.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id, deletedAt: null },
      { $set: { deletedAt: new Date() } },
      { new: true }
    );
    if (!def) return res.status(404).json({ error: 'Messwert nicht gefunden.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/restore', auth, async (req, res) => {
  try {
    const def = await MetricDefinition.findOne({ _id: req.params.id, userId: req.user._id });
    if (!def) return res.status(404).json({ error: 'Messwert nicht gefunden.' });
    // Can't restore over a live metric that re-took the key.
    const clash = await MetricDefinition.exists({
      userId: req.user._id, key: def.key, deletedAt: null, _id: { $ne: def._id },
    });
    if (clash) return res.status(409).json({ error: 'Ein Messwert mit diesem Schlüssel existiert bereits.' });
    def.deletedAt = null;
    await def.save();
    res.json(def);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Readings, newest-requested-range first but returned chronologically — the
// same ordering fix WeightLog documents (a naive ascending sort + limit returns
// the OLDEST rows).
router.get('/:id/logs', auth, async (req, res) => {
  try {
    const def = await MetricDefinition.findOne({ _id: req.params.id, userId: req.user._id });
    if (!def) return res.status(404).json({ error: 'Messwert nicht gefunden.' });
    const { startDate, endDate, limit = 200 } = req.query;
    const query = { userId: req.user._id, metricId: def._id };
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }
    const logs = await MetricLog.find(query).sort({ date: -1 }).limit(Math.min(+limit || 200, 1000));
    res.json(logs.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Record a reading by hand.
router.post('/:id/logs', auth, async (req, res) => {
  try {
    const def = await MetricDefinition.findOne({ _id: req.params.id, userId: req.user._id });
    if (!def) return res.status(404).json({ error: 'Messwert nicht gefunden.' });

    const value = Number(req.body.value);
    if (!Number.isFinite(value)) return res.status(400).json({ error: 'Ungültiger Wert.' });
    if (def.min != null && value < def.min) return res.status(400).json({ error: `Wert unter dem Minimum (${def.min}).` });
    if (def.max != null && value > def.max) return res.status(400).json({ error: `Wert über dem Maximum (${def.max}).` });

    const date = req.body.date ? new Date(req.body.date) : new Date();
    if (Number.isNaN(date.getTime())) return res.status(400).json({ error: 'Ungültiges Datum.' });

    const log = await MetricLog.create({
      userId: req.user._id, metricId: def._id, metricVersion: def.version,
      date, value, note: String(req.body.note || '').slice(0, 200), source: 'manual',
    });
    res.status(201).json(log);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/logs/:logId', auth, async (req, res) => {
  try {
    const update = {};
    if (req.body.value !== undefined) {
      const value = Number(req.body.value);
      if (!Number.isFinite(value)) return res.status(400).json({ error: 'Ungültiger Wert.' });
      update.value = value;
    }
    if (req.body.date !== undefined) {
      const date = new Date(req.body.date);
      if (Number.isNaN(date.getTime())) return res.status(400).json({ error: 'Ungültiges Datum.' });
      update.date = date;
    }
    if (req.body.note !== undefined) update.note = String(req.body.note).slice(0, 200);
    const log = await MetricLog.findOneAndUpdate(
      { _id: req.params.logId, userId: req.user._id }, { $set: update }, { new: true });
    if (!log) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
    res.json(log);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/logs/:logId', auth, async (req, res) => {
  try {
    const deleted = await MetricLog.findOneAndDelete({ _id: req.params.logId, userId: req.user._id });
    if (!deleted) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
