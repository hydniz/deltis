// Merging Health Connect weight measurements into the weight log.
//
// Weight is a scalar per day rather than an interval, so it does not use the
// overlap matching in services/activityMerge.js. The rules (docs/HEALTH.md):
//
//   1. a MANUAL entry always wins for its day — an imported reading never
//      overwrites or shadows a value the user typed by hand,
//   2. otherwise the health measurement fills the day,
//   3. several health readings on one day collapse to the LATEST one.
//
// Idempotency comes from the unique partial index on
// (userId, source, sourceId): re-uploading a record updates it in place.
const WeightLog = require('../models/WeightLog');

const SOURCE = 'health';

function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

// Accepts raw Health Connect weight records:
//   { id, time, weightKg }
// Returns { imported, skipped, collapsed } — `skipped` counts days that were
// left alone because the user had already logged them manually.
async function mergeWeightRecords(userId, records, { unit = 'kg' } = {}) {
  const valid = (Array.isArray(records) ? records : []).filter(r => {
    const weight = Number(r?.weightKg);
    return r?.id && Number.isFinite(weight) && weight > 0 && weight <= 1000 &&
      !Number.isNaN(new Date(r?.time).getTime());
  });

  if (valid.length === 0) return { imported: 0, skipped: 0, collapsed: 0 };

  // Days the user has already filled in by hand are off limits (rule 1).
  const days = [...new Set(valid.map(r => dayKey(r.time)))];
  const manual = await WeightLog.find({
    userId,
    source: { $ne: SOURCE },
    date: {
      $gte: new Date(`${days.slice().sort()[0]}T00:00:00.000Z`),
      $lte: new Date(`${days.slice().sort().at(-1)}T23:59:59.999Z`),
    },
  }).select('date').lean();
  const manualDays = new Set(manual.map(entry => dayKey(entry.date)));

  let imported = 0;
  let skipped = 0;
  const touchedDays = new Set();

  for (const record of valid) {
    const day = dayKey(record.time);
    if (manualDays.has(day)) {
      skipped++;
      continue;
    }
    await WeightLog.updateOne(
      { userId, source: SOURCE, sourceId: String(record.id) },
      {
        $set: {
          date: new Date(record.time),
          weight: Number(record.weightKg),
          unit,
        },
        $setOnInsert: { userId, source: SOURCE, sourceId: String(record.id) },
      },
      { upsert: true }
    );
    imported++;
    touchedDays.add(day);
  }

  // Rule 3: one health value per day — the latest measurement wins.
  let collapsed = 0;
  for (const day of touchedDays) {
    const entries = await WeightLog.find({
      userId,
      source: SOURCE,
      date: {
        $gte: new Date(`${day}T00:00:00.000Z`),
        $lte: new Date(`${day}T23:59:59.999Z`),
      },
    }).sort({ date: -1 }).lean();

    if (entries.length <= 1) continue;
    const stale = entries.slice(1).map(entry => entry._id);
    await WeightLog.deleteMany({ _id: { $in: stale } });
    collapsed += stale.length;
  }

  return { imported, skipped, collapsed };
}

module.exports = { SOURCE, dayKey, mergeWeightRecords };
