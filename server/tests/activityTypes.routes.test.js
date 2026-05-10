const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createUser, authHeader } = require('./helpers/testApp');
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

describe('GET /api/activity-types', () => {
  it('seeds default activity types on first call', async () => {
    const { token } = await createUser();
    const res = await request(app).get('/api/activity-types').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.some(t => t.label === 'Joggen')).toBe(true);
    expect(res.body.some(t => t.label === 'Gym')).toBe(true);
  });

  it('does not seed defaults when types already exist', async () => {
    const { token, user } = await createUser();
    await ActivityType.create({ userId: user._id, label: 'Custom Sport', version: 1, nameHistory: [] });

    const res = await request(app).get('/api/activity-types').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].label).toBe('Custom Sport');
  });

  it('returns only types belonging to the current user', async () => {
    const { token, user } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    await ActivityType.create({ userId: user._id, label: 'My Sport', version: 1, nameHistory: [] });
    await ActivityType.create({ userId: other._id, label: 'Other Sport', version: 1, nameHistory: [] });

    const res = await request(app).get('/api/activity-types').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.some(t => t.label === 'My Sport')).toBe(true);
    expect(res.body.some(t => t.label === 'Other Sport')).toBe(false);
  });
});

describe('POST /api/activity-types', () => {
  it('creates a new activity type', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .post('/api/activity-types')
      .set(authHeader(token))
      .send({ label: 'Klettern', showDistance: false, showDuration: true, customFields: [] });
    expect(res.status).toBe(201);
    expect(res.body.label).toBe('Klettern');
  });

  it('creates an activity type with custom fields', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .post('/api/activity-types')
      .set(authHeader(token))
      .send({
        label: 'Gym',
        showDuration: true,
        customFields: [{ key: 'plan', label: 'Plan', type: 'select', options: ['Push', 'Pull'] }]
      });
    expect(res.status).toBe(201);
    expect(res.body.customFields.length).toBe(1);
    expect(res.body.customFields[0].label).toBe('Plan');
  });
});

describe('PUT /api/activity-types/:id', () => {
  it('updates label and bumps version when label changes', async () => {
    const { token, user } = await createUser();
    const type = await ActivityType.create({ userId: user._id, label: 'Old Label', version: 1, nameHistory: [] });

    const res = await request(app)
      .put(`/api/activity-types/${type._id}`)
      .set(authHeader(token))
      .send({ label: 'New Label', customFields: [] });
    expect(res.status).toBe(200);
    expect(res.body.label).toBe('New Label');
    expect(res.body.version).toBe(2);
  });

  it('does not bump version when label and fields are unchanged', async () => {
    const { token, user } = await createUser();
    const type = await ActivityType.create({ userId: user._id, label: 'Joggen', showDistance: true, customFields: [], version: 1, nameHistory: [] });

    const res = await request(app)
      .put(`/api/activity-types/${type._id}`)
      .set(authHeader(token))
      .send({ label: 'Joggen', showDuration: true });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
  });

  it('bumps version when custom fields change', async () => {
    const { token, user } = await createUser();
    const type = await ActivityType.create({
      userId: user._id, label: 'Gym', customFields: [], version: 1, nameHistory: []
    });

    const res = await request(app)
      .put(`/api/activity-types/${type._id}`)
      .set(authHeader(token))
      .send({
        label: 'Gym',
        customFields: [{ key: 'plan', label: 'Plan', type: 'select', options: ['Push'] }]
      });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
  });

  it('returns 404 when type belongs to another user', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    const type = await ActivityType.create({ userId: other._id, label: 'Other Type', version: 1, nameHistory: [] });

    const res = await request(app)
      .put(`/api/activity-types/${type._id}`)
      .set(authHeader(token))
      .send({ label: 'Hacked' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/activity-types/:id', () => {
  it('deletes an activity type owned by the user', async () => {
    const { token, user } = await createUser();
    const type = await ActivityType.create({ userId: user._id, label: 'To Delete', version: 1, nameHistory: [] });

    const res = await request(app)
      .delete(`/api/activity-types/${type._id}`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('does not delete an activity type owned by another user', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    const type = await ActivityType.create({ userId: other._id, label: 'Other Type', version: 1, nameHistory: [] });

    const res = await request(app)
      .delete(`/api/activity-types/${type._id}`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    const stillExists = await ActivityType.findById(type._id);
    expect(stillExists).not.toBeNull();
  });
});
