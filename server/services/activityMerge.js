// Cross-source activity deduplication (see docs/HEALTH.md).
//
// Health Connect aggregates from apps that Deltis may ALSO ingest directly, so
// one real workout can arrive as a Strava activity and one or more Health
// Connect sessions. This service decides which record is canonical; the losers
// are flagged, never deleted, so the decision stays reversible.
//
// Two activities are the same workout when they belong to the same user, their
// sport families match, and their intervals overlap by >= MIN_OVERLAP of the
// SHORTER activity. Overlap-of-the-shorter is deliberate: a watch recording a
// few extra minutes around the same run still overlaps almost fully, while two
// separate sessions in one evening do not.
const HealthActivity = require('../models/HealthActivity');
const StravaActivity = require('../models/StravaActivity');

const MIN_OVERLAP = 0.6;

// Source precedence: Strava payloads carry streams, HR zones and power, which
// the criteria engine can actually evaluate — a health session carries far less.
const SOURCE_PRIORITY = { strava: 0, health: 1 };

// Normalized sport families used for matching. Hiking folds into `walk`
// because the same outing is routinely logged as "Hike" by one app and
// "WALKING" by another; the 60 % overlap requirement keeps that safe.
const FAMILY = {
  RUN: 'run', RIDE: 'ride', SWIM: 'swim', WALK: 'walk',
  STRENGTH: 'strength', ROW: 'row', OTHER: 'other',
};

function matchFamily(value, table) {
  const key = String(value || '').toUpperCase();
  for (const [needle, family] of Object.entries(table)) {
    if (key.includes(needle)) return family;
  }
  return FAMILY.OTHER;
}

// Strava `sport_type`/`type`: "TrailRun", "GravelRide", "WeightTraining", …
const STRAVA_FAMILIES = {
  RUN: FAMILY.RUN, RIDE: FAMILY.RIDE, BIKE: FAMILY.RIDE, SWIM: FAMILY.SWIM,
  WALK: FAMILY.WALK, HIKE: FAMILY.WALK, WEIGHT: FAMILY.STRENGTH,
  STRENGTH: FAMILY.STRENGTH, ROW: FAMILY.ROW, KAYAK: FAMILY.ROW,
};

// Health Connect `ExerciseType`: "EXERCISE_TYPE_RUNNING_TREADMILL", …
const HEALTH_FAMILIES = {
  RUNNING: FAMILY.RUN, BIKING: FAMILY.RIDE, CYCLING: FAMILY.RIDE,
  SWIMMING: FAMILY.SWIM, WALKING: FAMILY.WALK, HIKING: FAMILY.WALK,
  STRENGTH: FAMILY.STRENGTH, WEIGHTLIFTING: FAMILY.STRENGTH,
  ROWING: FAMILY.ROW, PADDLING: FAMILY.ROW,
};

function stravaFamily(activity) {
  const primary = matchFamily(activity?.sportType, STRAVA_FAMILIES);
  if (primary !== FAMILY.OTHER) return primary;
  return matchFamily(activity?.type, STRAVA_FAMILIES);
}

function healthFamily(activity) {
  const primary = matchFamily(activity?.exerciseType, HEALTH_FAMILIES);
  if (primary !== FAMILY.OTHER) return primary;
  return matchFamily(activity?.sportType, HEALTH_FAMILIES);
}

// Share of the SHORTER interval that both cover, in [0, 1].
// Zero-length records (instant entries) fall back to containment: they count
// as overlapping when the instant lies inside the other interval.
function overlapRatio(a, b) {
  const aStart = new Date(a.start).getTime();
  const aEnd = new Date(a.end).getTime();
  const bStart = new Date(b.start).getTime();
  const bEnd = new Date(b.end).getTime();
  if ([aStart, aEnd, bStart, bEnd].some(v => !Number.isFinite(v))) return 0;

  const overlap = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
  if (overlap < 0) return 0;

  // A zero-length record that reaches this point necessarily lies inside the
  // other interval — a negative overlap already returned above.
  const shorter = Math.min(aEnd - aStart, bEnd - bStart);
  if (shorter <= 0) return 1;
  return overlap / shorter;
}

function isSameWorkout(a, b) {
  if (a.family !== b.family) return false;
  return overlapRatio(a, b) >= MIN_OVERLAP;
}

// How much usable detail a record carries — the tiebreak between two health
// sessions of the same workout.
const RICHNESS_FIELDS = [
  'distance', 'movingTime', 'averageHeartrate', 'maxHeartrate',
  'totalElevationGain', 'calories', 'steps', 'averageSpeed',
];

