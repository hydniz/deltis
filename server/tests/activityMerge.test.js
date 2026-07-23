const { startDb, stopDb, clearDb, createUser } = require('./helpers/testApp');
const HealthActivity = require('../models/HealthActivity');
const StravaActivity = require('../models/StravaActivity');
const merge = require('../services/activityMerge');

beforeAll(async () => { await startDb(); });
afterEach(async () => { await clearDb(); });
afterAll(async () => { await stopDb(); });

const T = (iso) => new Date(iso);

// One health session: 08:00–09:00, 10 km run.
function healthDoc(userId, overrides = {}) {
  return {
    userId,
    healthId: overrides.healthId || `hc-${Math.random()}`,
    dataOrigin: 'com.garmin.android',
    exerciseType: 'EXERCISE_TYPE_RUNNING',
    sportType: 'run',
    startDate: T('2026-05-01T08:00:00Z'),
    endDate: T('2026-05-01T09:00:00Z'),
    movingTime: 3600,
    elapsedTime: 3600,
    distance: 10000,
    ...overrides,
  };
}

function stravaDoc(userId, overrides = {}) {
  return {
    userId,
    stravaId: overrides.stravaId || Math.floor(Math.random() * 1e9),
    sportType: 'Run',
    type: 'Run',
    startDate: T('2026-05-01T08:00:00Z'),
    elapsedTime: 3600,
    movingTime: 3600,
    distance: 10000,
    ...overrides,
  };
}

describe('sport family normalization', () => {
  it('maps Strava sport types onto families', () => {
    expect(merge.stravaFamily({ sportType: 'TrailRun' })).toBe('run');
    expect(merge.stravaFamily({ sportType: 'GravelRide' })).toBe('ride');
    expect(merge.stravaFamily({ sportType: 'Swim' })).toBe('swim');
    expect(merge.stravaFamily({ sportType: 'WeightTraining' })).toBe('strength');
    expect(merge.stravaFamily({ sportType: 'Kayaking' })).toBe('row');
  });

  it('folds hiking into the walk family so both apps match', () => {
    expect(merge.stravaFamily({ sportType: 'Hike' })).toBe('walk');
    expect(merge.healthFamily({ exerciseType: 'EXERCISE_TYPE_HIKING' })).toBe('walk');
    expect(merge.healthFamily({ exerciseType: 'EXERCISE_TYPE_WALKING' })).toBe('walk');
  });

  it('falls back to the legacy Strava type field', () => {
    expect(merge.stravaFamily({ sportType: 'Unknown', type: 'Ride' })).toBe('ride');
  });

  it('maps Health Connect exercise types onto families', () => {
    expect(merge.healthFamily({ exerciseType: 'EXERCISE_TYPE_RUNNING_TREADMILL' })).toBe('run');
    expect(merge.healthFamily({ exerciseType: 'EXERCISE_TYPE_BIKING_STATIONARY' })).toBe('ride');
    expect(merge.healthFamily({ exerciseType: 'EXERCISE_TYPE_STRENGTH_TRAINING' })).toBe('strength');
  });

  it('returns "other" for unknown types', () => {
    expect(merge.stravaFamily({ sportType: 'Curling' })).toBe('other');
    expect(merge.healthFamily({})).toBe('other');
  });
});

describe('overlapRatio', () => {
  const a = { start: T('2026-05-01T08:00:00Z'), end: T('2026-05-01T09:00:00Z') };

  it('is 1 for identical intervals', () => {
    expect(merge.overlapRatio(a, a)).toBe(1);
  });

  it('is 0 for disjoint intervals', () => {
    const b = { start: T('2026-05-01T10:00:00Z'), end: T('2026-05-01T11:00:00Z') };
    expect(merge.overlapRatio(a, b)).toBe(0);
  });

  it('measures against the SHORTER activity', () => {
    // 30 min fully inside the 60 min activity → 1, not 0.5.
    const shorter = { start: T('2026-05-01T08:15:00Z'), end: T('2026-05-01T08:45:00Z') };
    expect(merge.overlapRatio(a, shorter)).toBe(1);
  });

  it('handles partial overlap', () => {
    const b = { start: T('2026-05-01T08:30:00Z'), end: T('2026-05-01T09:30:00Z') };
    expect(merge.overlapRatio(a, b)).toBeCloseTo(0.5);
  });

  it('treats a zero-length record inside another as overlapping', () => {
    const instant = { start: T('2026-05-01T08:30:00Z'), end: T('2026-05-01T08:30:00Z') };
    expect(merge.overlapRatio(a, instant)).toBe(1);
  });

  it('returns 0 for unparseable dates', () => {
    expect(merge.overlapRatio(a, { start: 'nope', end: 'nope' })).toBe(0);
  });
});

