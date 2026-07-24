const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createUser, authHeader } = require('./helpers/testApp');
const HealthConnection = require('../models/HealthConnection');
const HealthActivity = require('../models/HealthActivity');
const StravaActivity = require('../models/StravaActivity');
const StravaConnection = require('../models/StravaConnection');
const WeightLog = require('../models/WeightLog');

let app;

beforeAll(async () => {
  await startDb();
  app = buildApp();
});
afterEach(async () => { await clearDb(); });
afterAll(async () => { await stopDb(); });

async function connect(token, body = {}) {
  return request(app).post('/api/health/connect').set(authHeader(token)).send({
    deviceId: 'device-1',
    deviceName: 'Pixel 8',
    enabledTypes: ['exercise', 'weight'],
    backfillDays: 30,
    ...body,
  });
}

function session(overrides = {}) {
  return {
    id: overrides.id || 'hc-1',
    exerciseType: 'EXERCISE_TYPE_RUNNING',
    title: 'Morgenlauf',
    startTime: '2026-05-01T08:00:00.000Z',
    endTime: '2026-05-01T09:00:00.000Z',
    dataOrigin: 'com.garmin.android',
    distanceMeters: 10000,
    activeDurationSeconds: 3500,
    totalEnergyKcal: 700,
    avgHeartRate: 150,
    maxHeartRate: 172,
    ...overrides,
  };
}

describe('GET /api/health/config', () => {
  it('reports "not connected" with defaults before setup', async () => {
    const { token } = await createUser();
    const res = await request(app).get('/api/health/config').set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false);
    expect(res.body.minBackfillDays).toBe(7);
    // Nothing is excluded while no Strava account is linked — excluding a
    // source Deltis does NOT ingest would drop the data entirely.
    expect(res.body.excludedOrigins).toEqual([]);
  });

  it('excludes Strava only once a Strava account is actually linked', async () => {
    const { token, user } = await createUser();
    await StravaConnection.create({
      userId: user._id, athleteId: 4711,
      accessToken: 'a', refreshToken: 'r',
      expiresAt: new Date(Date.now() + 3600000),
    });

    const res = await request(app).get('/api/health/config').set(authHeader(token));
    expect(res.body.excludedOrigins).toContain('com.strava');
  });

  it('returns the stored configuration once connected', async () => {
    const { token } = await createUser();
    await connect(token);

    const res = await request(app).get('/api/health/config').set(authHeader(token));
    expect(res.body.connected).toBe(true);
    expect(res.body.deviceName).toBe('Pixel 8');
    expect(res.body.backfillDays).toBe(30);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/health/config')).status).toBe(401);
  });
});

describe('POST /api/health/connect', () => {
  it('creates the connection', async () => {
    const { token, user } = await createUser();
    const res = await connect(token);

    expect(res.status).toBe(201);
    expect(await HealthConnection.countDocuments({ userId: user._id })).toBe(1);
  });

  it('clamps the backfill window to at least 7 days', async () => {
    const { token } = await createUser();
    expect((await connect(token, { backfillDays: 1 })).body.backfillDays).toBe(7);
    expect((await connect(token, { backfillDays: 0 })).body.backfillDays).toBe(7);
    expect((await connect(token, { backfillDays: -5 })).body.backfillDays).toBe(7);
  });

  it('clamps the backfill window to at most a year', async () => {
    const { token } = await createUser();
    expect((await connect(token, { backfillDays: 5000 })).body.backfillDays).toBe(365);
  });

  it('falls back to the default for a non-numeric window', async () => {
    const { token } = await createUser();
    expect((await connect(token, { backfillDays: 'viele' })).body.backfillDays).toBe(30);
  });

  it('rejects unknown data types and keeps the supported ones', async () => {
    const { token } = await createUser();
    const res = await connect(token, { enabledTypes: ['exercise', 'telepathy'] });
    expect(res.body.enabledTypes).toEqual(['exercise']);
  });

  it('requires a device id', async () => {
    const { token } = await createUser();
    const res = await request(app).post('/api/health/connect').set(authHeader(token)).send({});
    expect(res.status).toBe(400);
  });

  it('re-connecting updates the same connection instead of adding one', async () => {
    const { token, user } = await createUser();
    await connect(token);
    await connect(token, { deviceName: 'Pixel 9' });

    expect(await HealthConnection.countDocuments({ userId: user._id })).toBe(1);
    const stored = await HealthConnection.findOne({ userId: user._id });
    expect(stored.deviceName).toBe('Pixel 9');
  });
});

