// Merges Health Connect scalar measurements into the metric log.
//
// Generalises services/healthWeight.js from "just weight" to any metric. The
// same three rules apply, but now per metric and gated on the metric's
// aggregation:
//
//   * a MANUAL reading always wins its day — an imported value never overwrites
//     or shadows one the user typed by hand — but ONLY for `last`-style metrics
//     (weight, body fat, resting HR). For `sum`/`avg` metrics (steps, water)
//     manual and health readings legitimately coexist and add up;
//   * imported readings fill the gaps;
//   * for `last` metrics, several health readings on one day collapse to the
//     latest.
//
// Idempotency comes from the unique partial index on
// (userId, metricId, source, sourceId): re-uploading a record updates it.
const MetricDefinition = require('../models/MetricDefinition');
const MetricLog = require('../models/MetricLog');
const { dayKey } = require('./metricAggregate');

const SOURCE = 'health';

// Accepts raw Health Connect metric records:
//   [{ type, id, time, value }]
// `definitions` is the user's metrics keyed by healthType (loaded by the
// caller). Records whose type has no destination metric are counted in
// `unmapped` so the UI can offer to create one. Returns
// { imported, skipped, collapsed, unmapped }.
async function mergeMetricRecords(userId, records, definitions) {
  const result = { imported: 0, skipped: 0, collapsed: 0, unmapped: {} };
  const list = Array.isArray(records) ? records : [];
  if (list.length === 0) return result;

  // Bucket valid records by their destination metric.
  const byMetric = new Map(); // metricId string -> { def, records: [] }
  for (const rec of list) {
    const value = Number(rec?.value);
    if (!rec?.id || !Number.isFinite(value) || Number.isNaN(new Date(rec?.time).getTime())) continue;
    const def = definitions.get(rec.type);
    if (!def) {
      result.unmapped[rec.type] = (result.unmapped[rec.type] || 0) + 1;
      continue;
    }
    // Clamp against the metric's sanity bounds; drop out-of-range readings.
    if (def.min != null && value < def.min) continue;
    if (def.max != null && value > def.max) continue;

    const idStr = String(def._id);
    if (!byMetric.has(idStr)) byMetric.set(idStr, { def, records: [] });
    byMetric.get(idStr).records.push({ ...rec, value });
  }

  for (const { def, records: recs } of byMetric.values()) {
    const guardDays = def.dayAggregation === 'last';

    // Days the user already logged by hand are off limits for `last` metrics.
    let manualDays = new Set();
    if (guardDays) {
      const days = recs.map(r => dayKey(r.time)).sort();
      const manual = await MetricLog.find({
        userId,
        metricId: def._id,
        source: { $ne: SOURCE },
        date: {
          $gte: new Date(`${days[0]}T00:00:00.000Z`),
          $lte: new Date(`${days[days.length - 1]}T23:59:59.999Z`),
        },
      }).select('date').lean();
      manualDays = new Set(manual.map(m => dayKey(m.date)));
    }

    const touchedDays = new Set();
    for (const rec of recs) {
      if (guardDays && manualDays.has(dayKey(rec.time))) {
        result.skipped++;
        continue;
      }
      await MetricLog.updateOne(
        { userId, metricId: def._id, source: SOURCE, sourceId: String(rec.id) },
        {
          $set: { date: new Date(rec.time), value: rec.value, metricVersion: def.version },
          $setOnInsert: { userId, metricId: def._id, source: SOURCE, sourceId: String(rec.id) },
        },
        { upsert: true }
      );
      result.imported++;
      touchedDays.add(dayKey(rec.time));
    }

    // For `last` metrics, keep only the latest health reading per touched day.
    if (guardDays) {
      for (const day of touchedDays) {
        const entries = await MetricLog.find({
          userId,
          metricId: def._id,
          source: SOURCE,
          date: {
            $gte: new Date(`${day}T00:00:00.000Z`),
            $lte: new Date(`${day}T23:59:59.999Z`),
          },
        }).sort({ date: -1 }).lean();
        if (entries.length <= 1) continue;
        const stale = entries.slice(1).map(e => e._id);
        await MetricLog.deleteMany({ _id: { $in: stale } });
        result.collapsed += stale.length;
      }
    }
  }

  return result;
}

// Loads the user's metrics that pull from Health Connect, keyed by healthType.
async function healthDefinitionsFor(userId) {
  const defs = await MetricDefinition.find({
    userId,
    deletedAt: null,
    healthType: { $type: 'string' },
  }).lean();
  return new Map(defs.map(d => [d.healthType, d]));
}

module.exports = { SOURCE, mergeMetricRecords, healthDefinitionsFor };
