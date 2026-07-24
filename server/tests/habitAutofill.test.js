const { startDb, stopDb, clearDb, createUser } = require('./helpers/testApp');
const HabitDefinition = require('../models/HabitDefinition');
const HabitLog = require('../models/HabitLog');
const UserHabitSettings = require('../models/UserHabitSettings');
const MetricDefinition = require('../models/MetricDefinition');
const MetricLog = require('../models/MetricLog');
const HealthActivity = require('../models/HealthActivity');
const StravaActivity = require('../models/StravaActivity');
const { dueHabitsForRange } = require('../services/habitSchedule');

beforeAll(async () => { await startDb(); });
afterEach(async () => { await clearDb(); });
afterAll(async () => { await stopDb(); });

const today = () => new Date().toISOString().slice(0, 10);

async function habit(userId, settings, defOverrides = {}) {
  const def = await HabitDefinition.create({
    userId, name: 'Schritte', unitSymbol: 'Stk', type: 'amount', ...defOverrides,
  });
  await UserHabitSettings.findOneAndUpdate(
    { userId },
    { $addToSet: { selectedHabitIds: def._id },
      $set: { hasSelection: true, [`habitSettings.${def._id}`]: settings } },
    { upsert: true }
  );
  return def;
}

function forHabit(due, id) {
  return due.find(d => d.habitId === String(id));
}

describe('metric-bound auto-fill', () => {
  it('fills the daily value from the bound metric and fulfils the target', async () => {
    const { user } = await createUser();
    const metric = await MetricDefinition.create({
      userId: user._id, key: 'steps', name: 'Schritte', dayAggregation: 'sum',
    });
    await MetricLog.create({ userId: user._id, metricId: metric._id, date: new Date(), value: 6000 });
    await MetricLog.create({ userId: user._id, metricId: metric._id, date: new Date(), value: 5000 });

    const def = await habit(user._id, {
      targetCondition: 'min', targetValue: 10000,
      autoSource: { kind: 'metric', metricId: String(metric._id) },
    });

    const due = forHabit(await dueHabitsForRange(user._id, today(), today()), def._id);
    expect(due.loggedValue).toBe(11000); // 6000 + 5000, day sum
    expect(due.auto).toBe(true);
    expect(due.source).toBe('metric');
    expect(due.fulfilled).toBe(true);   // 11000 >= 10000
  });

  it('does not fulfil when the auto value misses the target', async () => {
    const { user } = await createUser();
    const metric = await MetricDefinition.create({ userId: user._id, key: 'steps', name: 'Schritte', dayAggregation: 'sum' });
    await MetricLog.create({ userId: user._id, metricId: metric._id, date: new Date(), value: 3000 });
    const def = await habit(user._id, {
      targetCondition: 'min', targetValue: 10000,
      autoSource: { kind: 'metric', metricId: String(metric._id) },
    });

    const due = forHabit(await dueHabitsForRange(user._id, today(), today()), def._id);
    expect(due.loggedValue).toBe(3000);
    expect(due.fulfilled).toBe(false);
  });

  it('a manual log overrides the auto value', async () => {
    const { user } = await createUser();
    const metric = await MetricDefinition.create({ userId: user._id, key: 'steps', name: 'Schritte', dayAggregation: 'sum' });
    await MetricLog.create({ userId: user._id, metricId: metric._id, date: new Date(), value: 3000 });
    const def = await habit(user._id, {
      targetCondition: 'min', targetValue: 5000,
      autoSource: { kind: 'metric', metricId: String(metric._id) },
    });
    await HabitLog.create({ userId: user._id, habitId: def._id, date: new Date(), value: 8000 });

    const due = forHabit(await dueHabitsForRange(user._id, today(), today()), def._id);
    expect(due.loggedValue).toBe(8000);   // manual wins
    expect(due.auto).toBe(false);
    expect(due.source).toBe('manual');
    expect(due.fulfilled).toBe(true);
  });

  it('leaves the day open when the metric has no reading', async () => {
    const { user } = await createUser();
    const metric = await MetricDefinition.create({ userId: user._id, key: 'steps', name: 'Schritte', dayAggregation: 'sum' });
    const def = await habit(user._id, {
      targetCondition: 'min', targetValue: 5000,
      autoSource: { kind: 'metric', metricId: String(metric._id) },
    });

    const due = forHabit(await dueHabitsForRange(user._id, today(), today()), def._id);
    expect(due.logged).toBe(false);
    expect(due.loggedValue).toBeNull();
    expect(due.fulfilled).toBe(false);
  });
});

describe('activity-bound auto-fill', () => {
  it('counts matching Health Connect activities for the day', async () => {
    const { user } = await createUser();
    await HealthActivity.create({
      userId: user._id, healthId: 'h1', exerciseType: 'EXERCISE_TYPE_RUNNING', sportType: 'run',
      movingTime: 1800, distance: 5000, canonical: true,
      startDate: new Date(), endDate: new Date(), startDateLocal: new Date(),
    });
    const def = await habit(user._id, {
      targetCondition: 'min', targetValue: 1,
      autoSource: { kind: 'activity', metric: 'count', criteria: { health: { operator: 'AND', rules: [{ kind: 'sportType', values: ['run'] }] } } },
    }, { name: 'Laufen' });

    const due = forHabit(await dueHabitsForRange(user._id, today(), today()), def._id);
    expect(due.loggedValue).toBe(1);
    expect(due.auto).toBe(true);
    expect(due.source).toBe('activity');
    expect(due.fulfilled).toBe(true);
  });

  it('sums distance across matching Strava + Health activities', async () => {
    const { user } = await createUser();
    await StravaActivity.create({
      userId: user._id, stravaId: 1, sportType: 'Run', type: 'Run',
      startDate: new Date(), startDateLocal: new Date(), distance: 5000, movingTime: 1800,
    });
    await HealthActivity.create({
      userId: user._id, healthId: 'h1', exerciseType: 'EXERCISE_TYPE_RUNNING', sportType: 'run',
      distance: 3000, movingTime: 1200, canonical: true,
      startDate: new Date(), endDate: new Date(), startDateLocal: new Date(),
    });
    const def = await habit(user._id, {
      targetCondition: 'min', targetValue: 7,
      autoSource: {
        kind: 'activity', metric: 'distance',
        criteria: {
          strava: { operator: 'AND', rules: [{ kind: 'sportType', values: ['Run'] }] },
          health: { operator: 'AND', rules: [{ kind: 'sportType', values: ['run'] }] },
        },
      },
    }, { name: 'Laufen', unitSymbol: 'km' });

    const due = forHabit(await dueHabitsForRange(user._id, today(), today()), def._id);
    expect(due.loggedValue).toBe(8); // 5 km + 3 km
    expect(due.fulfilled).toBe(true);
  });

  it('a bad criteria map does not crash the run', async () => {
    const { user } = await createUser();
    const def = await habit(user._id, {
      autoSource: { kind: 'activity', metric: 'count', criteria: { nope: {} } },
    });
    const due = forHabit(await dueHabitsForRange(user._id, today(), today()), def._id);
    expect(due).toBeTruthy();
    expect(due.fulfilled).toBe(false);
  });
});