describe('PUT /api/health/config', () => {
  it('updates types and window', async () => {
    const { token } = await createUser();
    await connect(token);

    const res = await request(app).put('/api/health/config').set(authHeader(token))
      .send({ enabledTypes: ['exercise'], backfillDays: 90 });

    expect(res.status).toBe(200);
    expect(res.body.backfillDays).toBe(90);
    expect(res.body.enabledTypes).toEqual(['exercise']);
  });

  it('still clamps the minimum on update', async () => {
    const { token } = await createUser();
    await connect(token);
    const res = await request(app).put('/api/health/config').set(authHeader(token))
      .send({ backfillDays: 2 });
    expect(res.body.backfillDays).toBe(7);
  });

  it('404s when Health Connect is not connected', async () => {
    const { token } = await createUser();
    const res = await request(app).put('/api/health/config').set(authHeader(token))
      .send({ backfillDays: 30 });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/health/sync', () => {
  it('stores an exercise session', async () => {
    const { token, user } = await createUser();
    await connect(token);

    const res = await request(app).post('/api/health/sync').set(authHeader(token))
      .send({ activities: [session()] });

    expect(res.status).toBe(200);
    expect(res.body.activities).toBe(1);

    const stored = await HealthActivity.findOne({ userId: user._id });
    expect(stored.distance).toBe(10000);
    expect(stored.movingTime).toBe(3500);
    expect(stored.elapsedTime).toBe(3600);
    expect(stored.sportType).toBe('run');
    expect(stored.canonical).toBe(true);
  });

  it('derives average speed from distance and moving time', async () => {
    const { token, user } = await createUser();
    await connect(token);
    await request(app).post('/api/health/sync').set(authHeader(token))
      .send({ activities: [session()] });

    const stored = await HealthActivity.findOne({ userId: user._id });
    expect(stored.averageSpeed).toBeCloseTo(10000 / 3500);
  });

  it('stores heart-rate samples in the Strava-compatible stream shape', async () => {
    const { token, user } = await createUser();
    await connect(token);
    await request(app).post('/api/health/sync').set(authHeader(token)).send({
      activities: [session({
        heartRateSamples: [
          { time: '2026-05-01T08:00:00.000Z', bpm: 120 },
          { time: '2026-05-01T08:00:30.000Z', bpm: 140 },
        ],
      })],
    });

    const stored = await HealthActivity.findOne({ userId: user._id });
    expect(stored.streams.heartrate.data).toEqual([120, 140]);
    expect(stored.streams.time.data).toEqual([0, 30]);
  });

  // Idempotency is what makes a widened backfill window safe to replay.
  it('re-uploading the same record updates instead of duplicating', async () => {
    const { token, user } = await createUser();
    await connect(token);

    await request(app).post('/api/health/sync').set(authHeader(token))
      .send({ activities: [session()] });
    await request(app).post('/api/health/sync').set(authHeader(token))
      .send({ activities: [session({ distanceMeters: 11000 })] });

    expect(await HealthActivity.countDocuments({ userId: user._id })).toBe(1);
    expect((await HealthActivity.findOne({ userId: user._id })).distance).toBe(11000);
  });

  it('drops records written by an excluded origin', async () => {
    const { token, user } = await createUser();
    await StravaConnection.create({
      userId: user._id, athleteId: 4711,
      accessToken: 'a', refreshToken: 'r',
      expiresAt: new Date(Date.now() + 3600000),
    });
    await connect(token);

    const res = await request(app).post('/api/health/sync').set(authHeader(token))
      .send({ activities: [session({ dataOrigin: 'com.strava' })] });

    expect(res.body.activities).toBe(0);
    expect(res.body.rejectedOrigins).toBe(1);
    expect(await HealthActivity.countDocuments({ userId: user._id })).toBe(0);
  });

  // The data-loss case: someone records with Strava but never linked it to
  // Deltis. Their workouts arrive from nowhere else, so they must be kept.
  it('keeps Strava-written records when Strava is not linked to Deltis', async () => {
    const { token, user } = await createUser();
    await connect(token);

    const res = await request(app).post('/api/health/sync').set(authHeader(token))
      .send({ activities: [session({ dataOrigin: 'com.strava' })] });

    expect(res.body.activities).toBe(1);
    expect(res.body.rejectedOrigins).toBe(0);
    expect(await HealthActivity.countDocuments({ userId: user._id })).toBe(1);
  });

  it('ignores malformed records', async () => {
    const { token, user } = await createUser();
    await connect(token);

    const res = await request(app).post('/api/health/sync').set(authHeader(token)).send({
      activities: [
        session({ id: null }),
        session({ id: 'bad-dates', startTime: 'nope', endTime: 'nope' }),
        session({ id: 'reversed', startTime: '2026-05-01T09:00:00Z', endTime: '2026-05-01T08:00:00Z' }),
      ],
    });

    expect(res.status).toBe(200);
    expect(await HealthActivity.countDocuments({ userId: user._id })).toBe(0);
  });

  it('does not store exercise sessions when the type is disabled', async () => {
    const { token, user } = await createUser();
    await connect(token, { enabledTypes: ['weight'] });

    await request(app).post('/api/health/sync').set(authHeader(token))
      .send({ activities: [session()] });

    expect(await HealthActivity.countDocuments({ userId: user._id })).toBe(0);
  });

  it('rejects oversized batches', async () => {
    const { token } = await createUser();
    await connect(token);
    const many = Array.from({ length: 501 }, (_, i) => session({ id: `x-${i}` }));

    const res = await request(app).post('/api/health/sync').set(authHeader(token))
      .send({ activities: many });
    expect(res.status).toBe(413);
  });

  it('404s when Health Connect is not connected', async () => {
    const { token } = await createUser();
    const res = await request(app).post('/api/health/sync').set(authHeader(token))
      .send({ activities: [] });
    expect(res.status).toBe(404);
  });

  it('flags a session that duplicates an existing Strava activity', async () => {
    const { token, user } = await createUser();
    await connect(token);
    await StravaActivity.create({
      userId: user._id, stravaId: 42, sportType: 'Run', type: 'Run',
      startDate: new Date('2026-05-01T08:00:00Z'), elapsedTime: 3600, distance: 10000,
    });

    const res = await request(app).post('/api/health/sync').set(authHeader(token))
      .send({ activities: [session()] });

    expect(res.body.merge.superseded).toBe(1);
    expect((await HealthActivity.findOne({ userId: user._id })).canonical).toBe(false);
  });

  it('records the sync bookkeeping on the connection', async () => {
    const { token, user } = await createUser();
    await connect(token);
    await request(app).post('/api/health/sync').set(authHeader(token))
      .send({ activities: [session()] });

    const stored = await HealthConnection.findOne({ userId: user._id });
    expect(stored.lastSyncAt).toBeTruthy();
    expect(stored.lastSyncCounts.activities).toBe(1);
  });
});

describe('weight merging', () => {
  const weight = (overrides = {}) => ({
    id: 'w-1', time: '2026-05-01T06:00:00.000Z', weightKg: 78.4, ...overrides,
  });

  it('imports a health measurement', async () => {
    const { token, user } = await createUser();
    await connect(token);

    const res = await request(app).post('/api/health/sync').set(authHeader(token))
      .send({ weights: [weight()] });

    expect(res.body.weights.imported).toBe(1);
    const stored = await WeightLog.findOne({ userId: user._id });
    expect(stored.weight).toBe(78.4);
    expect(stored.source).toBe('health');
  });

  // The user's own entry must never be overwritten by a scale reading.
  it('never touches a day the user logged manually', async () => {
    const { token, user } = await createUser();
    await connect(token);
    await WeightLog.create({
      userId: user._id, date: new Date('2026-05-01T20:00:00Z'), weight: 80, source: 'manual',
    });

    const res = await request(app).post('/api/health/sync').set(authHeader(token))
      .send({ weights: [weight()] });

    expect(res.body.weights.imported).toBe(0);
    expect(res.body.weights.skipped).toBe(1);
    const entries = await WeightLog.find({ userId: user._id });
    expect(entries.length).toBe(1);
    expect(entries[0].weight).toBe(80);
  });

  it('is idempotent across repeated uploads', async () => {
    const { token, user } = await createUser();
    await connect(token);

    await request(app).post('/api/health/sync').set(authHeader(token)).send({ weights: [weight()] });
    await request(app).post('/api/health/sync').set(authHeader(token)).send({ weights: [weight()] });

    expect(await WeightLog.countDocuments({ userId: user._id })).toBe(1);
  });

  it('collapses several readings on one day to the latest', async () => {
    const { token, user } = await createUser();
    await connect(token);

    const res = await request(app).post('/api/health/sync').set(authHeader(token)).send({
      weights: [
        weight({ id: 'w-morning', time: '2026-05-01T06:00:00.000Z', weightKg: 78.4 }),
        weight({ id: 'w-evening', time: '2026-05-01T20:00:00.000Z', weightKg: 79.1 }),
      ],
    });

    expect(res.body.weights.collapsed).toBe(1);
    const entries = await WeightLog.find({ userId: user._id });
    expect(entries.length).toBe(1);
    expect(entries[0].weight).toBe(79.1);
  });

  it('keeps measurements on separate days', async () => {
    const { token, user } = await createUser();
    await connect(token);
    await request(app).post('/api/health/sync').set(authHeader(token)).send({
      weights: [
        weight({ id: 'a', time: '2026-05-01T06:00:00.000Z' }),
        weight({ id: 'b', time: '2026-05-02T06:00:00.000Z' }),
      ],
    });

    expect(await WeightLog.countDocuments({ userId: user._id })).toBe(2);
  });

  it('ignores implausible values', async () => {
    const { token, user } = await createUser();
    await connect(token);

    await request(app).post('/api/health/sync').set(authHeader(token)).send({
      weights: [
        weight({ id: 'zero', weightKg: 0 }),
        weight({ id: 'huge', weightKg: 5000 }),
        weight({ id: 'nan', weightKg: 'schwer' }),
        weight({ id: 'undated', time: 'irgendwann' }),
      ],
    });

    expect(await WeightLog.countDocuments({ userId: user._id })).toBe(0);
  });

  it('does not import weight when the type is disabled', async () => {
    const { token, user } = await createUser();
    await connect(token, { enabledTypes: ['exercise'] });
    await request(app).post('/api/health/sync').set(authHeader(token)).send({ weights: [weight()] });

    expect(await WeightLog.countDocuments({ userId: user._id })).toBe(0);
  });

  it('allows several manual entries on the same day', async () => {
    const { user } = await createUser();
    await WeightLog.create({ userId: user._id, date: new Date('2026-05-01T06:00:00Z'), weight: 80 });
    await WeightLog.create({ userId: user._id, date: new Date('2026-05-01T20:00:00Z'), weight: 79 });

    expect(await WeightLog.countDocuments({ userId: user._id })).toBe(2);
  });
});

describe('metric ingestion', () => {
  const MetricDefinition = require('../models/MetricDefinition');
  const MetricLog = require('../models/MetricLog');

  it('auto-provisions metric definitions for enabled health-metric types on connect', async () => {
    const { token, user } = await createUser();
    await connect(token, { enabledTypes: ['exercise', 'restingHeartRate', 'sleepDuration'] });

    const defs = await MetricDefinition.find({ userId: user._id }).lean();
    const types = defs.map(d => d.healthType).sort();
    expect(types).toEqual(['restingHeartRate', 'sleepDuration']);
    expect(defs.every(d => d.builtin)).toBe(true);
  });

  it('exposes metricTargets in the config', async () => {
    const { token } = await createUser();
    await connect(token, { enabledTypes: ['exercise', 'bodyFat'] });

    const res = await request(app).get('/api/health/config').set(authHeader(token));
    expect(res.body.metricTargets).toHaveLength(1);
    expect(res.body.metricTargets[0].healthType).toBe('bodyFat');
  });

  it('stores power and cadence on an exercise session', async () => {
    const { token, user } = await createUser();
    await connect(token, { enabledTypes: ['exercise'] });

    await request(app).post('/api/health/sync').set(authHeader(token))
      .send({ activities: [session({ avgWatts: 210, maxWatts: 480, avgCadence: 88 })] });

    const stored = await HealthActivity.findOne({ userId: user._id });
    expect(stored.averageWatts).toBe(210);
    expect(stored.maxWatts).toBe(480);
    expect(stored.averageCadence).toBe(88);
  });

  it('routes a nutrition record to its metric', async () => {
    const { token, user } = await createUser();
    await connect(token, { enabledTypes: ['protein'] });

    const res = await request(app).post('/api/health/sync').set(authHeader(token)).send({
      metrics: [{ type: 'protein', id: 'p-2026-05-01', time: '2026-05-01T12:00:00.000Z', value: 140 }],
    });

    expect(res.body.metrics.imported).toBe(1);
    const def = await MetricDefinition.findOne({ userId: user._id, healthType: 'protein' });
    expect(def.name).toBe('Protein');
    expect(await MetricLog.countDocuments({ userId: user._id, metricId: def._id })).toBe(1);
  });

  it('routes metric records to the matching metric on sync', async () => {
    const { token, user } = await createUser();
    await connect(token, { enabledTypes: ['restingHeartRate'] });

    const res = await request(app).post('/api/health/sync').set(authHeader(token)).send({
      metrics: [{ type: 'restingHeartRate', id: 'r1', time: '2026-05-01T06:00:00.000Z', value: 51 }],
    });

    expect(res.status).toBe(200);
    expect(res.body.metrics.imported).toBe(1);
    const def = await MetricDefinition.findOne({ userId: user._id, healthType: 'restingHeartRate' });
    expect(await MetricLog.countDocuments({ userId: user._id, metricId: def._id })).toBe(1);
  });

  it('reports records with no destination metric as unmapped', async () => {
    const { token } = await createUser();
    await connect(token, { enabledTypes: ['exercise'] }); // no metric enabled

    const res = await request(app).post('/api/health/sync').set(authHeader(token)).send({
      metrics: [{ type: 'bodyFat', id: 'b1', time: '2026-05-01T06:00:00.000Z', value: 20 }],
    });
    expect(res.body.metrics.unmapped.bodyFat).toBe(1);
  });

  it('counts metrics toward the per-request record cap', async () => {
    const { token } = await createUser();
    await connect(token, { enabledTypes: ['steps'] });
    const many = Array.from({ length: 501 }, (_, i) => ({
      type: 'steps', id: `s${i}`, time: '2026-05-01T06:00:00.000Z', value: 100,
    }));
    expect((await request(app).post('/api/health/sync').set(authHeader(token)).send({ metrics: many })).status).toBe(413);
  });
});

describe('GET /api/health/activities', () => {
  it('hides superseded sessions by default and shows them on request', async () => {
    const { token, user } = await createUser();
    await connect(token);
    await HealthActivity.create({
      userId: user._id, healthId: 'visible', exerciseType: 'EXERCISE_TYPE_RUNNING',
      startDate: new Date('2026-05-01T08:00:00Z'), endDate: new Date('2026-05-01T09:00:00Z'),
    });
    await HealthActivity.create({
      userId: user._id, healthId: 'hidden', exerciseType: 'EXERCISE_TYPE_RUNNING',
      startDate: new Date('2026-05-02T08:00:00Z'), endDate: new Date('2026-05-02T09:00:00Z'),
      canonical: false,
    });

    const plain = await request(app).get('/api/health/activities').set(authHeader(token));
    expect(plain.body.length).toBe(1);

    const all = await request(app)
      .get('/api/health/activities?includeSuperseded=true').set(authHeader(token));
    expect(all.body.length).toBe(2);
  });

  it('filters by date range', async () => {
    const { token, user } = await createUser();
    await connect(token);
    await HealthActivity.create({
      userId: user._id, healthId: 'may', exerciseType: 'EXERCISE_TYPE_RUNNING',
      startDate: new Date('2026-05-01T08:00:00Z'), endDate: new Date('2026-05-01T09:00:00Z'),
    });

    const res = await request(app)
      .get('/api/health/activities?startDate=2026-06-01&endDate=2026-06-30')
      .set(authHeader(token));
    expect(res.body.length).toBe(0);
  });
});

describe('DELETE /api/health/connect', () => {
  it('disconnects but keeps the imported data', async () => {
    const { token, user } = await createUser();
    await connect(token);
    await request(app).post('/api/health/sync').set(authHeader(token))
      .send({ activities: [session()] });

    const res = await request(app).delete('/api/health/connect').set(authHeader(token));

    expect(res.status).toBe(200);
    expect(await HealthConnection.countDocuments({ userId: user._id })).toBe(0);
    expect(await HealthActivity.countDocuments({ userId: user._id })).toBe(1);
  });

  it('purges the synced sessions on request', async () => {
    const { token, user } = await createUser();
    await connect(token);
    await request(app).post('/api/health/sync').set(authHeader(token))
      .send({ activities: [session()] });

    const res = await request(app).delete('/api/health/connect?purge=true').set(authHeader(token));

    expect(res.body.removed).toBe(1);
    expect(await HealthActivity.countDocuments({ userId: user._id })).toBe(0);
  });
});

describe('optional field handling', () => {
  it('stores a session that carries nothing but an id and its interval', async () => {
    const { token, user } = await createUser();
    await connect(token);

    const res = await request(app).post('/api/health/sync').set(authHeader(token)).send({
      activities: [{
        id: 'bare',
        startTime: '2026-05-01T08:00:00.000Z',
        endTime: '2026-05-01T08:30:00.000Z',
      }],
    });

    expect(res.status).toBe(200);
    const stored = await HealthActivity.findOne({ userId: user._id });
    expect(stored.distance).toBe(0);
    expect(stored.totalElevationGain).toBe(0);
    expect(stored.dataOrigin).toBe('');
    expect(stored.title).toBe('');
    // No distance means no derivable speed.
    expect(stored.averageSpeed).toBeUndefined();
    expect(stored.sportType).toBe('other');
    // Without an active duration the wall-clock interval is the moving time.
    expect(stored.movingTime).toBe(1800);
  });

  it('stores every optional field when the record carries them', async () => {
    const { token, user } = await createUser();
    await connect(token);

    await request(app).post('/api/health/sync').set(authHeader(token)).send({
      activities: [session({
        startTimeLocal: '2026-05-01T10:00:00.000Z',
        zoneOffset: '+02:00',
        lastModifiedTime: '2026-05-02T10:00:00.000Z',
        steps: 9000,
        activeEnergyKcal: 640,
        elevationGainMeters: 120,
      })],
    });

    const stored = await HealthActivity.findOne({ userId: user._id });
    expect(stored.steps).toBe(9000);
    expect(stored.activeCalories).toBe(640);
    expect(stored.totalElevationGain).toBe(120);
    expect(stored.timezone).toBe('+02:00');
    expect(stored.lastModifiedTime).toBeTruthy();
    expect(new Date(stored.startDateLocal).toISOString()).toBe('2026-05-01T10:00:00.000Z');
  });

  it('honours and caps the activity list limit', async () => {
    const { token, user } = await createUser();
    await connect(token);
    for (let i = 0; i < 3; i++) {
      await HealthActivity.create({
        userId: user._id, healthId: `a-${i}`, exerciseType: 'EXERCISE_TYPE_RUNNING',
        startDate: new Date(`2026-05-0${i + 1}T08:00:00Z`),
        endDate: new Date(`2026-05-0${i + 1}T09:00:00Z`),
      });
    }

    expect((await request(app).get('/api/health/activities?limit=1')
      .set(authHeader(token))).body.length).toBe(1);
    expect((await request(app).get('/api/health/activities?limit=99999')
      .set(authHeader(token))).body.length).toBe(3);
    expect((await request(app).get('/api/health/activities?limit=abc')
      .set(authHeader(token))).body.length).toBe(3);
  });

  it('filters by a start date alone', async () => {
    const { token, user } = await createUser();
    await connect(token);
    await HealthActivity.create({
      userId: user._id, healthId: 'later', exerciseType: 'EXERCISE_TYPE_RUNNING',
      startDate: new Date('2026-05-10T08:00:00Z'), endDate: new Date('2026-05-10T09:00:00Z'),
    });

    expect((await request(app).get('/api/health/activities?startDate=2026-05-01')
      .set(authHeader(token))).body.length).toBe(1);
    expect((await request(app).get('/api/health/activities?endDate=2026-05-01')
      .set(authHeader(token))).body.length).toBe(0);
  });

  it('connects with the default types when none are given', async () => {
    const { token } = await createUser();
    const res = await request(app).post('/api/health/connect').set(authHeader(token))
      .send({ deviceId: 'd' });

    expect(res.status).toBe(201);
    expect(res.body.enabledTypes).toEqual(['exercise', 'weight']);
    expect(res.body.deviceName).toBe('');
    expect(res.body.backfillDays).toBe(30);
  });

  it('keeps the stored types when an update sends none', async () => {
    const { token } = await createUser();
    await connect(token, { enabledTypes: ['exercise'] });

    const res = await request(app).put('/api/health/config').set(authHeader(token))
      .send({ backfillDays: 45 });
    expect(res.body.enabledTypes).toEqual(['exercise']);
  });

  it('keeps the stored types when an update sends only unknown ones', async () => {
    const { token } = await createUser();
    await connect(token, { enabledTypes: ['exercise'] });

    const res = await request(app).put('/api/health/config').set(authHeader(token))
      .send({ enabledTypes: ['telepathy'] });
    expect(res.body.enabledTypes).toEqual(['exercise']);
  });
});

describe('non-array payloads', () => {
  it('treats missing activity and weight lists as empty', async () => {
    const { token } = await createUser();
    await connect(token);

    const res = await request(app).post('/api/health/sync').set(authHeader(token))
      .send({ activities: 'nope', weights: 'nope' });

    expect(res.status).toBe(200);
    expect(res.body.activities).toBe(0);
    expect(res.body.weights.imported).toBe(0);
  });
});

// Every handler reports storage failures instead of hanging the request.
describe('error handling', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('500s when the configuration cannot be read', async () => {
    const { token } = await createUser();
    jest.spyOn(HealthConnection, 'findOne').mockRejectedValue(new Error('db weg'));

    const res = await request(app).get('/api/health/config').set(authHeader(token));
    expect(res.status).toBe(500);
  });

  it('400s when the connection cannot be stored', async () => {
    const { token } = await createUser();
    jest.spyOn(HealthConnection, 'findOneAndUpdate').mockRejectedValue(new Error('db weg'));

    expect((await connect(token)).status).toBe(400);
  });

  it('400s when the configuration cannot be saved', async () => {
    const { token } = await createUser();
    jest.spyOn(HealthConnection, 'findOne').mockResolvedValue({
      enabledTypes: ['exercise'],
      save: () => { throw new Error('db weg'); },
    });

    const res = await request(app).put('/api/health/config').set(authHeader(token))
      .send({ backfillDays: 30 });
    expect(res.status).toBe(400);
  });

  it('400s when an uploaded session cannot be stored', async () => {
    const { token } = await createUser();
    await connect(token);
    jest.spyOn(HealthActivity, 'updateOne').mockRejectedValue(new Error('db weg'));

    const res = await request(app).post('/api/health/sync').set(authHeader(token))
      .send({ activities: [session()] });
    expect(res.status).toBe(400);
  });

  it('500s when the activity list cannot be read', async () => {
    const { token } = await createUser();
    await connect(token);
    jest.spyOn(HealthActivity, 'find').mockImplementation(() => { throw new Error('db weg'); });

    const res = await request(app).get('/api/health/activities').set(authHeader(token));
    expect(res.status).toBe(500);
  });

  it('500s when disconnecting fails', async () => {
    const { token } = await createUser();
    await connect(token);
    jest.spyOn(HealthConnection, 'deleteOne').mockRejectedValue(new Error('db weg'));

    const res = await request(app).delete('/api/health/connect').set(authHeader(token));
    expect(res.status).toBe(500);
  });
});
