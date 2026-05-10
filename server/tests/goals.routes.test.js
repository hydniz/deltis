const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createUser, authHeader } = require('./helpers/testApp');
const Goal = require('../models/Goal');
const ActivityType = require('../models/ActivityType');
const ActivityLog = require('../models/ActivityLog');

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

async function createActivityType(userId) {
  return ActivityType.create({ userId, label: 'Joggen', showDistance: true, showDuration: true, customFields: [], version: 1, nameHistory: [] });
}

async function createGoal(userId, actTypeId, overrides = {}) {
  return Goal.create({
    userId,
    name: 'Run 5 times',
    type: 'periodic-activity',
    targetRef: actTypeId,
    targetRefModel: 'ActivityType',
    condition: 'min',
    targetValue: 5,
    metric: 'count',
    intervalValue: 1,
    intervalUnit: 'week',
    isActive: true,
    ...overrides,
  });
}

describe('GET /api/goals', () => {
  it('returns active goals for the current user', async () => {
    const { token, user } = await createUser();
    const type = await createActivityType(user._id);
    await createGoal(user._id, type._id, { name: 'Goal 1' });
    await createGoal(user._id, type._id, { name: 'Goal 2', isActive: false });

    const res = await request(app).get('/api/goals').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].name).toBe('Goal 1');
  });

  it('does not return goals from another user', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    const type = await createActivityType(other._id);
    await createGoal(other._id, type._id, { name: 'Other Goal' });

    const res = await request(app).get('/api/goals').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });

  it('enriches goals with targetName', async () => {
    const { token, user } = await createUser();
    const type = await createActivityType(user._id);
    await createGoal(user._id, type._id);

    const res = await request(app).get('/api/goals').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body[0].targetName).toBe('Joggen');
  });
});

describe('POST /api/goals', () => {
  it('creates a new goal', async () => {
    const { token, user } = await createUser();
    const type = await createActivityType(user._id);

    const res = await request(app)
      .post('/api/goals')
      .set(authHeader(token))
      .send({
        name: 'New Goal',
        type: 'periodic-activity',
        targetRef: type._id,
        targetRefModel: 'ActivityType',
        condition: 'min',
        targetValue: 3,
        metric: 'count',
        intervalValue: 1,
        intervalUnit: 'week',
      });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('New Goal');
    expect(res.body.targetName).toBe('Joggen');
  });

  it('returns 400 for an invalid goal payload', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .post('/api/goals')
      .set(authHeader(token))
      .send({ name: 'Incomplete Goal' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/goals/:id', () => {
  it('updates an existing goal', async () => {
    const { token, user } = await createUser();
    const type = await createActivityType(user._id);
    const goal = await createGoal(user._id, type._id);

    const res = await request(app)
      .put(`/api/goals/${goal._id}`)
      .set(authHeader(token))
      .send({ name: 'Updated Goal', targetValue: 10, condition: 'min', type: 'periodic-activity', targetRef: type._id, targetRefModel: 'ActivityType' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Goal');
    expect(res.body.targetValue).toBe(10);
  });

  it('returns 404 when goal belongs to another user', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    const type = await createActivityType(other._id);
    const goal = await createGoal(other._id, type._id);

    const res = await request(app)
      .put(`/api/goals/${goal._id}`)
      .set(authHeader(token))
      .send({ name: 'Hacked' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/goals/:id', () => {
  it('deletes a goal owned by the user', async () => {
    const { token, user } = await createUser();
    const type = await createActivityType(user._id);
    const goal = await createGoal(user._id, type._id);

    const res = await request(app)
      .delete(`/api/goals/${goal._id}`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const gone = await Goal.findById(goal._id);
    expect(gone).toBeNull();
  });
});

describe('GET /api/goals/:id/progress', () => {
  it('returns progress data for a periodic goal', async () => {
    const { token, user } = await createUser();
    const type = await createActivityType(user._id);
    const goal = await createGoal(user._id, type._id, { targetValue: 2 });

    await ActivityLog.create({ userId: user._id, activityType: 'Joggen', activityTypeRef: type._id, date: new Date(), duration: 30 });

    const res = await request(app)
      .get(`/api/goals/${goal._id}/progress`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.conditions).toBeDefined();
    expect(res.body.met).toBeDefined();
    expect(typeof res.body.conditions[0].currentValue).toBe('number');
  });

  it('returns 404 for a non-existent goal', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .get('/api/goals/507f1f77bcf86cd799439011/progress')
      .set(authHeader(token));
    expect(res.status).toBe(404);
  });
});
