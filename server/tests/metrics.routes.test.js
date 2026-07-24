const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createUser, authHeader } = require('./helpers/testApp');
const MetricDefinition = require('../models/MetricDefinition');
const MetricLog = require('../models/MetricLog');

let app;
beforeAll(async () => { await startDb(); app = buildApp(); });
afterEach(async () => { await clearDb(); });
afterAll(async () => { await stopDb(); });

const create = (token, body) =>
  request(app).post('/api/metrics').set(authHeader(token)).send(body);

describe('POST /api/metrics', () => {
  it('creates a metric with a slug derived from the name', async () => {
    const { token, user } = await createUser();
    const res = await create(token, { name: 'Ruhepuls', unit: 'bpm', direction: 'down' });

    expect(res.status).toBe(201);
    expect(res.body.key).toBe('ruhepuls');
    expect(res.body.unit).toBe('bpm');
    expect(await MetricDefinition.countDocuments({ userId: user._id })).toBe(1);
  });

  it('transliterates umlauts in the slug', async () => {
    const { token } = await createUser();
    expect((await create(token, { name: 'Körpergröße' })).body.key).toBe('koerpergroesse');
  });

  it('makes the slug unique per user', async () => {
    const { token } = await createUser();
    await create(token, { name: 'Wasser' });
    expect((await create(token, { name: 'Wasser' })).body.key).toBe('wasser_2');
  });

  it('requires a name', async () => {
    const { token } = await createUser();
    expect((await create(token, { unit: 'x' })).status).toBe(400);
  });

  it('rejects an invalid value type and a bad min/max ordering', async () => {
    const { token } = await createUser();
    expect((await create(token, { name: 'X', valueType: 'nonsense' })).status).toBe(400);
    expect((await create(token, { name: 'Y', min: 10, max: 1 })).status).toBe(400);
  });

  it('accepts and stores every optional field', async () => {
    const { token } = await createUser();
    const res = await create(token, {
      name: 'Blutdruck', unit: 'mmHg', valueType: 'number', scaleMax: 10, decimals: 0,
      dayAggregation: 'last', aggregation: 'avg', direction: 'down', min: 40, max: 300,
      groupKey: 'blood_pressure', icon: 'Activity', color: 'rose', showOnDashboard: true,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      valueType: 'number', decimals: 0, dayAggregation: 'last', aggregation: 'avg',
      direction: 'down', min: 40, max: 300, groupKey: 'blood_pressure', showOnDashboard: true,
    });
  });

  it('honours an explicit key and coerces scale/decimals', async () => {
    const { token } = await createUser();
    const res = await create(token, {
      key: 'Mein Wert!', name: 'Stimmung', valueType: 'scale',
      scaleMax: 'zehn', decimals: 'zwei',
    });
    expect(res.body.key).toBe('mein_wert');
    expect(res.body.scaleMax).toBe(5);   // non-numeric → default
    expect(res.body.decimals).toBe(0);   // non-numeric → 0
  });

  it('clears min/max when explicitly set to null', async () => {
    const { token } = await createUser();
    const res = await create(token, { name: 'Frei', min: null, max: null });
    expect(res.body.min).toBeNull();
    expect(res.body.max).toBeNull();
  });

  it('rejects invalid aggregation, direction and non-numeric bounds', async () => {
    const { token } = await createUser();
    expect((await create(token, { name: 'A', aggregation: 'bogus' })).status).toBe(400);
    expect((await create(token, { name: 'B', direction: 'sideways' })).status).toBe(400);
    expect((await create(token, { name: 'C', min: 'tief' })).status).toBe(400);
  });
});

