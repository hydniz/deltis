const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createUser, authHeader } = require('./helpers/testApp');
const StravaActivity = require('../models/StravaActivity');
const TrainingPlan = require('../models/TrainingPlan');
const Goal = require('../models/Goal');

let app;

beforeAll(async () => {
  await startDb();
  app = buildApp();
});

afterEach(async () => {
  await clearDb();
});

afterAll(async () => {
  await stopDb();
});

const ZONE2_CRITERIA = {
  strava: {
    operator: 'AND',
    rules: [
      { kind: 'sportType', values: ['Run', 'Ride', 'Swim'] },
      { kind: 'hrPercentInRange', minHr: 120, maxHr: 145, minPercent: 85 },
    ],
  },
};

async function createType(token, overrides = {}) {
  return request(app).post('/api/training-types').set(authHeader(token)).send({
    name: 'Zone 2',
    description: 'Ruhiges Ausdauertraining',
    criteria: ZONE2_CRITERIA,
    ...overrides,
  });
}

async function seedActivity(userId, overrides = {}) {
  return StravaActivity.create({
    userId,
    stravaId: Math.floor(Math.random() * 1e9),
    sportType: 'Run',
    type: 'Run',
    startDate: new Date('2026-07-15T06:00:00Z'),
    startDateLocal: new Date('2026-07-15T08:00:00Z'),
    movingTime: 1800,
    distance: 5000,
    streams: {
      heartrate: { data: Array(30).fill(130) },
      time: { data: Array.from({ length: 30 }, (_, i) => i) },
    },
    ...overrides,
  });
}

describe('training types CRUD', () => {
  it('creates, lists, updates and deletes a type', async () => {
    const { token } = await createUser();

    const created = await createType(token);
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Zone 2');
    expect(created.body.criteria.strava.rules).toHaveLength(2);

    const listed = await request(app).get('/api/training-types').set(authHeader(token));
    expect(listed.body).toHaveLength(1);

    const updated = await request(app)
      .put(`/api/training-types/${created.body._id}`)
      .set(authHeader(token))
      .send({ name: 'Zone 2 (locker)', criteria: ZONE2_CRITERIA });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Zone 2 (locker)');

    const deleted = await request(app)
      .delete(`/api/training-types/${created.body._id}`)
      .set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect((await request(app).get('/api/training-types').set(authHeader(token))).body).toHaveLength(0);
  });

  it('rejects empty names, unknown integrations and invalid trees', async () => {
    const { token } = await createUser();

    expect((await createType(token, { name: '  ' })).status).toBe(400);

    const unknown = await createType(token, { criteria: { garmin: { operator: 'AND', rules: [] } } });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toContain('garmin');

    const invalidTree = await createType(token, {
      criteria: { strava: { operator: 'NOPE', rules: [] } },
    });
    expect(invalidTree.status).toBe(400);
  });

  it('enforces unique names per user', async () => {
    const { token } = await createUser();
    await createType(token);
    const dup = await createType(token);
    expect(dup.status).toBe(409);
  });

  it('is scoped per user', async () => {
    const { token } = await createUser();
    const { token: otherToken } = await createUser({ name: 'Other' });
    await createType(token);
    const listed = await request(app).get('/api/training-types').set(authHeader(otherToken));
    expect(listed.body).toHaveLength(0);
  });

  it('refuses deletion while goals or planned trainings reference the type', async () => {
    const { token, user } = await createUser();
    const created = await createType(token);

    await TrainingPlan.create({
      userId: user._id,
      trainingTypeId: created.body._id,
      scheduledDate: new Date('2026-07-20'),
    });

    const blocked = await request(app)
      .delete(`/api/training-types/${created.body._id}`)
      .set(authHeader(token));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toContain('verwendet');
  });
});