function richness(doc) {
  let score = RICHNESS_FIELDS.reduce(
    (sum, field) => sum + (doc?.[field] != null && doc[field] !== 0 ? 1 : 0), 0);
  // Heart-rate detail is worth more than a plain field, but the streams
  // themselves are deliberately not loaded here — `hasHeartrate` (Strava) or a
  // stream that happens to be present is enough of a hint.
  if (doc?.hasHeartrate || doc?.streams?.heartrate?.data?.length) score += 2;
  return score;
}

// Strict TOTAL order over records. Totality matters: if two health records
// could each rank "better" than the other they would supersede each other and
// the workout would disappear from every view. The id tiebreak guarantees
// exactly one winner per overlap cluster.
function compareRecords(a, b) {
  const bySource = SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source];
  if (bySource !== 0) return bySource;

  const byOrigin = a.originPriority - b.originPriority;
  if (byOrigin !== 0) return byOrigin;

  const byRichness = b.richness - a.richness;
  if (byRichness !== 0) return byRichness;

  const byStart = new Date(a.start).getTime() - new Date(b.start).getTime();
  if (byStart !== 0) return byStart;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function toStravaRecord(doc) {
  const start = doc.startDate;
  const elapsed = (doc.elapsedTime || doc.movingTime || 0) * 1000;
  return {
    source: 'strava',
    id: String(doc._id),
    family: stravaFamily(doc),
    start,
    end: new Date(new Date(start).getTime() + elapsed),
    richness: richness(doc),
    originPriority: 0,
    doc,
  };
}

function toHealthRecord(doc, originPriorities) {
  return {
    source: 'health',
    id: String(doc._id),
    family: healthFamily(doc),
    start: doc.startDate,
    end: doc.endDate,
    richness: richness(doc),
    originPriority: originPriorities[doc.dataOrigin] ?? 50,
    doc,
  };
}

// Re-decides canonical/superseded for every health activity in the window.
//
// Runs in BOTH directions by design: call it after a health upload (new
// sessions checked against existing Strava activities) and after a Strava sync
// (a newly pulled activity supersedes the health sessions it duplicates).
// It is idempotent — reconciling twice yields the same state.
async function reconcileUser(userId, { start, end, originPriorities = {} } = {}) {
  const window = {};
  if (start) window.$gte = new Date(start);
  if (end) window.$lte = new Date(end);
  const dateFilter = Object.keys(window).length ? { startDate: window } : {};

  // Both sides are projected and lean: the raw payloads and heart-rate streams
  // are large (a year of sessions is >100 MB) and reconciliation needs none of
  // them beyond a richness hint, so loading full documents here would drag the
  // whole window into memory.
  const [healthDocs, stravaDocs] = await Promise.all([
    HealthActivity.find({ userId, ...dateFilter })
      .select('startDate endDate exerciseType sportType dataOrigin distance movingTime ' +
        'averageHeartrate maxHeartrate totalElevationGain calories steps averageSpeed ' +
        'canonical superseded')
      .lean(),
    StravaActivity.find({ userId, ...dateFilter })
      .select('startDate elapsedTime movingTime sportType type distance averageHeartrate ' +
        'maxHeartrate totalElevationGain calories averageSpeed hasHeartrate isManual')
      .lean(),
  ]);

  const healthRecords = healthDocs.map(doc => toHealthRecord(doc, originPriorities));
  const stravaRecords = stravaDocs.map(toStravaRecord);
  const all = [...stravaRecords, ...healthRecords];

  const ops = [];
  let superseded = 0;
  let promoted = 0;

  for (const record of healthRecords) {
    // The winner is the best-ranked OTHER record describing the same workout.
    // Only records that rank strictly better can supersede this one, so the
    // best-ranked member of any overlap cluster always survives.
    let winner = null;
    for (const other of all) {
      if (other.id === record.id && other.source === record.source) continue;
      if (!isSameWorkout(record, other)) continue;
      if (compareRecords(other, record) >= 0) continue;
      if (!winner || compareRecords(other, winner) < 0) winner = other;
    }

    const doc = record.doc;
    if (winner) {
      const already = doc.canonical === false && doc.superseded?.ref === winner.id;
      if (already) continue;
      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              canonical: false,
              superseded: { by: winner.source, ref: winner.id, reason: 'overlap', at: new Date() },
            },
          },
        },
      });
      superseded++;
      continue;
    }

    // Nothing outranks it any more (e.g. the Strava connection was removed):
    // promote it back so the workout keeps counting.
    if (doc.canonical === false) {
      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              canonical: true,
              superseded: { by: null, ref: null, reason: null, at: null },
            },
          },
        },
      });
      promoted++;
    }
  }

  if (ops.length) await HealthActivity.bulkWrite(ops);
  return { checked: healthRecords.length, superseded, promoted };
}

module.exports = {
  MIN_OVERLAP,
  FAMILY,
  SOURCE_PRIORITY,
  stravaFamily,
  healthFamily,
  overlapRatio,
  isSameWorkout,
  richness,
  compareRecords,
  reconcileUser,
};