describe('GET /api/metrics', () => {
  it('lists metrics enriched with the latest value', async () => {
    const { token, user } = await createUser();
    const def = await MetricDefinition.create({ userId: user._id, key: 'rhr', name: 'Ruhepuls', dayAggregation: 'min' });
    await MetricLog.create({ userId: user._id, metricId: def._id, date: new Date('2026-05-01T06:00:00Z'), value: 55 });
    await MetricLog.create({ userId: user._id, metricId: def._id, date: new Date('2026-05-02T06:00:00Z'), value: 52 });

    const res = await request(app).get('/api/metrics').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body[0].latest.value).toBe(52);
    expect(res.body[0].count).toBe(2);
  });

  it('does not leak another user\'s metrics', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    await MetricDefinition.create({ userId: other._id, key: 'x', name: 'X' });
    expect((await request(app).get('/api/metrics').set(authHeader(token))).body.length).toBe(0);
  });

  it('computes todayValue from the day aggregation', async () => {
    const { token, user } = await createUser();
    const def = await MetricDefinition.create({ userId: user._id, key: 'water', name: 'Wasser', dayAggregation: 'sum' });
    const now = new Date();
    await MetricLog.create({ userId: user._id, metricId: def._id, date: now, value: 300 });
    await MetricLog.create({ userId: user._id, metricId: def._id, date: now, value: 200 });

    const res = await request(app).get('/api/metrics').set(authHeader(token));
    expect(res.body[0].todayValue).toBe(500);
  });
});

describe('PUT /api/metrics/:id', () => {
  it('updates fields without a rename', async () => {
    const { token, user } = await createUser();
    const def = await MetricDefinition.create({ userId: user._id, key: 'bf', name: 'Körperfett', version: 1 });
    const res = await request(app).put(`/api/metrics/${def._id}`).set(authHeader(token))
      .send({ showOnDashboard: true });

    expect(res.body.showOnDashboard).toBe(true);
    expect(res.body.version).toBe(1);
    expect(res.body.nameHistory).toHaveLength(0);
  });

  it('versions a rename and records the old name', async () => {
    const { token, user } = await createUser();
    const def = await MetricDefinition.create({ userId: user._id, key: 'bf', name: 'Körperfett', unit: '%', version: 1 });
    const res = await request(app).put(`/api/metrics/${def._id}`).set(authHeader(token))
      .send({ name: 'Body Fat' });

    expect(res.body.version).toBe(2);
    expect(res.body.name).toBe('Body Fat');
    expect(res.body.nameHistory[0].name).toBe('Körperfett');
  });

  it('404s for a foreign or missing metric', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    const def = await MetricDefinition.create({ userId: other._id, key: 'x', name: 'X' });
    expect((await request(app).put(`/api/metrics/${def._id}`).set(authHeader(token)).send({ name: 'Y' })).status).toBe(404);
  });

  it('rejects an empty name', async () => {
    const { token, user } = await createUser();
    const def = await MetricDefinition.create({ userId: user._id, key: 'x', name: 'X' });
    expect((await request(app).put(`/api/metrics/${def._id}`).set(authHeader(token)).send({ name: '' })).status).toBe(400);
  });
});

describe('DELETE + restore', () => {
  it('soft-deletes and keeps the logs, then restores', async () => {
    const { token, user } = await createUser();
    const def = await MetricDefinition.create({ userId: user._id, key: 'bf', name: 'Körperfett' });
    await MetricLog.create({ userId: user._id, metricId: def._id, date: new Date(), value: 20 });

    expect((await request(app).delete(`/api/metrics/${def._id}`).set(authHeader(token))).status).toBe(200);
    expect((await request(app).get('/api/metrics').set(authHeader(token))).body.length).toBe(0);
    expect(await MetricLog.countDocuments({ userId: user._id })).toBe(1); // logs preserved

    const restore = await request(app).post(`/api/metrics/${def._id}/restore`).set(authHeader(token));
    expect(restore.status).toBe(200);
    expect((await request(app).get('/api/metrics').set(authHeader(token))).body.length).toBe(1);
  });

  it('refuses to restore over a re-taken key', async () => {
    const { token, user } = await createUser();
    const def = await MetricDefinition.create({ userId: user._id, key: 'bf', name: 'Körperfett', deletedAt: new Date() });
    await MetricDefinition.create({ userId: user._id, key: 'bf', name: 'Körperfett neu' });

    expect((await request(app).post(`/api/metrics/${def._id}/restore`).set(authHeader(token))).status).toBe(409);
  });

  it('404s deleting a missing metric', async () => {
    const { token, user } = await createUser();
    const def = await MetricDefinition.create({ userId: user._id, key: 'x', name: 'X', deletedAt: new Date() });
    expect((await request(app).delete(`/api/metrics/${def._id}`).set(authHeader(token))).status).toBe(404);
  });
});