describe('planned trainings (/api/planner/trainings)', () => {
  it('requires a training type or criteria', async () => {
    const { token } = await createUser();
    const res = await request(app).post('/api/planner/trainings').set(authHeader(token)).send({
      scheduledDate: '2026-07-15',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a foreign training type', async () => {
    const { token: otherToken } = await createUser({ name: 'Other' });
    const foreignType = await createType(otherToken);
    const { token } = await createUser();

    const res = await request(app).post('/api/planner/trainings').set(authHeader(token)).send({
      scheduledDate: '2026-07-15',
      trainingTypeId: foreignType.body._id,
    });
    expect(res.status).toBe(404);
  });

  it('computes fulfilment from matching activities on the same local day', async () => {
    const { token, user } = await createUser();
    const type = await createType(token);

    await request(app).post('/api/planner/trainings').set(authHeader(token)).send({
      scheduledDate: '2026-07-15',
      trainingTypeId: type.body._id,
      notes: 'Zone 2 am Mittwoch',
    });

    // Not fulfilled yet
    let listed = await request(app)
      .get('/api/planner/trainings?startDate=2026-07-13&endDate=2026-07-19')
      .set(authHeader(token));
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].completed).toBe(false);
    expect(listed.body[0].fulfilledBy).toBeNull();
    expect(listed.body[0].trainingTypeName).toBe('Zone 2');

    // Matching Zone-2 run on that local day → fulfilled
    await seedActivity(user._id);
    listed = await request(app)
      .get('/api/planner/trainings?startDate=2026-07-13&endDate=2026-07-19')
      .set(authHeader(token));
    expect(listed.body[0].completed).toBe(true);
    expect(listed.body[0].fulfilledBy.integration).toBe('strava');
    expect(listed.body[0].fulfilledBy.sportType).toBe('Run');
  });

  it('does not fulfil with a non-matching activity or a different day', async () => {
    const { token, user } = await createUser();
    const type = await createType(token);
    await request(app).post('/api/planner/trainings').set(authHeader(token)).send({
      scheduledDate: '2026-07-15',
      trainingTypeId: type.body._id,
    });

    // Hard run (HR 170) on the right day + easy run on the wrong day
    await seedActivity(user._id, {
      streams: { heartrate: { data: Array(30).fill(170) }, time: { data: Array.from({ length: 30 }, (_, i) => i) } },
    });
    await seedActivity(user._id, {
      startDate: new Date('2026-07-16T06:00:00Z'),
      startDateLocal: new Date('2026-07-16T08:00:00Z'),
    });

    const listed = await request(app)
      .get('/api/planner/trainings?startDate=2026-07-13&endDate=2026-07-19')
      .set(authHeader(token));
    expect(listed.body[0].completed).toBe(false);
  });

  it('supports ad-hoc criteria without a saved type', async () => {
    const { token, user } = await createUser();
    await request(app).post('/api/planner/trainings').set(authHeader(token)).send({
      scheduledDate: '2026-07-15',
      criteria: { strava: { operator: 'AND', rules: [{ kind: 'sportType', values: ['Ride'] }] } },
    });
    await seedActivity(user._id, { sportType: 'Ride', type: 'Ride' });

    const listed = await request(app)
      .get('/api/planner/trainings?startDate=2026-07-13&endDate=2026-07-19')
      .set(authHeader(token));
    expect(listed.body[0].completed).toBe(true);
    expect(listed.body[0].trainingTypeName).toBeNull();
  });

  it('moves and deletes planned trainings', async () => {
    const { token } = await createUser();
    const type = await createType(token);
    const created = await request(app).post('/api/planner/trainings').set(authHeader(token)).send({
      scheduledDate: '2026-07-15',
      trainingTypeId: type.body._id,
    });

    const moved = await request(app)
      .put(`/api/planner/trainings/${created.body._id}`)
      .set(authHeader(token))
      .send({ scheduledDate: '2026-07-16' });
    expect(moved.status).toBe(200);
    expect(moved.body.scheduledDate.slice(0, 10)).toBe('2026-07-16');

    const deleted = await request(app)
      .delete(`/api/planner/trainings/${created.body._id}`)
      .set(authHeader(token));
    expect(deleted.status).toBe(200);
  });

  it('is scoped per user', async () => {
    const { token } = await createUser();
    const type = await createType(token);
    await request(app).post('/api/planner/trainings').set(authHeader(token)).send({
      scheduledDate: '2026-07-15', trainingTypeId: type.body._id,
    });

    const { token: otherToken } = await createUser({ name: 'Other' });
    const listed = await request(app)
      .get('/api/planner/trainings?startDate=2026-07-13&endDate=2026-07-19')
      .set(authHeader(otherToken));
    expect(listed.body).toHaveLength(0);
  });
});

