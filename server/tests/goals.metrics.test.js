const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createUser, authHeader } = require('./helpers/testApp');
const Goal = require('../models/Goal');
const MetricDefinition = require('../models/MetricDefinition');
const MetricLog = require('../models/MetricLog');

let app;
beforeAll(async () => { await startDb(); app = buildApp(); });
afterEach(async () => { await clearDb(); });
afterAll(async () => { await stopDb(); });

async function metric(user, over = {}) {
  return MetricDefinition.create({
    userId: user._id, key: 'rhr', name: 'Ruhepuls', unit: 'bpm',
    dayAggregation: 'min', aggregation: 'avg', direction: 'down', ...over,
  });
}

async function logValue(user, def, date, value) {
  return MetricLog.create({ userId: user._id, metricId: def._id, date: new Date(date), value });
}

const goalBody = (def, over = {}) => ({
  name: 'Ruhepuls senken',
  type: 'periodic-metric',
  targetRef: String(def._id),
  targetRefModel: 'MetricDefinition',
  intervalValue: 1,
  intervalUnit: 'week',
  condition: 'max',
  targetValue: 55,
  metric: 'value',
  ...over,
});

describe('metric goals', () => {
  it('creates a metric goal and resolves its target name/unit', async () => {
    const { token, user } = await createUser();
    const def = await metric(user);

    const res = await request(app).post('/api/goals').set(authHeader(token)).send(goalBody(def));
    expect(res.status).toBe(201);
    expect(res.body.targetName).toBe('Ruhepuls');
    expect(res.body.unitSymbol).toBe('bpm');
  });

  it('rejects a metric goal referencing another user\'s metric', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    const def = await metric(other);

    const res = await request(app).post('/api/goals').set(authHeader(token)).send(goalBody(def));
    expect(res.status).toBe(404);
  });

  it('evaluates progress with the metric\'s own aggregation (min/day, avg/week)', async () => {
    const { token, user } = await createUser();
    const def = await metric(user); // dayAgg min, agg avg
    const today = new Date();
    // two readings today → min 51; the weekly avg of the single day = 51
    await logValue(user, def, today, 58);
    await logValue(user, def, today, 51);
    const goal = await Goal.create({ ...goalBody(def), targetRef: def._id, userId: user._id });

    const res = await request(app).get(`/api/goals/${goal._id}/progress`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.conditions[0].currentValue).toBe(51);
    expect(res.body.met).toBe(true); // 51 <= 55
  });

  it('supports the sum selector (e.g. weekly water)', async () => {
    const { token, user } = await createUser();
    const def = await metric(user, { key: 'water', name: 'Wasser', unit: 'ml', dayAggregation: 'sum', aggregation: 'sum', direction: 'up' });
    const today = new Date();
    await logValue(user, def, today, 800);
    await logValue(user, def, today, 700);
    const goal = await Goal.create({
      ...goalBody(def), targetRef: def._id, userId: user._id,
      name: 'Wasser', condition: 'min', targetValue: 2000, metric: 'sum',
    });

    const res = await request(app).get(`/api/goals/${goal._id}/progress`).set(authHeader(token));
    expect(res.body.conditions[0].currentValue).toBe(1500);
    expect(res.body.met).toBe(false); // 1500 < 2000
  });

  it('counts readings and distinct days', async () => {
    const { token, user } = await createUser();
    const def = await metric(user);
    const goal = await Goal.create({ ...goalBody(def), targetRef: def._id, userId: user._id, metric: 'days', condition: 'min', targetValue: 2 });
    const now = new Date();
    await logValue(user, def, now, 50);
    await logValue(user, def, now, 52);           // same day
    await logValue(user, def, new Date(now.getTime() - 86400000), 51);

    const res = await request(app).get(`/api/goals/${goal._id}/progress`).set(authHeader(token));
    expect(res.body.conditions[0].currentValue).toBe(2); // two distinct days
  });

  it('returns 0 when the metric has no readings in the interval', async () => {
    const { token, user } = await createUser();
    const def = await metric(user);
    const goal = await Goal.create({ ...goalBody(def), targetRef: def._id, userId: user._id });

    const res = await request(app).get(`/api/goals/${goal._id}/progress`).set(authHeader(token));
    expect(res.body.conditions[0].currentValue).toBe(0);
  });

  it('serves an interval heatmap for the metric goal', async () => {
    const { token, user } = await createUser();
    const def = await metric(user);
    await logValue(user, def, new Date(), 53);
    const goal = await Goal.create({ ...goalBody(def), targetRef: def._id, userId: user._id });

    const res = await request(app).get(`/api/goals/${goal._id}/heatmap`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('intervals');
    expect(res.body.intervals.at(-1).met).toBe(true);
  });

  it('serves a daily heatmap for a long-term metric goal', async () => {
    const { token, user } = await createUser();
    const def = await metric(user, { key: 'bf', name: 'Körperfett', dayAggregation: 'last', aggregation: 'last' });
    await logValue(user, def, new Date(), 18);
    const goal = await Goal.create({
      ...goalBody(def), targetRef: def._id, userId: user._id,
      type: 'long-term-metric', startDate: new Date(Date.now() - 30 * 86400000), endDate: new Date(Date.now() + 30 * 86400000),
    });

    const res = await request(app).get(`/api/goals/${goal._id}/heatmap`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.days).length).toBeGreaterThan(0);
  });
});