describe('catalog', () => {
  it('lists templates and marks the added ones', async () => {
    const { token, user } = await createUser();
    await MetricDefinition.create({ userId: user._id, key: 'bodyFat', name: 'Körperfett', healthType: 'bodyFat' });

    const res = await request(app).get('/api/metrics/catalog').set(authHeader(token));
    expect(res.status).toBe(200);
    const bodyFat = res.body.find(t => t.key === 'bodyFat');
    expect(bodyFat.added).toBe(true);
    expect(bodyFat.importable).toBe(true);
    expect(res.body.find(t => t.key === 'mood').importable).toBe(false);
  });

  it('adds a metric from a health template with its healthType set', async () => {
    const { token, user } = await createUser();
    const res = await request(app).post('/api/metrics/catalog/restingHeartRate').set(authHeader(token));

    expect(res.status).toBe(201);
    expect(res.body.healthType).toBe('restingHeartRate');
    expect(res.body.builtin).toBe('restingHeartRate');
    expect(await MetricDefinition.countDocuments({ userId: user._id })).toBe(1);
  });

  it('adds a manual-only template with no healthType', async () => {
    const { token } = await createUser();
    const res = await request(app).post('/api/metrics/catalog/mood').set(authHeader(token));
    expect(res.body.healthType).toBeNull();
    expect(res.body.valueType).toBe('scale');
  });

  it('is idempotent — adding twice returns the existing one', async () => {
    const { token, user } = await createUser();
    await request(app).post('/api/metrics/catalog/mood').set(authHeader(token));
    const second = await request(app).post('/api/metrics/catalog/mood').set(authHeader(token));
    expect(second.status).toBe(200);
    expect(await MetricDefinition.countDocuments({ userId: user._id })).toBe(1);
  });

  it('404s an unknown template', async () => {
    const { token } = await createUser();
    expect((await request(app).post('/api/metrics/catalog/telepathy').set(authHeader(token))).status).toBe(404);
  });
});

