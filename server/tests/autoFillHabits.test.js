const { startDb, stopDb, clearDb, createUser } = require('./helpers/testApp');
const HabitDefinition = require('../models/HabitDefinition');
const HabitLog = require('../models/HabitLog');
const UserHabitSettings = require('../models/UserHabitSettings');
const MetricDefinition = require('../models/MetricDefinition');
const MetricLog = require('../models/MetricLog');
const HealthActivity = require('../models/HealthActivity');
const { materialize, recentDays } = require('../services/autoFillHabits');

beforeAll(async () => { await startDb(); });
afterEach(async () => { await clearDb(); });
afterAll(async () => { await stopDb(); });

const today = () => new Date().toISOString().slice(0, 10);

async function boundHabit(userId, autoSource, over = {}) {
  const def = await HabitDefinition.create({ userId, name: 'Schlaf', unitSymbol: 'h', type: 'duration', ...over });
  await UserHabitSettings.findOneAndUpdate(
    { userId },
    { $addToSet: { selectedHabitIds: def._id },
      $set: { hasSelection: true, [`habitSettings.${def._id}`]: { autoSource } } },
    { upsert: true }
  );
  return def;
}

describe('materialize', () => {
  it('writes an auto HabitLog from the bound metric', async () => {
    const { user } = await createUser();
    const metric = await MetricDefinition.create({ userId: user._id, key: 'sleep', name: 'Schlaf', dayAggregation: 'sum' });
    await MetricLog.create({ userId: user._id, metricId: metric._id, date: new Date(), value: 7.5 });
    const def = await boundHabit(user._id, { kind: 'metric', metricId: String(metric._id) });

    const res = await materialize(user._id, [today()]);
    expect(res.written).toBe(1);
    const log = await HabitLog.findOne({ userId: user._id, habitId: def._id });
    expect(log.value).toBe(7.5);
    expect(log.source).toBe('auto');
  });

  it('never overwrites a manual log', async () => {
    const { user } = await createUser();
    const metric = await MetricDefinition.create({ userId: user._id, key: 'sleep', name: 'Schlaf', dayAggregation: 'sum' });
    await MetricLog.create({ userId: user._id, metricId: metric._id, date: new Date(), value: 7.5 });
    const def = await boundHabit(user._id, { kind: 'metric', metricId: String(metric._id) });
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    await HabitLog.create({ userId: user._id, habitId: def._id, date: start, value: 9, source: 'manual' });

    await materialize(user._id, [today()]);
    const logs = await HabitLog.find({ userId: user._id, habitId: def._id });
    expect(logs.length).toBe(1);
    expect(logs[0].value).toBe(9);        // manual kept
    expect(logs[0].source).toBe('manual');
  });

  it('updates its own auto log on re-run (metric changed)', async () => {
    const { user } = await createUser();
    const metric = await MetricDefinition.create({ userId: user._id, key: 'steps', name: 'Schritte', dayAggregation: 'sum' });
    await MetricLog.create({ userId: user._id, metricId: metric._id, date: new Date(), value: 5000 });
    const def = await boundHabit(user._id, { kind: 'metric', metricId: String(metric._id) }, { name: 'Schritte', unitSymbol: 'Stk', type: 'amount' });

    await materialize(user._id, [today()]);
    await MetricLog.create({ userId: user._id, metricId: metric._id, date: new Date(), value: 3000 });
    await materialize(user._id, [today()]);

    const logs = await HabitLog.find({ userId: user._id, habitId: def._id });
    expect(logs.length).toBe(1);
    expect(logs[0].value).toBe(8000); // 5000 + 3000 (sum)
  });

  it('writes from matching activities', async () => {
    const { user } = await createUser();
    await HealthActivity.create({
      userId: user._id, healthId: 'h1', exerciseType: 'EXERCISE_TYPE_RUNNING', sportType: 'run',
      distance: 5000, movingTime: 1800, canonical: true,
      startDate: new Date(), endDate: new Date(), startDateLocal: new Date(),
    });
    const def = await boundHabit(user._id,
      { kind: 'activity', metric: 'count', criteria: { health: { operator: 'AND', rules: [{ kind: 'sportType', values: ['run'] }] } } },
      { name: 'Laufen', unitSymbol: 'x', type: 'amount' });

    await materialize(user._id, [today()]);
    const log = await HabitLog.findOne({ userId: user._id, habitId: def._id });
    expect(log.value).toBe(1);
    expect(log.source).toBe('auto');
  });

  it('does nothing without bound habits or days', async () => {
    const { user } = await createUser();
    expect((await materialize(user._id, [])).written).toBe(0);
    expect((await materialize(user._id, [today()])).written).toBe(0);
  });

  it('recentDays returns n consecutive days ending today', () => {
    const days = recentDays(7);
    expect(days.length).toBe(7);
    expect(days[0]).toBe(today());
  });
});