describe('isSameWorkout', () => {
  it('requires the same family', () => {
    const run = { family: 'run', start: T('2026-05-01T08:00:00Z'), end: T('2026-05-01T09:00:00Z') };
    const ride = { family: 'ride', start: T('2026-05-01T08:00:00Z'), end: T('2026-05-01T09:00:00Z') };
    expect(merge.isSameWorkout(run, ride)).toBe(false);
  });

  it('rejects overlap below the threshold', () => {
    const a = { family: 'run', start: T('2026-05-01T08:00:00Z'), end: T('2026-05-01T09:00:00Z') };
    const b = { family: 'run', start: T('2026-05-01T08:50:00Z'), end: T('2026-05-01T09:50:00Z') };
    expect(merge.isSameWorkout(a, b)).toBe(false);
  });

  it('accepts a watch recording a few extra minutes around the same run', () => {
    const a = { family: 'run', start: T('2026-05-01T08:00:00Z'), end: T('2026-05-01T09:00:00Z') };
    const b = { family: 'run', start: T('2026-05-01T07:55:00Z'), end: T('2026-05-01T09:05:00Z') };
    expect(merge.isSameWorkout(a, b)).toBe(true);
  });
});

describe('richness and ordering', () => {
  it('scores populated metrics and heart-rate streams', () => {
    expect(merge.richness({})).toBe(0);
    expect(merge.richness({ distance: 100 })).toBe(1);
    expect(merge.richness({ distance: 0 })).toBe(0);
    expect(merge.richness({ streams: { heartrate: { data: [1, 2] } } })).toBe(2);
  });

  it('is a strict total order — no two records compare as equal', () => {
    const base = { source: 'health', originPriority: 1, richness: 1, start: T('2026-05-01T08:00:00Z') };
    const a = { ...base, id: 'aaa' };
    const b = { ...base, id: 'bbb' };
    expect(merge.compareRecords(a, b)).toBeLessThan(0);
    expect(merge.compareRecords(b, a)).toBeGreaterThan(0);
    expect(merge.compareRecords(a, a)).toBe(0);
  });

  it('ranks Strava above health regardless of richness', () => {
    const strava = { source: 'strava', originPriority: 0, richness: 0, start: T('2026-05-01T08:00:00Z'), id: 'z' };
    const health = { source: 'health', originPriority: 0, richness: 99, start: T('2026-05-01T08:00:00Z'), id: 'a' };
    expect(merge.compareRecords(strava, health)).toBeLessThan(0);
  });
});

