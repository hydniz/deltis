const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createUser, authHeader } = require('./helpers/testApp');
const Goal = require('../models/Goal');
const ActivityLog = require('../models/ActivityLog');
const ActivityType = require('../models/ActivityType');
const HabitDefinition = require('../models/HabitDefinition');
const HabitLog = require('../models/HabitLog');
const StravaActivity = require('../models/StravaActivity');

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

async function createStravaGoal(token, overrides = {}) {
  const res = await request(app).post('/api/goals').set(authHeader(token)).send({
    name: '3× Cardio',
    type: 'periodic-strava',
    intervalValue: 1,
    intervalUnit: 'week',
    targetRef: 'strava',
    targetRefModel: 'StravaActivity',
    condition: 'min',
    targetValue: 1,
    metric: 'count',
    stravaCriteria: { operator: 'AND', rules: [{ kind: 'sportType', values: ['Run'] }] },
    ...overrides,
  });
  return res.body;
}

async function createMetaGoal(token, childGoalIds, overrides = {}) {
  return request(app).post('/api/goals').set(authHeader(token)).send({
    name: 'Trainingswoche',
    type: 'meta',
    targetValue: 1,
    childGoalIds,
    ...overrides,
  });
}

async function seedRun(userId, overrides = {}) {
  return StravaActivity.create({
    userId,
    stravaId: Math.floor(Math.random() * 1e9),
    sportType: 'Run',
    type: 'Run',
    startDate: new Date(),
    startDateLocal: new Date(),
    movingTime: 1800,
    distance: 5000,
    ...overrides,
  });
}

describe('meta goals — creation and hierarchy', () => {
  it('creates a meta goal with children and enriches both directions', async () => {
    const { token } = await createUser();
    const childA = await createStravaGoal(token, { name: 'Cardio' });
    const childB = await createStravaGoal(token, { name: 'Radfahren', stravaCriteria: { operator: 'AND', rules: [{ kind: 'sportType', values: ['Ride'] }] } });

    const meta = await createMetaGoal(token, [childA._id, childB._id], { targetValue: 2 });
    expect(meta.status).toBe(201);
    expect(meta.body.type).toBe('meta');
    expect(meta.body.targetName).toBe('Gesamtziel');
    expect(meta.body.childGoals.map(c => c.name)).toEqual(['Cardio', 'Radfahren']);

    // Children now report their parent
    const goals = await request(app).get('/api/goals').set(authHeader(token));
    const child = goals.body.find(g => g.name === 'Cardio');
    expect(child.parentGoal.name).toBe('Trainingswoche');
  });

  it('enforces the single-parent rule', async () => {
    const { token } = await createUser();
    const child = await createStravaGoal(token);
    await createMetaGoal(token, [child._id]);

    const second = await createMetaGoal(token, [child._id], { name: 'Zweites Gesamtziel' });
    expect(second.status).toBe(400);
    expect(second.body.error).toContain('bereits Unterziel');
  });

  it('rejects meta goals as children and enforces child count vs targetValue', async () => {
    const { token } = await createUser();
    const child = await createStravaGoal(token);
    const meta = await createMetaGoal(token, [child._id]);

    const nested = await createMetaGoal(token, [meta.body._id], { name: 'Meta-Meta' });
    expect(nested.status).toBe(400);
    expect(nested.body.error).toContain('Gesamtziel');

    const child2 = await createStravaGoal(token, { name: 'Zweites' });
    const tooHigh = await createMetaGoal(token, [child2._id], { name: 'Zu hoch', targetValue: 3 });
    expect(tooHigh.status).toBe(400);

    const empty = await createMetaGoal(token, [], { name: 'Leer' });
    expect(empty.status).toBe(400);
  });

  it('rejects foreign goals as children', async () => {
    const { token: otherToken } = await createUser({ name: 'Other' });
    const foreign = await createStravaGoal(otherToken);
    const { token } = await createUser();

    const res = await createMetaGoal(token, [foreign._id]);
    expect(res.status).toBe(404);
  });

  it('updates the child set and frees removed children', async () => {
    const { token, user } = await createUser();
    const childA = await createStravaGoal(token, { name: 'A' });
    const childB = await createStravaGoal(token, { name: 'B' });
    const meta = await createMetaGoal(token, [childA._id, childB._id], { targetValue: 2 });

    const updated = await request(app)
      .put(`/api/goals/${meta.body._id}`)
      .set(authHeader(token))
      .send({ childGoalIds: [childA._id], targetValue: 1 });
    expect(updated.status).toBe(200);
    expect(updated.body.childGoals.map(c => c.name)).toEqual(['A']);

    const freed = await Goal.findById(childB._id);
    expect(freed.parentGoalId).toBeNull();
    expect(String((await Goal.findById(childA._id)).parentGoalId)).toBe(String(meta.body._id));
    expect(freed.userId.toString()).toBe(user._id.toString());
  });

  it('frees all children when the meta goal is deleted', async () => {
    const { token } = await createUser();
    const child = await createStravaGoal(token);
    const meta = await createMetaGoal(token, [child._id]);

    await request(app).delete(`/api/goals/${meta.body._id}`).set(authHeader(token));
    expect((await Goal.findById(child._id)).parentGoalId).toBeNull();
  });

  it('never switches a goal between meta and regular via update', async () => {
    const { token } = await createUser();
    const child = await createStravaGoal(token);
    const res = await request(app)
      .put(`/api/goals/${child._id}`)
      .set(authHeader(token))
      .send({ type: 'meta' });
    expect(res.status).toBe(400);
  });
});