describe('logs', () => {
  async function metric(user, over = {}) {
    return MetricDefinition.create({ userId: user._id, key: 'bf', name: 'Körperfett', min: 1, max: 70, ...over });
  }

  it('records a reading and lists it chronologically', async () => {
    const { token, user } = await createUser();
    const def = await metric(user);
    await request(app).post(`/api/metrics/${def._id}/logs`).set(authHeader(token)).send({ value: 20, date: '2026-05-02' });
    await request(app).post(`/api/metrics/${def._id}/logs`).set(authHeader(token)).send({ value: 19, date: '2026-05-01' });

    const res = await request(app).get(`/api/metrics/${def._id}/logs`).set(authHeader(token));
    expect(res.body.map(l => l.value)).toEqual([19, 20]);
  });

  it('defaults the date to now', async () => {
    const { token, user } = await createUser();
    const def = await metric(user);
    const res = await request(app).post(`/api/metrics/${def._id}/logs`).set(authHeader(token)).send({ value: 20 });
    expect(res.status).toBe(201);
    expect(new Date(res.body.date).getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it('enforces the metric bounds', async () => {
    const { token, user } = await createUser();
    const def = await metric(user);
    expect((await request(app).post(`/api/metrics/${def._id}/logs`).set(authHeader(token)).send({ value: 0 })).status).toBe(400);
    expect((await request(app).post(`/api/metrics/${def._id}/logs`).set(authHeader(token)).send({ value: 200 })).status).toBe(400);
  });

  it('rejects non-numeric values and bad dates', async () => {
    const { token, user } = await createUser();
    const def = await metric(user);
    expect((await request(app).post(`/api/metrics/${def._id}/logs`).set(authHeader(token)).send({ value: 'x' })).status).toBe(400);
    expect((await request(app).post(`/api/metrics/${def._id}/logs`).set(authHeader(token)).send({ value: 20, date: 'nope' })).status).toBe(400);
  });

  it('edits and deletes a reading', async () => {
    const { token, user } = await createUser();
    const def = await metric(user);
    const created = await request(app).post(`/api/metrics/${def._id}/logs`).set(authHeader(token)).send({ value: 20 });

    const edit = await request(app).put(`/api/metrics/logs/${created.body._id}`).set(authHeader(token))
      .send({ value: 21, note: 'morgens' });
    expect(edit.body.value).toBe(21);
    expect(edit.body.note).toBe('morgens');

    expect((await request(app).delete(`/api/metrics/logs/${created.body._id}`).set(authHeader(token))).status).toBe(200);
    expect(await MetricLog.countDocuments({ userId: user._id })).toBe(0);
  });

  it('validates edits', async () => {
    const { token, user } = await createUser();
    const def = await metric(user);
    const created = await request(app).post(`/api/metrics/${def._id}/logs`).set(authHeader(token)).send({ value: 20 });
    expect((await request(app).put(`/api/metrics/logs/${created.body._id}`).set(authHeader(token)).send({ value: 'x' })).status).toBe(400);
    expect((await request(app).put(`/api/metrics/logs/${created.body._id}`).set(authHeader(token)).send({ date: 'nope' })).status).toBe(400);
  });

  it('404s logs on a foreign metric and a missing log', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    const def = await MetricDefinition.create({ userId: other._id, key: 'x', name: 'X' });
    expect((await request(app).get(`/api/metrics/${def._id}/logs`).set(authHeader(token))).status).toBe(404);
    expect((await request(app).post(`/api/metrics/${def._id}/logs`).set(authHeader(token)).send({ value: 1 })).status).toBe(404);
    const fakeId = def._id.toString().replace(/.$/, '0');
    expect((await request(app).put(`/api/metrics/logs/${fakeId}`).set(authHeader(token)).send({ value: 1 })).status).toBe(404);
    expect((await request(app).delete(`/api/metrics/logs/${fakeId}`).set(authHeader(token))).status).toBe(404);
  });

  it('filters logs by date range', async () => {
    const { token, user } = await createUser();
    const def = await metric(user);
    await MetricLog.create({ userId: user._id, metricId: def._id, date: new Date('2026-05-01'), value: 20 });
    await MetricLog.create({ userId: user._id, metricId: def._id, date: new Date('2026-06-01'), value: 21 });

    const res = await request(app)
      .get(`/api/metrics/${def._id}/logs?startDate=2026-05-15&endDate=2026-06-15`)
      .set(authHeader(token));
    expect(res.body).toHaveLength(1);
    expect(res.body[0].value).toBe(21);
  });

  it('edits only the date of a reading', async () => {
    const { token, user } = await createUser();
    const def = await metric(user);
    const created = await request(app).post(`/api/metrics/${def._id}/logs`).set(authHeader(token)).send({ value: 20 });
    const res = await request(app).put(`/api/metrics/logs/${created.body._id}`).set(authHeader(token))
      .send({ date: '2026-01-01' });
    expect(new Date(res.body.date).toISOString().slice(0, 10)).toBe('2026-01-01');
  });
});

// Every handler reports storage failures instead of hanging the request.
describe('error handling on mutations', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  async function ownMetric(user) {
    return MetricDefinition.create({ userId: user._id, key: 'bf', name: 'Körperfett' });
  }

  it('400s when create fails', async () => {
    const { token } = await createUser();
    jest.spyOn(MetricDefinition, 'create').mockRejectedValueOnce(new Error('db'));
    expect((await create(token, { name: 'X' })).status).toBe(400);
  });

  it('400s when an update fails', async () => {
    const { token, user } = await createUser();
    const def = await ownMetric(user);
    jest.spyOn(MetricDefinition, 'findByIdAndUpdate').mockRejectedValueOnce(new Error('db'));
    expect((await request(app).put(`/api/metrics/${def._id}`).set(authHeader(token)).send({ showOnDashboard: true })).status).toBe(400);
  });

  it('500s when a delete fails', async () => {
    const { token, user } = await createUser();
    const def = await ownMetric(user);
    jest.spyOn(MetricDefinition, 'findOneAndUpdate').mockRejectedValueOnce(new Error('db'));
    expect((await request(app).delete(`/api/metrics/${def._id}`).set(authHeader(token))).status).toBe(500);
  });

  it('400s when a restore fails', async () => {
    const { token, user } = await createUser();
    const def = await MetricDefinition.create({ userId: user._id, key: 'bf', name: 'X', deletedAt: new Date() });
    jest.spyOn(MetricDefinition, 'exists').mockRejectedValueOnce(new Error('db'));
    expect((await request(app).post(`/api/metrics/${def._id}/restore`).set(authHeader(token))).status).toBe(400);
  });

  it('400s when adding from the catalog fails', async () => {
    const { token } = await createUser();
    jest.spyOn(MetricDefinition, 'findOne').mockRejectedValueOnce(new Error('db'));
    expect((await request(app).post('/api/metrics/catalog/mood').set(authHeader(token))).status).toBe(400);
  });

  it('500s when reading logs fails', async () => {
    const { token, user } = await createUser();
    const def = await ownMetric(user);
    jest.spyOn(MetricLog, 'find').mockImplementationOnce(() => { throw new Error('db'); });
    expect((await request(app).get(`/api/metrics/${def._id}/logs`).set(authHeader(token))).status).toBe(500);
  });

  it('400s when creating a reading fails', async () => {
    const { token, user } = await createUser();
    const def = await ownMetric(user);
    jest.spyOn(MetricLog, 'create').mockRejectedValueOnce(new Error('db'));
    expect((await request(app).post(`/api/metrics/${def._id}/logs`).set(authHeader(token)).send({ value: 20 })).status).toBe(400);
  });

  it('400s when editing a reading fails', async () => {
    const { token } = await createUser();
    jest.spyOn(MetricLog, 'findOneAndUpdate').mockRejectedValueOnce(new Error('db'));
    const anyId = '0'.repeat(24);
    expect((await request(app).put(`/api/metrics/logs/${anyId}`).set(authHeader(token)).send({ value: 1 })).status).toBe(400);
  });

  it('500s when deleting a reading fails', async () => {
    const { token } = await createUser();
    jest.spyOn(MetricLog, 'findOneAndDelete').mockRejectedValueOnce(new Error('db'));
    const anyId = '0'.repeat(24);
    expect((await request(app).delete(`/api/metrics/logs/${anyId}`).set(authHeader(token))).status).toBe(500);
  });
});

describe('GET /api/metrics/summary', () => {
  it('returns one row per metric with the latest value', async () => {
    const { token, user } = await createUser();
    const def = await MetricDefinition.create({ userId: user._id, key: 'bf', name: 'Körperfett', showOnDashboard: true });
    await MetricLog.create({ userId: user._id, metricId: def._id, date: new Date('2026-05-01'), value: 20 });
    await MetricLog.create({ userId: user._id, metricId: def._id, date: new Date('2026-05-03'), value: 19 });
    await MetricDefinition.create({ userId: user._id, key: 'hidden', name: 'Versteckt', showOnDashboard: false });

    const all = await request(app).get('/api/metrics/summary').set(authHeader(token));
    expect(all.body.length).toBe(2);

    const dash = await request(app).get('/api/metrics/summary?dashboard=true').set(authHeader(token));
    expect(dash.body.length).toBe(1);
    expect(dash.body[0].value).toBe(19);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/metrics/summary')).status).toBe(401);
  });
});

describe('error handling', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('500s when listing fails', async () => {
    const { token } = await createUser();
    jest.spyOn(MetricDefinition, 'find').mockImplementationOnce(() => { throw new Error('db'); });
    expect((await request(app).get('/api/metrics').set(authHeader(token))).status).toBe(500);
  });

  it('500s when the summary fails', async () => {
    const { token } = await createUser();
    jest.spyOn(MetricDefinition, 'find').mockImplementationOnce(() => { throw new Error('db'); });
    expect((await request(app).get('/api/metrics/summary').set(authHeader(token))).status).toBe(500);
  });

  it('500s when the catalog fails', async () => {
    const { token } = await createUser();
    jest.spyOn(MetricDefinition, 'find').mockImplementationOnce(() => { throw new Error('db'); });
    expect((await request(app).get('/api/metrics/catalog').set(authHeader(token))).status).toBe(500);
  });
});