describe('reconcileUser', () => {
  it('supersedes a health session that duplicates a Strava activity', async () => {
    const { user } = await createUser();
    await StravaActivity.create(stravaDoc(user._id));
    const health = await HealthActivity.create(healthDoc(user._id));

    const result = await merge.reconcileUser(user._id);
    expect(result.superseded).toBe(1);

    const stored = await HealthActivity.findById(health._id);
    expect(stored.canonical).toBe(false);
    expect(stored.superseded.by).toBe('strava');
    expect(stored.superseded.reason).toBe('overlap');
  });

  it('keeps the health session when no Strava activity matches', async () => {
    const { user } = await createUser();
    const health = await HealthActivity.create(healthDoc(user._id));

    await merge.reconcileUser(user._id);
    const stored = await HealthActivity.findById(health._id);
    expect(stored.canonical).toBe(true);
  });

  it('does not merge across sport families', async () => {
    const { user } = await createUser();
    await StravaActivity.create(stravaDoc(user._id, { sportType: 'Ride', type: 'Ride' }));
    const health = await HealthActivity.create(healthDoc(user._id));

    await merge.reconcileUser(user._id);
    expect((await HealthActivity.findById(health._id)).canonical).toBe(true);
  });

  it('does not merge activities of another user', async () => {
    const { user } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    await StravaActivity.create(stravaDoc(other._id));
    const health = await HealthActivity.create(healthDoc(user._id));

    await merge.reconcileUser(user._id);
    expect((await HealthActivity.findById(health._id)).canonical).toBe(true);
  });

  // The dangerous case: if two overlapping health sessions could each
  // supersede the other, the workout would disappear from every view.
  it('keeps exactly one of two duplicate health sessions', async () => {
    const { user } = await createUser();
    await HealthActivity.create(healthDoc(user._id, { healthId: 'a', dataOrigin: 'com.garmin' }));
    await HealthActivity.create(healthDoc(user._id, { healthId: 'b', dataOrigin: 'com.samsung' }));

    await merge.reconcileUser(user._id);

    const canonical = await HealthActivity.find({ userId: user._id, canonical: true });
    expect(canonical.length).toBe(1);
  });

  it('never leaves a cluster of many duplicates without a survivor', async () => {
    const { user } = await createUser();
    for (let i = 0; i < 5; i++) {
      await HealthActivity.create(healthDoc(user._id, { healthId: `dup-${i}` }));
    }
    await merge.reconcileUser(user._id);
    expect(await HealthActivity.countDocuments({ userId: user._id, canonical: true })).toBe(1);
  });

  it('prefers the richer of two duplicate health sessions', async () => {
    const { user } = await createUser();
    const poor = await HealthActivity.create(
      healthDoc(user._id, { healthId: 'poor', distance: 0, movingTime: 0 }));
    const rich = await HealthActivity.create(
      healthDoc(user._id, { healthId: 'rich', averageHeartrate: 150, calories: 700 }));

    await merge.reconcileUser(user._id);

    expect((await HealthActivity.findById(rich._id)).canonical).toBe(true);
    expect((await HealthActivity.findById(poor._id)).canonical).toBe(false);
  });

  it('promotes a superseded session again once the Strava activity is gone', async () => {
    const { user } = await createUser();
    const strava = await StravaActivity.create(stravaDoc(user._id));
    const health = await HealthActivity.create(healthDoc(user._id));

    await merge.reconcileUser(user._id);
    expect((await HealthActivity.findById(health._id)).canonical).toBe(false);

    await StravaActivity.deleteOne({ _id: strava._id });
    const result = await merge.reconcileUser(user._id);

    expect(result.promoted).toBe(1);
    const restored = await HealthActivity.findById(health._id);
    expect(restored.canonical).toBe(true);
    expect(restored.superseded.by).toBeNull();
  });

  it('is idempotent — a second run changes nothing', async () => {
    const { user } = await createUser();
    await StravaActivity.create(stravaDoc(user._id));
    await HealthActivity.create(healthDoc(user._id));

    await merge.reconcileUser(user._id);
    const second = await merge.reconcileUser(user._id);

    expect(second.superseded).toBe(0);
    expect(second.promoted).toBe(0);
  });

  it('honours the time window', async () => {
    const { user } = await createUser();
    await HealthActivity.create(healthDoc(user._id));

    const result = await merge.reconcileUser(user._id, {
      start: T('2026-06-01T00:00:00Z'),
      end: T('2026-06-02T00:00:00Z'),
    });
    expect(result.checked).toBe(0);
  });

  it('derives the Strava interval from movingTime when elapsedTime is missing', async () => {
    const { user } = await createUser();
    await StravaActivity.create(stravaDoc(user._id, { elapsedTime: 0, movingTime: 3600 }));
    const health = await HealthActivity.create(healthDoc(user._id));

    await merge.reconcileUser(user._id);
    expect((await HealthActivity.findById(health._id)).canonical).toBe(false);
  });

  it('treats a Strava activity without any duration as an instant', async () => {
    const { user } = await createUser();
    await StravaActivity.create(stravaDoc(user._id, { elapsedTime: 0, movingTime: 0 }));
    const health = await HealthActivity.create(healthDoc(user._id));

    // Zero-length start inside the health session still counts as the same
    // workout, so the richer Strava record wins.
    await merge.reconcileUser(user._id);
    expect((await HealthActivity.findById(health._id)).canonical).toBe(false);
  });

  it('uses the configured origin priority as a tiebreak', async () => {
    const { user } = await createUser();
    const preferred = await HealthActivity.create(
      healthDoc(user._id, { healthId: 'p', dataOrigin: 'com.polar' }));
    const other = await HealthActivity.create(
      healthDoc(user._id, { healthId: 'o', dataOrigin: 'com.other' }));

    await merge.reconcileUser(user._id, { originPriorities: { 'com.polar': 1, 'com.other': 9 } });

    expect((await HealthActivity.findById(preferred._id)).canonical).toBe(true);
    expect((await HealthActivity.findById(other._id)).canonical).toBe(false);
  });
});
