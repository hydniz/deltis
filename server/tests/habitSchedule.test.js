const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createUser, authHeader } = require('./helpers/testApp');
const HabitDefinition = require('../models/HabitDefinition');
const HabitLog = require('../models/HabitLog');
const ActivityLog = require('../models/ActivityLog');
const ActivityType = require('../models/ActivityType');
const StravaActivity = require('../models/StravaActivity');
const HabitPlan = require('../models/HabitPlan');
const TrainingPlan = require('../models/TrainingPlan');
const TrainingType = require('../models/TrainingType');
const UserHabitSettings = require('../models/UserHabitSettings');
const { dueHabitsForRange } = require('../services/habitSchedule');

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

async function habitWithSchedule(userId, settings, defOverrides = {}) {
  const def = await HabitDefinition.create({
    userId, name: 'Dehnen', unitSymbol: 'min', type: 'duration', ...defOverrides,
  });
  await UserHabitSettings.findOneAndUpdate(
    { userId },
    {
      $addToSet: { selectedHabitIds: def._id },
      $set: { hasSelection: true, [`habitSettings.${def._id}`]: settings },
    },
    { upsert: true }
  );
  return def;
}

describe('dueHabitsForRange', () => {
  it('daily habits are due every day; unselected habits never', async () => {
    const { user } = await createUser();
    await habitWithSchedule(user._id, { scheduleMode: 'daily' });
    await HabitDefinition.create({ userId: user._id, name: 'Ignoriert', unitSymbol: 'x' });

    const due = await dueHabitsForRange(user._id, '2026-07-13', '2026-07-15');
    expect(due).toHaveLength(3);
    expect(due.every(d => d.name === 'Dehnen')).toBe(true);
    expect(due[0].reason.kind).toBe('daily');
  });

  it('weekly habits follow their weekdays', async () => {
    const { user } = await createUser();
    // 2026-07-13 is a Monday (1), 2026-07-15 a Wednesday (3)
    await habitWithSchedule(user._id, { scheduleMode: 'weekly', scheduleDays: [1, 3] });

    const due = await dueHabitsForRange(user._id, '2026-07-13', '2026-07-19');
    expect(due.map(d => d.date)).toEqual(['2026-07-13', '2026-07-15']);
    expect(due[0].reason).toMatchObject({ kind: 'weekly', days: [1, 3] });
  });

  it('interval habits repeat every N days from their anchor', async () => {
    const { user } = await createUser();
    await habitWithSchedule(user._id, {
      scheduleMode: 'interval', scheduleIntervalDays: 3, scheduleAnchorDate: '2026-07-10',
    });

    const due = await dueHabitsForRange(user._id, '2026-07-10', '2026-07-19');
    expect(due.map(d => d.date)).toEqual(['2026-07-10', '2026-07-13', '2026-07-16', '2026-07-19']);
    expect(due[0].reason).toMatchObject({ kind: 'interval', intervalDays: 3, anchorDate: '2026-07-10' });

    // Days before the anchor are never due
    const before = await dueHabitsForRange(user._id, '2026-07-07', '2026-07-09');
    expect(before).toHaveLength(0);
  });

  it('after-trigger: due N days after another habit was logged', async () => {
    const { user } = await createUser();
    const source = await HabitDefinition.create({ userId: user._id, name: 'Krafttraining', unitSymbol: '✓', type: 'boolean' });
    await habitWithSchedule(user._id, {
      scheduleMode: 'trigger',
      scheduleTrigger: { kind: 'habit', refId: String(source._id), direction: 'after', offsetDays: 2 },
    });
    await HabitLog.create({ userId: user._id, habitId: source._id, date: new Date('2026-07-13T10:00:00Z'), value: 1 });

    const due = await dueHabitsForRange(user._id, '2026-07-13', '2026-07-19');
    expect(due.map(d => d.date)).toEqual(['2026-07-15']);
    expect(due[0].reason).toMatchObject({
      kind: 'trigger', direction: 'after', offsetDays: 2,
      sourceKind: 'habit', sourceName: 'Krafttraining', sourceDate: '2026-07-13',
    });
  });

  it('after-trigger works for activity types and Strava sports (same day)', async () => {
    const { user } = await createUser();
    const type = await ActivityType.create({ userId: user._id, label: 'Joggen', version: 1, nameHistory: [] });
    await habitWithSchedule(user._id, {
      scheduleMode: 'trigger',
      scheduleTrigger: { kind: 'activityType', refId: String(type._id), direction: 'after', offsetDays: 0 },
    });
    await ActivityLog.create({ userId: user._id, activityType: 'Joggen', activityTypeRef: type._id, date: new Date('2026-07-14T09:00:00Z') });

    const stretch = await habitWithSchedule(user._id, {
      scheduleMode: 'trigger',
      scheduleTrigger: { kind: 'stravaSport', sport: 'Run', direction: 'after', offsetDays: 1 },
    }, { name: 'Blackroll' });
    void stretch;
    await StravaActivity.create({
      userId: user._id, stravaId: 1, sportType: 'Run', type: 'Run',
      startDate: new Date('2026-07-15T05:00:00Z'), startDateLocal: new Date('2026-07-15T07:00:00Z'),
    });

    const due = await dueHabitsForRange(user._id, '2026-07-13', '2026-07-19');
    const byName = (n) => due.filter(d => d.name === n).map(d => d.date);
    expect(byName('Dehnen')).toEqual(['2026-07-14']);
    expect(byName('Blackroll')).toEqual(['2026-07-16']);
  });

  it('before-trigger: due N days before something is planned', async () => {
    const { user } = await createUser();
    const tt = await TrainingType.create({ userId: user._id, name: 'Wettkampf', criteria: {} });
    await habitWithSchedule(user._id, {
      scheduleMode: 'trigger',
      scheduleTrigger: { kind: 'trainingType', refId: String(tt._id), direction: 'before', offsetDays: 2 },
    }, { name: 'Carboloading', unitSymbol: 'g', type: 'amount' });
    await TrainingPlan.create({ userId: user._id, trainingTypeId: tt._id, scheduledDate: new Date('2026-07-18') });

    const due = await dueHabitsForRange(user._id, '2026-07-13', '2026-07-19');
    expect(due.map(d => d.date)).toEqual(['2026-07-16']);
    expect(due[0].reason).toMatchObject({
      kind: 'trigger', direction: 'before', offsetDays: 2,
      sourceKind: 'trainingType', sourceName: 'Wettkampf', sourceDate: '2026-07-18',
    });
  });

  it('reports the logged state per day', async () => {
    const { user } = await createUser();
    const def = await habitWithSchedule(user._id, { scheduleMode: 'daily' });
    await HabitLog.create({ userId: user._id, habitId: def._id, date: new Date('2026-07-14T08:00:00Z'), value: 15 });

    const due = await dueHabitsForRange(user._id, '2026-07-13', '2026-07-14');
    expect(due.find(d => d.date === '2026-07-13').logged).toBe(false);
    const logged = due.find(d => d.date === '2026-07-14');
    expect(logged.logged).toBe(true);
    expect(logged.loggedValue).toBe(15);
    // Without a completion target any log fulfils the day
    expect(logged.fulfilled).toBe(true);
  });

  it('only counts a day as fulfilled when the completion target is met (Kreatin 0/5 g)', async () => {
    const { user } = await createUser();
    const def = await habitWithSchedule(
      user._id,
      { scheduleMode: 'daily', targetCondition: 'min', targetValue: 5 },
      { name: 'Kreatin', unitSymbol: 'g', type: 'amount' }
    );
    await HabitLog.create({ userId: user._id, habitId: def._id, date: new Date('2026-07-13T08:00:00Z'), value: 0 });
    await HabitLog.create({ userId: user._id, habitId: def._id, date: new Date('2026-07-14T08:00:00Z'), value: 5 });

    const due = await dueHabitsForRange(user._id, '2026-07-13', '2026-07-14');
    const missed = due.find(d => d.date === '2026-07-13');
    expect(missed.logged).toBe(true);
    expect(missed.fulfilled).toBe(false); // 0 g logged, 5 g minimum → still open
    const met = due.find(d => d.date === '2026-07-14');
    expect(met.fulfilled).toBe(true);
  });

  it('max targets fulfil at or below the limit', async () => {
    const { user } = await createUser();
    const def = await habitWithSchedule(
      user._id,
      { scheduleMode: 'daily', targetCondition: 'max', targetValue: 0 },
      { name: 'Zigaretten', unitSymbol: 'Stück', type: 'amount' }
    );
    await HabitLog.create({ userId: user._id, habitId: def._id, date: new Date('2026-07-13T08:00:00Z'), value: 0 });
    await HabitLog.create({ userId: user._id, habitId: def._id, date: new Date('2026-07-14T08:00:00Z'), value: 3 });

    const due = await dueHabitsForRange(user._id, '2026-07-13', '2026-07-14');
    expect(due.find(d => d.date === '2026-07-13').fulfilled).toBe(true);
    expect(due.find(d => d.date === '2026-07-14').fulfilled).toBe(false);
  });
});

