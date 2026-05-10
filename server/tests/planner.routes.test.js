const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createUser, authHeader } = require('./helpers/testApp');
const ActivityPlan = require('../models/ActivityPlan');
const HabitPlan = require('../models/HabitPlan');
const ActivityType = require('../models/ActivityType');
const HabitDefinition = require('../models/HabitDefinition');

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

// ─── Activity Plans ───────────────────────────────────────────────────────────

describe('GET /api/planner', () => {
  it('returns activity plans for the current user', async () => {
    const { token, user } = await createUser();
    await ActivityPlan.create({ userId: user._id, activityType: 'Joggen', scheduledDate: new Date('2024-01-15') });

    const res = await request(app).get('/api/planner').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].activityType).toBe('Joggen');
  });

  it('filters by date range', async () => {
    const { token, user } = await createUser();
    await ActivityPlan.create({ userId: user._id, activityType: 'Joggen', scheduledDate: new Date('2024-01-10') });
    await ActivityPlan.create({ userId: user._id, activityType: 'Yoga', scheduledDate: new Date('2024-02-10') });

    const res = await request(app)
      .get('/api/planner?startDate=2024-02-01&endDate=2024-03-01')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].activityType).toBe('Yoga');
  });

  it('does not return plans from another user', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    await ActivityPlan.create({ userId: other._id, activityType: 'Radfahren', scheduledDate: new Date() });

    const res = await request(app).get('/api/planner').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });
});

describe('POST /api/planner', () => {
  it('creates an activity plan', async () => {
    const { token, user } = await createUser();
    const type = await ActivityType.create({ userId: user._id, label: 'Joggen', version: 1, nameHistory: [] });

    const res = await request(app)
      .post('/api/planner')
      .set(authHeader(token))
      .send({ activityType: 'Joggen', activityTypeRef: type._id, scheduledDate: '2024-01-20', duration: 45 });
    expect(res.status).toBe(201);
    expect(res.body.activityType).toBe('Joggen');
    expect(res.body.duration).toBe(45);
  });
});

describe('PUT /api/planner/:id', () => {
  it('updates an activity plan', async () => {
    const { token, user } = await createUser();
    const plan = await ActivityPlan.create({ userId: user._id, activityType: 'Joggen', scheduledDate: new Date() });

    const res = await request(app)
      .put(`/api/planner/${plan._id}`)
      .set(authHeader(token))
      .send({ completed: true, duration: 60 });
    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(true);
  });

  it('returns 404 for a plan owned by another user', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    const plan = await ActivityPlan.create({ userId: other._id, activityType: 'Yoga', scheduledDate: new Date() });

    const res = await request(app)
      .put(`/api/planner/${plan._id}`)
      .set(authHeader(token))
      .send({ completed: true });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/planner/:id', () => {
  it('deletes an activity plan', async () => {
    const { token, user } = await createUser();
    const plan = await ActivityPlan.create({ userId: user._id, activityType: 'Joggen', scheduledDate: new Date() });

    const res = await request(app)
      .delete(`/api/planner/${plan._id}`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── Habit Plans ──────────────────────────────────────────────────────────────

describe('GET /api/planner/habits', () => {
  it('returns habit plans for the current user', async () => {
    const { token, user } = await createUser();
    const habit = await HabitDefinition.create({ userId: user._id, name: 'Water', unitSymbol: 'ml', type: 'amount', version: 1, nameHistory: [] });
    await HabitPlan.create({ userId: user._id, habitId: habit._id, habitName: 'Water', scheduledDate: new Date() });

    const res = await request(app).get('/api/planner/habits').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });
});

describe('POST /api/planner/habits', () => {
  it('creates a habit plan', async () => {
    const { token, user } = await createUser();
    const habit = await HabitDefinition.create({ userId: user._id, name: 'Water', unitSymbol: 'ml', type: 'amount', version: 1, nameHistory: [] });

    const res = await request(app)
      .post('/api/planner/habits')
      .set(authHeader(token))
      .send({ habitId: habit._id, scheduledDate: '2024-01-20' });
    expect(res.status).toBe(201);
    expect(res.body.habitName).toBe('Water');
  });
});

describe('POST /api/planner/habits/:id/complete', () => {
  it('marks a habit plan as completed and creates a HabitLog', async () => {
    const { token, user } = await createUser();
    const habit = await HabitDefinition.create({ userId: user._id, name: 'Water', unitSymbol: 'ml', type: 'amount', version: 1, nameHistory: [] });
    const plan = await HabitPlan.create({ userId: user._id, habitId: habit._id, habitName: 'Water', scheduledDate: new Date('2024-01-20') });

    const res = await request(app)
      .post(`/api/planner/habits/${plan._id}/complete`)
      .set(authHeader(token))
      .send({ value: 2000, date: '2024-01-20' });
    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(true);
    expect(res.body.loggedValue).toBe(2000);
  });

  it('returns 404 for a plan belonging to another user', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    const habit = await HabitDefinition.create({ userId: other._id, name: 'Sleep', unitSymbol: 'h', type: 'duration', version: 1, nameHistory: [] });
    const plan = await HabitPlan.create({ userId: other._id, habitId: habit._id, habitName: 'Sleep', scheduledDate: new Date() });

    const res = await request(app)
      .post(`/api/planner/habits/${plan._id}/complete`)
      .set(authHeader(token))
      .send({ value: 8 });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/planner/habits/:id', () => {
  it('updates a habit plan', async () => {
    const { token, user } = await createUser();
    const habit = await HabitDefinition.create({ userId: user._id, name: 'Water', unitSymbol: 'ml', type: 'amount', version: 1, nameHistory: [] });
    const plan = await HabitPlan.create({ userId: user._id, habitId: habit._id, habitName: 'Water', scheduledDate: new Date() });

    const res = await request(app)
      .put(`/api/planner/habits/${plan._id}`)
      .set(authHeader(token))
      .send({ notes: 'Updated note' });
    expect(res.status).toBe(200);
    expect(res.body.notes).toBe('Updated note');
  });
});

describe('DELETE /api/planner/habits/:id', () => {
  it('deletes a habit plan', async () => {
    const { token, user } = await createUser();
    const habit = await HabitDefinition.create({ userId: user._id, name: 'Water', unitSymbol: 'ml', type: 'amount', version: 1, nameHistory: [] });
    const plan = await HabitPlan.create({ userId: user._id, habitId: habit._id, habitName: 'Water', scheduledDate: new Date() });

    const res = await request(app)
      .delete(`/api/planner/habits/${plan._id}`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
