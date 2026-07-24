const { startDb, stopDb, clearDb, createUser } = require('./helpers/testApp');
const MetricDefinition = require('../models/MetricDefinition');
const MetricLog = require('../models/MetricLog');
const catalog = require('../services/metricCatalog');
const { mergeMetricRecords, healthDefinitionsFor } = require('../services/healthMetrics');

beforeAll(async () => { await startDb(); });
afterEach(async () => { await clearDb(); });
afterAll(async () => { await stopDb(); });

async function seedMetric(userId, type) {
  return MetricDefinition.create({
    userId,
    ...catalog.definitionFromTemplate(type, catalog.HEALTH_METRICS[type]),
    healthType: type,
    builtin: type,
  });
}

describe('mergeMetricRecords', () => {
  it('imports readings into the matching metric', async () => {
    const { user } = await createUser();
    const def = await seedMetric(user._id, 'restingHeartRate');
    const defs = await healthDefinitionsFor(user._id);

    const res = await mergeMetricRecords(user._id, [
      { type: 'restingHeartRate', id: 'r1', time: '2026-05-01T06:00:00Z', value: 52 },
    ], defs);

    expect(res.imported).toBe(1);
    const log = await MetricLog.findOne({ userId: user._id, metricId: def._id });
    expect(log.value).toBe(52);
    expect(log.source).toBe('health');
  });

  it('counts records with no destination metric as unmapped', async () => {
    const { user } = await createUser();
    const defs = await healthDefinitionsFor(user._id); // none seeded

    const res = await mergeMetricRecords(user._id, [
      { type: 'sleepDuration', id: 's1', time: '2026-05-01T06:00:00Z', value: 7 },
      { type: 'sleepDuration', id: 's2', time: '2026-05-02T06:00:00Z', value: 8 },
    ], defs);

    expect(res.imported).toBe(0);
    expect(res.unmapped.sleepDuration).toBe(2);
  });

  it('is idempotent — re-uploading updates rather than duplicating', async () => {
    const { user } = await createUser();
    await seedMetric(user._id, 'bodyFat');
    const defs = await healthDefinitionsFor(user._id);

    await mergeMetricRecords(user._id, [{ type: 'bodyFat', id: 'b1', time: '2026-05-01T06:00:00Z', value: 20 }], defs);
    await mergeMetricRecords(user._id, [{ type: 'bodyFat', id: 'b1', time: '2026-05-01T06:00:00Z', value: 19 }], defs);

    expect(await MetricLog.countDocuments({ userId: user._id })).toBe(1);
    expect((await MetricLog.findOne({ userId: user._id })).value).toBe(19);
  });

  it('clamps out-of-range readings', async () => {
    const { user } = await createUser();
    await seedMetric(user._id, 'oxygenSaturation'); // min 50, max 100
    const defs = await healthDefinitionsFor(user._id);

    const res = await mergeMetricRecords(user._id, [
      { type: 'oxygenSaturation', id: 'o1', time: '2026-05-01T06:00:00Z', value: 30 },
      { type: 'oxygenSaturation', id: 'o2', time: '2026-05-01T07:00:00Z', value: 150 },
      { type: 'oxygenSaturation', id: 'o3', time: '2026-05-01T08:00:00Z', value: 97 },
    ], defs);

    expect(res.imported).toBe(1);
  });

  it('ignores malformed records', async () => {
    const { user } = await createUser();
    await seedMetric(user._id, 'bodyFat');
    const defs = await healthDefinitionsFor(user._id);

    const res = await mergeMetricRecords(user._id, [
      { type: 'bodyFat', id: null, time: '2026-05-01T06:00:00Z', value: 20 },
      { type: 'bodyFat', id: 'x', time: 'nope', value: 20 },
      { type: 'bodyFat', id: 'y', time: '2026-05-01T06:00:00Z', value: 'fett' },
    ], defs);

    expect(res.imported).toBe(0);
    expect(await MetricLog.countDocuments({ userId: user._id })).toBe(0);
  });

  it('returns early for an empty or non-array list', async () => {
    const { user } = await createUser();
    const empty = { imported: 0, skipped: 0, collapsed: 0, unmapped: {} };
    expect(await mergeMetricRecords(user._id, [], new Map())).toEqual(empty);
    expect(await mergeMetricRecords(user._id, null, new Map())).toEqual(empty);
  });

  // Day rules for `last`-style metrics (body fat, resting HR): manual wins the
  // day, several health readings collapse to the latest.
  describe('day rules for last-style metrics', () => {
    it('never overwrites a day the user logged by hand', async () => {
      const { user } = await createUser();
      const def = await seedMetric(user._id, 'bodyFat');
      await MetricLog.create({
        userId: user._id, metricId: def._id, date: new Date('2026-05-01T20:00:00Z'),
        value: 18, source: 'manual',
      });
      const defs = await healthDefinitionsFor(user._id);

      const res = await mergeMetricRecords(user._id, [
        { type: 'bodyFat', id: 'b1', time: '2026-05-01T06:00:00Z', value: 22 },
      ], defs);

      expect(res.skipped).toBe(1);
      expect(res.imported).toBe(0);
      const logs = await MetricLog.find({ userId: user._id });
      expect(logs.length).toBe(1);
      expect(logs[0].value).toBe(18);
    });

    it('collapses several health readings on one day to the latest', async () => {
      const { user } = await createUser();
      await seedMetric(user._id, 'bodyFat');
      const defs = await healthDefinitionsFor(user._id);

      const res = await mergeMetricRecords(user._id, [
        { type: 'bodyFat', id: 'morning', time: '2026-05-01T06:00:00Z', value: 20 },
        { type: 'bodyFat', id: 'evening', time: '2026-05-01T20:00:00Z', value: 21 },
      ], defs);

      expect(res.collapsed).toBe(1);
      const logs = await MetricLog.find({ userId: user._id });
      expect(logs.length).toBe(1);
      expect(logs[0].value).toBe(21);
    });
  });

  // For sum/avg metrics (steps, hydration) manual and health readings coexist.
  it('keeps all readings for sum-style metrics', async () => {
    const { user } = await createUser();
    const def = await seedMetric(user._id, 'hydration'); // dayAgg sum
    await MetricLog.create({
      userId: user._id, metricId: def._id, date: new Date('2026-05-01T09:00:00Z'),
      value: 500, source: 'manual',
    });
    const defs = await healthDefinitionsFor(user._id);

    const res = await mergeMetricRecords(user._id, [
      { type: 'hydration', id: 'h1', time: '2026-05-01T12:00:00Z', value: 300 },
      { type: 'hydration', id: 'h2', time: '2026-05-01T18:00:00Z', value: 250 },
    ], defs);

    expect(res.imported).toBe(2);
    expect(res.skipped).toBe(0);
    expect(res.collapsed).toBe(0);
    expect(await MetricLog.countDocuments({ userId: user._id })).toBe(3);
  });
});

describe('healthDefinitionsFor', () => {
  it('returns only metrics that pull from Health Connect, keyed by type', async () => {
    const { user } = await createUser();
    await seedMetric(user._id, 'bodyFat');
    await MetricDefinition.create({ userId: user._id, key: 'manual_only', name: 'Nur manuell' });

    const defs = await healthDefinitionsFor(user._id);
    expect(defs.has('bodyFat')).toBe(true);
    expect(defs.size).toBe(1);
  });
});