describe('GET /api/habits/due', () => {
  it('returns due habits for the range and is user-scoped', async () => {
    const { token, user } = await createUser();
    await habitWithSchedule(user._id, { scheduleMode: 'daily' });
    const { token: otherToken } = await createUser({ name: 'Other' });

    const res = await request(app)
      .get('/api/habits/due?startDate=2026-07-13&endDate=2026-07-14')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ name: 'Dehnen', reason: { kind: 'daily' } });

    const foreign = await request(app)
      .get('/api/habits/due?startDate=2026-07-13&endDate=2026-07-14')
      .set(authHeader(otherToken));
    expect(foreign.body).toHaveLength(0);
  });

  it('rejects an inverted range', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .get('/api/habits/due?startDate=2026-07-14&endDate=2026-07-13')
      .set(authHeader(token));
    expect(res.status).toBe(400);
  });
});

describe('extended schedule settings sanitization', () => {
  it('persists interval mode with default anchor and returns it in definitions', async () => {
    const { token, user } = await createUser();
    const def = await HabitDefinition.create({ userId: user._id, name: 'Sauna', unitSymbol: 'min', type: 'duration' });

    const res = await request(app)
      .put(`/api/habits/settings/${def._id}`)
      .set(authHeader(token))
      .send({ scheduleMode: 'interval', scheduleIntervalDays: 3 });
    expect(res.status).toBe(200);

    const listed = await request(app).get('/api/habits/definitions').set(authHeader(token));
    const stored = listed.body.find(d => d._id === String(def._id));
    expect(stored.scheduleMode).toBe('interval');
    expect(stored.scheduleIntervalDays).toBe(3);
    expect(stored.scheduleAnchorDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('coerces invalid trigger combinations and falls back on garbage', async () => {
    const { token, user } = await createUser();
    const def = await HabitDefinition.create({ userId: user._id, name: 'X', unitSymbol: 'x' });

    // stravaSport can only be 'after'
    await request(app).put(`/api/habits/settings/${def._id}`).set(authHeader(token)).send({
      scheduleMode: 'trigger',
      scheduleTrigger: { kind: 'stravaSport', sport: 'Run', direction: 'before', offsetDays: 99 },
    });
    let listed = await request(app).get('/api/habits/definitions').set(authHeader(token));
    let stored = listed.body.find(d => d._id === String(def._id));
    expect(stored.scheduleTrigger).toMatchObject({ kind: 'stravaSport', direction: 'after', offsetDays: 30 });

    // Trigger mode without a valid trigger falls back to daily
    await request(app).put(`/api/habits/settings/${def._id}`).set(authHeader(token)).send({
      scheduleMode: 'trigger',
      scheduleTrigger: { kind: 'habit', refId: 'not-an-id' },
    });
    listed = await request(app).get('/api/habits/definitions').set(authHeader(token));
    stored = listed.body.find(d => d._id === String(def._id));
    expect(stored.scheduleMode).toBe('daily');
    expect(stored.scheduleTrigger).toBeNull();
  });
});

describe('planner provenance', () => {
  it('marks copied plans as copy-week while manual plans stay manual', async () => {
    const { token, user } = await createUser();
    const type = await ActivityType.create({ userId: user._id, label: 'Joggen', version: 1, nameHistory: [] });

    await request(app).post('/api/planner').set(authHeader(token)).send({
      activityType: 'Joggen', activityTypeRef: type._id, scheduledDate: '2026-07-15',
    });
    await request(app).post('/api/planner/copy-week').set(authHeader(token)).send({
      sourceStart: '2026-07-13', targetStart: '2026-07-20',
    });

    const week1 = await request(app)
      .get('/api/planner?startDate=2026-07-13&endDate=2026-07-19')
      .set(authHeader(token));
    expect(week1.body[0].source).toBe('manual');

    const week2 = await request(app)
      .get('/api/planner?startDate=2026-07-20&endDate=2026-07-26')
      .set(authHeader(token));
    expect(week2.body[0].source).toBe('copy-week');
  });
});
