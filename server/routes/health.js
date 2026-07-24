// Health Connect endpoints (/api/health): device connect/disconnect, sync
// configuration and the idempotent upload the companion app pushes.
//
// Duplicate handling is documented in docs/HEALTH.md. In short: excluded
// origins are dropped, uploads upsert on the Health Connect record id, and
// services/activityMerge.js decides which record of a real workout counts.
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const HealthConnection = require('../models/HealthConnection');
const HealthActivity = require('../models/HealthActivity');
const activityMerge = require('../services/activityMerge');
const healthWeight = require('../services/healthWeight');
const healthMetrics = require('../services/healthMetrics');
const catalog = require('../services/metricCatalog');
const MetricDefinition = require('../models/MetricDefinition');

// Upper bound per request — the app pages through longer backfills.
const MAX_RECORDS_PER_SYNC = 500;

// When the user enables a Health-Connect-backed metric type, make sure a
// MetricDefinition exists to receive it — otherwise the upload would have
// nowhere to go. Idempotent: seeds only the missing ones.
async function ensureMetricDefinitions(userId, enabledTypes) {
  const wanted = (enabledTypes || []).filter(t => catalog.HEALTH_METRICS[t]);
  if (wanted.length === 0) return;
  const existing = new Set(
    (await MetricDefinition.find({ userId, healthType: { $in: wanted }, deletedAt: null })
      .select('healthType').lean()).map(d => d.healthType)
  );
  for (const type of wanted) {
    if (existing.has(type)) continue;
    try {
      await MetricDefinition.create({
        userId,
        ...catalog.definitionFromTemplate(type, catalog.HEALTH_METRICS[type]),
        healthType: type,
        builtin: type,
      });
    } catch {
      // A concurrent sync may have created it, or the key/healthType is taken
      // by a metric the user renamed — either way the upload still routes.
    }
  }
}

function publicConnection(connection) {
  return {
    connected: true,
    deviceId: connection.deviceId,
    deviceName: connection.deviceName,
    enabledTypes: connection.enabledTypes,
    backfillDays: connection.backfillDays,
    excludedOrigins: connection.excludedOrigins,
    lastSyncAt: connection.lastSyncAt,
    lastSyncCounts: connection.lastSyncCounts,
    supportedTypes: HealthConnection.SUPPORTED_TYPES,
    minBackfillDays: HealthConnection.MIN_BACKFILL_DAYS,
    maxBackfillDays: HealthConnection.MAX_BACKFILL_DAYS,
  };
}

// Which origins the app must skip, derived from what Deltis ACTUALLY ingests
// server-side right now. A static list is a data-loss bug: a user who records
// with Strava but never linked it to Deltis would have every GPS activity
// dropped on the device and imported from nowhere.
async function effectiveExcludedOrigins(userId) {
  const StravaConnection = require('../models/StravaConnection');
  const linked = await StravaConnection.exists({ userId });
  return linked ? [...HealthConnection.DEFAULT_EXCLUDED_ORIGINS] : [];
}

function sanitizeTypes(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const allowed = value.filter(t => HealthConnection.SUPPORTED_TYPES.includes(t));
  return allowed.length ? [...new Set(allowed)] : fallback;
}

// The metrics that currently pull from Health Connect, so the companion knows
// which record types to read and which unit each value is expected in.
async function metricTargetsFor(userId) {
  const defs = await MetricDefinition.find({
    userId, deletedAt: null, healthType: { $type: 'string' },
  }).select('healthType key name unit').lean();
  return defs.map(d => ({ healthType: d.healthType, metricId: String(d._id), name: d.name, unit: d.unit }));
}

