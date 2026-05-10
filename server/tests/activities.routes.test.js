const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createUser, authHeader } = require('./helpers/testApp');
const ActivityLog = require('../models/ActivityLog');
const ActivityType = require('../models/ActivityType');

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

async function createActivityType(userId, label = 'Joggen') {
  return ActivityType.create({ userId, label, showDistance: true, showDuration: true, customFields: [], version: 1, nameHistory: [] });
}

describe('GET /api/activities', () => {
  it('returns activities for the current user', async () => {
    const { token, user } = await createUser();
    await ActivityLog.create({ userId: user._id, activityType: 'Joggen', date: new Date(), duration: 30 });

    const res = await request(app).get('/api/activities').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.activities.length).toBe(1);
    expect(res.body.total).toBe(1);
  });

  it('does not return activities from another user', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    await ActivityLog.create({ userId: other._id, activityType: 'Radfahren', date: new Date(), duration: 60 });

    const res = await request(app).get('/api/activities').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.activities.length).toBe(0);
  });

  it('filters activities by date range', async () => {
    const { token, user } = await createUser();
    await ActivityLog.create({ userId: user._id, activityType: 'Joggen', date: new Date('2024-01-01'), duration: 20 });
    await ActivityLog.create({ userId: user._id, activityType: 'Joggen', date: new Date('2024-03-01'), duration: 40 });

    const res = await request(app)
      .get('/api/activities?startDate=2024-02-01&endDate=2024-04-01')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.activities.length).toBe(1);
    expect(res.body.activities[0].duration).toBe(40);
  });

  it('supports pagination via limit and skip', async () => {
    const { token, user } = await createUser();
    for (let i = 0; i < 5; i++) {
      await ActivityLog.create({ userId: user._id, activityType: 'Joggen', date: new Date(), duration: i + 1 });
    }
    const res = await request(app)
      .get('/api/activities?limit=2&skip=0')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.activities.length).toBe(2);
    expect(res.body.total).toBe(5);
  });
});

describe('POST /api/activities', () => {
  it('creates an activity log entry', async () => {
    const { token, user } = await createUser();
    const type = await createActivityType(user._id);

    const res = await request(app)
      .post('/api/activities')
      .set(authHeader(token))
      .send({ activityType: 'Joggen', activityTypeRef: type._id, date: '2024-01-15', duration: 45, distance: 7.5 });
    expect(res.status).toBe(201);
    expect(res.body.activityType).toBe('Joggen');
    expect(res.body.duration).toBe(45);
    expect(res.body.distance).toBe(7.5);
  });

  it('creates an activity without optional fields', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .post('/api/activities')
      .set(authHeader(token))
      .send({ activityType: 'Yoga', date: '2024-01-15' });
    expect(res.status).toBe(201);
    expect(res.body.activityType).toBe('Yoga');
  });
});

describe('PUT /api/activities/:id', () => {
  it('updates an existing activity', async () => {
    const { token, user } = await createUser();
    const activity = await ActivityLog.create({ userId: user._id, activityType: 'Joggen', date: new Date(), duration: 30 });

    const res = await request(app)
      .put(`/api/activities/${activity._id}`)
      .set(authHeader(token))
      .send({ duration: 60, notes: 'Felt great' });
    expect(res.status).toBe(200);
    expect(res.body.duration).toBe(60);
    expect(res.body.notes).toBe('Felt great');
  });

  it('returns 404 when activity belongs to another user', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    const activity = await ActivityLog.create({ userId: other._id, activityType: 'Joggen', date: new Date(), duration: 30 });

    const res = await request(app)
      .put(`/api/activities/${activity._id}`)
      .set(authHeader(token))
      .send({ duration: 99 });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/activities/:id', () => {
  it('deletes an activity owned by the user', async () => {
    const { token, user } = await createUser();
    const activity = await ActivityLog.create({ userId: user._id, activityType: 'Yoga', date: new Date(), duration: 20 });

    const res = await request(app)
      .delete(`/api/activities/${activity._id}`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 when activity belongs to another user', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    const activity = await ActivityLog.create({ userId: other._id, activityType: 'Yoga', date: new Date(), duration: 20 });

    const res = await request(app)
      .delete(`/api/activities/${activity._id}`)
      .set(authHeader(token));
    expect(res.status).toBe(404);
  });
});