describe('training plan names, manual completion and multi-match', () => {
  const RIDE_CRITERIA = { strava: { operator: 'AND', rules: [{ kind: 'sportType', values: ['Ride'] }] } };
  const listWeek = (token) => request(app)
    .get('/api/planner/trainings?startDate=2026-07-13&endDate=2026-07-19')
    .set(authHeader(token));

  it('stores a custom name for ad-hoc plans and returns it', async () => {
    const { token } = await createUser();
    const created = await request(app).post('/api/planner/trainings').set(authHeader(token)).send({
      scheduledDate: '2026-07-15',
      criteria: RIDE_CRITERIA,
      name: 'Intervalle',
    });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Intervalle');

    const listed = await listWeek(token);
    expect(listed.body[0].name).toBe('Intervalle');

    const renamed = await request(app)
      .put(`/api/planner/trainings/${created.body._id}`)
      .set(authHeader(token))
      .send({ name: 'Longrun' });
    expect(renamed.body.name).toBe('Longrun');
  });

  it('toggles manual completion independent of synced activities', async () => {
    const { token } = await createUser();
    const type = await createType(token);
    const created = await request(app).post('/api/planner/trainings').set(authHeader(token)).send({
      scheduledDate: '2026-07-15', trainingTypeId: type.body._id,
    });

    let listed = await listWeek(token);
    expect(listed.body[0].completed).toBe(false);

    await request(app)
      .put(`/api/planner/trainings/${created.body._id}`)
      .set(authHeader(token))
      .send({ completed: true });
    listed = await listWeek(token);
    expect(listed.body[0].completed).toBe(true);
    expect(listed.body[0].manualCompleted).toBe(true);
    expect(listed.body[0].autoCompleted).toBe(false);
    expect(listed.body[0].fulfilledBy).toBeNull();

    await request(app)
      .put(`/api/planner/trainings/${created.body._id}`)
      .set(authHeader(token))
      .send({ completed: false });
    listed = await listWeek(token);
    expect(listed.body[0].completed).toBe(false);
  });

  it('assigns matching activities disjointly across plans of the same day', async () => {
    const { token, user } = await createUser();
    const type = await createType(token);
    await request(app).post('/api/planner/trainings').set(authHeader(token)).send({
      scheduledDate: '2026-07-15', trainingTypeId: type.body._id,
    });
    await request(app).post('/api/planner/trainings').set(authHeader(token)).send({
      scheduledDate: '2026-07-15', trainingTypeId: type.body._id,
    });

    // One matching run → only the first plan is fulfilled
    await seedActivity(user._id);
    let listed = await listWeek(token);
    expect(listed.body).toHaveLength(2);
    expect(listed.body.filter(p => p.completed)).toHaveLength(1);

    // A second matching run → both plans fulfilled, each by its own activity
    await seedActivity(user._id, {
      startDate: new Date('2026-07-15T16:00:00Z'),
      startDateLocal: new Date('2026-07-15T18:00:00Z'),
    });
    listed = await listWeek(token);
    expect(listed.body.filter(p => p.completed)).toHaveLength(2);
    const ids = listed.body.map(p => p.fulfilledBy.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('attaches every matching activity of the day to the plan', async () => {
    const { token, user } = await createUser();
    const type = await createType(token);
    await request(app).post('/api/planner/trainings').set(authHeader(token)).send({
      scheduledDate: '2026-07-15', trainingTypeId: type.body._id,
    });

    await seedActivity(user._id);
    await seedActivity(user._id, {
      startDate: new Date('2026-07-15T16:00:00Z'),
      startDateLocal: new Date('2026-07-15T18:00:00Z'),
    });

    const listed = await listWeek(token);
    expect(listed.body[0].matchedActivities).toHaveLength(2);
    expect(listed.body[0].autoCompleted).toBe(true);
    // Sorted by date — the primary fulfiller is the earliest one
    expect(listed.body[0].fulfilledBy.id).toBe(listed.body[0].matchedActivities[0].id);
  });

  it('copies trainings with copy-week idempotently', async () => {
    const { token } = await createUser();
    await request(app).post('/api/planner/trainings').set(authHeader(token)).send({
      scheduledDate: '2026-07-15',
      criteria: RIDE_CRITERIA,
      name: 'Intervalle',
      notes: 'kurz und knackig',
    });

    const first = await request(app).post('/api/planner/copy-week').set(authHeader(token)).send({
      sourceStart: '2026-07-13', targetStart: '2026-07-20',
    });
    expect(first.status).toBe(201);
    expect(first.body.copiedTrainings).toBe(1);

    const second = await request(app).post('/api/planner/copy-week').set(authHeader(token)).send({
      sourceStart: '2026-07-13', targetStart: '2026-07-20',
    });
    expect(second.body.copiedTrainings).toBe(0);
    expect(second.body.skipped).toBeGreaterThan(0);

    const copied = await request(app)
      .get('/api/planner/trainings?startDate=2026-07-20&endDate=2026-07-26')
      .set(authHeader(token));
    expect(copied.body).toHaveLength(1);
    expect(copied.body[0].name).toBe('Intervalle');
    expect(copied.body[0].scheduledDate.slice(0, 10)).toBe('2026-07-22');
  });
});

describe('goals with training types', () => {
  it('uses the referenced type for progress and enriches the target name', async () => {
    const { token, user } = await createUser();
    const type = await createType(token);

    const goal = await request(app).post('/api/goals').set(authHeader(token)).send({
      name: '3× Zone 2 pro Woche',
      type: 'periodic-strava',
      intervalValue: 1,
      intervalUnit: 'week',
      targetRef: 'strava',
      targetRefModel: 'StravaActivity',
      condition: 'min',
      targetValue: 1,
      metric: 'count',
      trainingTypeId: type.body._id,
    });
    expect(goal.status).toBe(201);
    expect(goal.body.targetName).toBe('Zone 2');
    expect(goal.body.trainingTypeName).toBe('Zone 2');

    // Zone-2 run this week → counts; hard run → does not
    await seedActivity(user._id, { startDate: new Date(), startDateLocal: new Date() });
    await seedActivity(user._id, {
      startDate: new Date(),
      startDateLocal: new Date(),
      streams: { heartrate: { data: Array(30).fill(175) }, time: { data: Array.from({ length: 30 }, (_, i) => i) } },
    });

    const progress = await request(app)
      .get(`/api/goals/${goal.body._id}/progress`)
      .set(authHeader(token));
    expect(progress.body.conditions[0].currentValue).toBe(1);
    expect(progress.body.met).toBe(true);
  });

  it('rejects a foreign or unknown training type on the goal', async () => {
    const { token: otherToken } = await createUser({ name: 'Other' });
    const foreignType = await createType(otherToken);
    const { token } = await createUser();

    const res = await request(app).post('/api/goals').set(authHeader(token)).send({
      name: 'X', type: 'periodic-strava', targetRef: 'strava', targetRefModel: 'StravaActivity',
      condition: 'min', targetValue: 1, metric: 'count',
      trainingTypeId: foreignType.body._id,
    });
    expect(res.status).toBe(404);
  });
});