// What the app needs before reading anything: which types it may read, how far
// back, and which writing apps to skip so Deltis never sees a record twice.
router.get('/config', auth, async (req, res) => {
  try {
    const excludedOrigins = await effectiveExcludedOrigins(req.user._id);
    const connection = await HealthConnection.findOne({ userId: req.user._id });
    if (!connection) {
      return res.json({
        connected: false,
        supportedTypes: HealthConnection.SUPPORTED_TYPES,
        enabledTypes: [],
        backfillDays: HealthConnection.DEFAULT_BACKFILL_DAYS,
        excludedOrigins,
        minBackfillDays: HealthConnection.MIN_BACKFILL_DAYS,
        maxBackfillDays: HealthConnection.MAX_BACKFILL_DAYS,
      });
    }
    res.json({
      ...publicConnection(connection),
      excludedOrigins,
      metricTargets: await metricTargetsFor(req.user._id),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Connect (or re-connect) this device. The backfill window the user picked is
// clamped to at least a week — below that the automation has too little
// history to fill the planner or judge habits.
router.post('/connect', auth, async (req, res) => {
  try {
    const { deviceId, deviceName, platform, appVersion, enabledTypes, backfillDays } = req.body;
    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({ error: 'Geräte-ID fehlt.' });
    }

    const connection = await HealthConnection.findOneAndUpdate(
      { userId: req.user._id },
      {
        $set: {
          deviceId: String(deviceId).slice(0, 200),
          deviceName: String(deviceName || '').slice(0, 100),
          platform: String(platform || 'android').slice(0, 40),
          appVersion: String(appVersion || '').slice(0, 40),
          enabledTypes: sanitizeTypes(enabledTypes, ['exercise', 'weight']),
          backfillDays: HealthConnection.clampBackfillDays(
            backfillDays ?? HealthConnection.DEFAULT_BACKFILL_DAYS),
        },
        $setOnInsert: { userId: req.user._id },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await ensureMetricDefinitions(req.user._id, connection.enabledTypes);
    res.status(201).json({
      ...publicConnection(connection),
      metricTargets: await metricTargetsFor(req.user._id),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Change which types are read and how far back.
router.put('/config', auth, async (req, res) => {
  try {
    const connection = await HealthConnection.findOne({ userId: req.user._id });
    if (!connection) return res.status(404).json({ error: 'Health Connect ist nicht verbunden.' });

    if (req.body.enabledTypes !== undefined) {
      connection.enabledTypes = sanitizeTypes(req.body.enabledTypes, connection.enabledTypes);
    }
    if (req.body.backfillDays !== undefined) {
      connection.backfillDays = HealthConnection.clampBackfillDays(req.body.backfillDays);
    }
    await connection.save();
    await ensureMetricDefinitions(req.user._id, connection.enabledTypes);
    res.json({
      ...publicConnection(connection),
      metricTargets: await metricTargetsFor(req.user._id),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Maps one Health Connect ExerciseSessionRecord onto the stored shape.
// Heart-rate samples become the Strava-compatible stream shape so the existing
// heart-rate criteria helpers evaluate health sessions unchanged.
function toActivityDoc(userId, record, deviceId) {
  const start = new Date(record.startTime);
  const end = new Date(record.endTime);
  const elapsed = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  const moving = Number.isFinite(Number(record.activeDurationSeconds))
    ? Math.round(Number(record.activeDurationSeconds))
    : elapsed;

  const samples = Array.isArray(record.heartRateSamples) ? record.heartRateSamples : [];
  const streams = samples.length
    ? {
        heartrate: { data: samples.map(s => Number(s.bpm)).filter(Number.isFinite) },
        time: {
          data: samples.map(s =>
            Math.max(0, Math.round((new Date(s.time).getTime() - start.getTime()) / 1000))),
        },
      }
    : null;

  const distance = Number(record.distanceMeters);
  const doc = {
    userId,
    healthId: String(record.id),
    deviceId: deviceId || '',
    dataOrigin: String(record.dataOrigin || ''),
    exerciseType: String(record.exerciseType || ''),
    title: String(record.title || '').slice(0, 200),
    startDate: start,
    endDate: end,
    startDateLocal: record.startTimeLocal ? new Date(record.startTimeLocal) : start,
    timezone: String(record.zoneOffset || ''),
    movingTime: moving,
    elapsedTime: elapsed,
    distance: Number.isFinite(distance) ? distance : 0,
    totalElevationGain: Number(record.elevationGainMeters) || 0,
    steps: Number.isFinite(Number(record.steps)) ? Number(record.steps) : undefined,
    calories: Number.isFinite(Number(record.totalEnergyKcal)) ? Number(record.totalEnergyKcal) : undefined,
    activeCalories: Number.isFinite(Number(record.activeEnergyKcal)) ? Number(record.activeEnergyKcal) : undefined,
    averageHeartrate: Number.isFinite(Number(record.avgHeartRate)) ? Number(record.avgHeartRate) : undefined,
    maxHeartrate: Number.isFinite(Number(record.maxHeartRate)) ? Number(record.maxHeartRate) : undefined,
    streams,
    raw: record,
    lastModifiedTime: record.lastModifiedTime ? new Date(record.lastModifiedTime) : undefined,
    syncedAt: new Date(),
  };

  // Average speed is derived rather than trusted — Health Connect rarely
  // supplies it and the criteria engine needs it in m/s.
  if (doc.distance > 0 && moving > 0) doc.averageSpeed = doc.distance / moving;
  doc.sportType = activityMerge.healthFamily(doc);
  return doc;
}

function isValidRecord(record) {
  if (!record || !record.id) return false;
  const start = new Date(record.startTime).getTime();
  const end = new Date(record.endTime).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end >= start;
}

// The upload. Safe to repeat: every activity upserts on (userId, healthId) and
// every weight on (userId, source, sourceId), so replaying a widened backfill
// window can never create duplicates.
router.post('/sync', auth, async (req, res) => {
  try {
    const connection = await HealthConnection.findOne({ userId: req.user._id });
    if (!connection) return res.status(404).json({ error: 'Health Connect ist nicht verbunden.' });

    const activities = Array.isArray(req.body.activities) ? req.body.activities : [];
    const weights = Array.isArray(req.body.weights) ? req.body.weights : [];
    const metrics = Array.isArray(req.body.metrics) ? req.body.metrics : [];
    if (activities.length + weights.length + metrics.length > MAX_RECORDS_PER_SYNC) {
      return res.status(413).json({
        error: `Zu viele Datensätze pro Anfrage (max. ${MAX_RECORDS_PER_SYNC}).`,
      });
    }

    // Defence in depth: the app is asked to skip these origins, but a record
    // from an already-ingested source is rejected here as well.
    const excluded = new Set(await effectiveExcludedOrigins(req.user._id));
    const accepted = activities.filter(isValidRecord)
      .filter(record => !excluded.has(String(record.dataOrigin || '')));
    const rejected = activities.length - accepted.length;

    let stored = 0;
    if (connection.enabledTypes.includes('exercise')) {
      for (const record of accepted) {
        const doc = toActivityDoc(req.user._id, record, connection.deviceId);
        await HealthActivity.updateOne(
          { userId: req.user._id, healthId: doc.healthId },
          { $set: doc },
          { upsert: true }
        );
        stored++;
      }
    }

    let weightResult = { imported: 0, skipped: 0, collapsed: 0 };
    if (connection.enabledTypes.includes('weight')) {
      // Health Connect reports kilograms, so the stored value IS kilograms.
      // Labelling it with the user's display unit would show a kg number as
      // pounds; converting for display is the read path's job.
      weightResult = await healthWeight.mergeWeightRecords(req.user._id, weights, {
        unit: 'kg',
      });
    }

    // Generic scalar measurements (body fat, resting HR, sleep, blood pressure,
    // steps, hydration, …) route to the user's metrics. Records whose type has
    // no destination metric are reported in `metricResult.unmapped`.
    const definitions = await healthMetrics.healthDefinitionsFor(req.user._id);
    const metricResult = await healthMetrics.mergeMetricRecords(req.user._id, metrics, definitions);

    // Reconcile the touched window in both directions, so a session that
    // duplicates a Strava activity is flagged immediately.
    const times = accepted.map(r => new Date(r.startTime).getTime());
    const merge = times.length
      ? await activityMerge.reconcileUser(req.user._id, {
          start: new Date(Math.min(...times) - 24 * 60 * 60 * 1000),
          end: new Date(Math.max(...times) + 24 * 60 * 60 * 1000),
        })
      : { checked: 0, superseded: 0, promoted: 0 };

    const counts = {
      activities: stored,
      rejectedOrigins: rejected,
      weights: weightResult,
      metrics: metricResult,
      merge,
    };
    connection.lastSyncAt = new Date();
    connection.lastSyncCounts = counts;
    await connection.save();

    res.json({ success: true, ...counts });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Synced sessions. Superseded ones are hidden unless explicitly requested,
// which is how the settings page can show what was deduplicated.
router.get('/activities', auth, async (req, res) => {
  try {
    const { startDate, endDate, limit = 100, includeSuperseded } = req.query;
    const query = { userId: req.user._id };
    if (includeSuperseded !== 'true') query.canonical = true;
    if (startDate || endDate) {
      query.startDate = {};
      if (startDate) query.startDate.$gte = new Date(startDate);
      if (endDate) query.startDate.$lte = new Date(endDate);
    }
    const activities = await HealthActivity.find(query)
      .select('-raw -streams')
      .sort({ startDate: -1 })
      .limit(Math.min(+limit || 100, 500));
    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Disconnect. Imported data is kept by default — `?purge=true` removes the
// synced sessions as well (the weight log is never purged automatically).
router.delete('/connect', auth, async (req, res) => {
  try {
    await HealthConnection.deleteOne({ userId: req.user._id });
    let removed = 0;
    if (req.query.purge === 'true') {
      const result = await HealthActivity.deleteMany({ userId: req.user._id });
      removed = result.deletedCount || 0;
    }
    res.json({ success: true, removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