describe('meta goals — progress', () => {
  it('counts met children and reports childResults', async () => {
    const { token, user } = await createUser();
    const runGoal = await createStravaGoal(token, { name: 'Laufen' });
    const rideGoal = await createStravaGoal(token, {
      name: 'Radfahren',
      stravaCriteria: { operator: 'AND', rules: [{ kind: 'sportType', values: ['Ride'] }] },
    });
    const meta = await createMetaGoal(token, [runGoal._id, rideGoal._id], { targetValue: 2 });

    await seedRun(user._id); // fulfils only the run goal

    let progress = await request(app).get(`/api/goals/${meta.body._id}/progress`).set(authHeader(token));
    expect(progress.status).toBe(200);
    expect(progress.body.conditions[0].currentValue).toBe(1);
    expect(progress.body.met).toBe(false);
    expect(progress.body.childResults).toHaveLength(2);
    const run = progress.body.childResults.find(c => c.name === 'Laufen');
    expect(run.met).toBe(true);
    // Compact preview data for the nested rendering in the meta card
    expect(run.currentValue).toBe(1);
    expect(run.targetValue).toBe(1);
    expect(progress.body.childResults.find(c => c.name === 'Radfahren').met).toBe(false);

    await seedRun(user._id, { sportType: 'Ride', type: 'Ride' });
    progress = await request(app).get(`/api/goals/${meta.body._id}/progress`).set(authHeader(token));
    expect(progress.body.conditions[0].currentValue).toBe(2);
    expect(progress.body.met).toBe(true);
  });

  it('supports "3 von 4" semantics', async () => {
    const { token, user } = await createUser();
    const sports = ['Run', 'Ride', 'Swim', 'Hike'];
    const children = [];
    for (const sport of sports) {
      children.push(await createStravaGoal(token, {
        name: sport,
        stravaCriteria: { operator: 'AND', rules: [{ kind: 'sportType', values: [sport] }] },
      }));
    }
    const meta = await createMetaGoal(token, children.map(c => c._id), { targetValue: 3 });

    for (const sport of ['Run', 'Ride', 'Swim']) {
      await seedRun(user._id, { sportType: sport, type: sport });
    }

    const progress = await request(app).get(`/api/goals/${meta.body._id}/progress`).set(authHeader(token));
    expect(progress.body.conditions[0].currentValue).toBe(3);
    expect(progress.body.conditions[0].targetValue).toBe(3);
    expect(progress.body.met).toBe(true);
  });
});

describe('GET /api/goals/:id/items — contribution breakdown', () => {
  it('lists matching Strava activities for Strava goals', async () => {
    const { token, user } = await createUser();
    const goal = await createStravaGoal(token);
    await seedRun(user._id, { name: 'Morgenlauf' });
    await seedRun(user._id, { sportType: 'Yoga', type: 'Yoga', name: 'Yoga' }); // no match

    const res = await request(app).get(`/api/goals/${goal._id}/items`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('strava');
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0]).toMatchObject({ integration: 'strava', name: 'Morgenlauf', sportType: 'Run' });
  });

  it('lists activity logs for activity goals', async () => {
    const { token, user } = await createUser();
    const type = await ActivityType.create({ userId: user._id, label: 'Joggen', version: 1, nameHistory: [] });
    await ActivityLog.create({ userId: user._id, activityType: 'Joggen', activityTypeRef: type._id, date: new Date(), duration: 30 });

    const goal = await request(app).post('/api/goals').set(authHeader(token)).send({
      name: 'Joggen', type: 'periodic-activity', targetRef: type._id, targetRefModel: 'ActivityType',
      condition: 'min', targetValue: 2, metric: 'count',
    });

    const res = await request(app).get(`/api/goals/${goal.body._id}/items`).set(authHeader(token));
    expect(res.body.kind).toBe('activity');
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0]).toMatchObject({ name: 'Joggen', duration: 30 });
  });

  it('lists habit logs for habit goals', async () => {
    const { token, user } = await createUser();
    const habit = await HabitDefinition.create({ userId: user._id, name: 'Wasser', unitSymbol: 'ml', type: 'amount' });
    await HabitLog.create({ userId: user._id, habitId: habit._id, date: new Date(), value: 500 });

    const goal = await request(app).post('/api/goals').set(authHeader(token)).send({
      name: 'Trinken', type: 'periodic-habit', targetRef: habit._id, targetRefModel: 'HabitDefinition',
      condition: 'min', targetValue: 2000, metric: 'value',
    });

    const res = await request(app).get(`/api/goals/${goal.body._id}/items`).set(authHeader(token));
    expect(res.body.kind).toBe('habit');
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].value).toBe(500);
  });

  it('lists child results for meta goals', async () => {
    const { token, user } = await createUser();
    const child = await createStravaGoal(token);
    const meta = await createMetaGoal(token, [child._id]);
    await seedRun(user._id);

    const res = await request(app).get(`/api/goals/${meta.body._id}/items`).set(authHeader(token));
    expect(res.body.kind).toBe('meta');
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0]).toMatchObject({ name: '3× Cardio', met: true });
  });

  it('is scoped to the owner', async () => {
    const { token } = await createUser();
    const goal = await createStravaGoal(token);
    const { token: otherToken } = await createUser({ name: 'Other' });

    const res = await request(app).get(`/api/goals/${goal._id}/items`).set(authHeader(otherToken));
    expect(res.status).toBe(404);
  });
});
