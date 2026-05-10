const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createUser, authHeader } = require('./helpers/testApp');
const WeightLog = require('../models/WeightLog');

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

describe('GET /api/weight', () => {
  it('returns weight logs for the current user sorted by date ascending', async () => {
    const { token, user } = await createUser();
    await WeightLog.create({ userId: user._id, date: new Date('2024-01-02'), weight: 80, unit: 'kg' });
    await WeightLog.create({ userId: user._id, date: new Date('2024-01-01'), weight: 81, unit: 'kg' });

    const res = await request(app).get('/api/weight').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(new Date(res.body[0].date) <= new Date(res.body[1].date)).toBe(true);
  });

  it('does not return weight logs from another user', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    await WeightLog.create({ userId: other._id, date: new Date(), weight: 70, unit: 'kg' });

    const res = await request(app).get('/api/weight').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });

  it('filters by date range', async () => {
    const { token, user } = await createUser();
    await WeightLog.create({ userId: user._id, date: new Date('2024-01-05'), weight: 80, unit: 'kg' });
    await WeightLog.create({ userId: user._id, date: new Date('2024-02-05'), weight: 79, unit: 'kg' });

    const res = await request(app)
      .get('/api/weight?startDate=2024-02-01&endDate=2024-03-01')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].weight).toBe(79);
  });
});

describe('POST /api/weight', () => {
  it('creates a weight log entry', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .post('/api/weight')
      .set(authHeader(token))
      .send({ date: '2024-01-15', weight: 78.5, unit: 'kg' });
    expect(res.status).toBe(201);
    expect(res.body.weight).toBe(78.5);
    expect(res.body.unit).toBe('kg');
  });

  it('uses the user\'s weightUnit as default when no unit is provided', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .post('/api/weight')
      .set(authHeader(token))
      .send({ date: '2024-01-15', weight: 175 });
    expect(res.status).toBe(201);
    expect(res.body.unit).toBeDefined();
  });
});

describe('DELETE /api/weight/:id', () => {
  it('deletes a weight log belonging to the user', async () => {
    const { token, user } = await createUser();
    const log = await WeightLog.create({ userId: user._id, date: new Date(), weight: 80, unit: 'kg' });

    const res = await request(app)
      .delete(`/api/weight/${log._id}`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('silently ignores deletion of another user\'s weight log', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    const log = await WeightLog.create({ userId: other._id, date: new Date(), weight: 80, unit: 'kg' });

    const res = await request(app)
      .delete(`/api/weight/${log._id}`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    const stillExists = await WeightLog.findById(log._id);
    expect(stillExists).not.toBeNull();
  });
});
