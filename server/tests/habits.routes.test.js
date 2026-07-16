const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createUser, authHeader } = require('./helpers/testApp');
const HabitDefinition = require('../models/HabitDefinition');
const HabitLog = require('../models/HabitLog');

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

async function createHabitDef(userId, overrides = {}) {
  return HabitDefinition.create({
    userId,
    name: 'Water',
    unitSymbol: 'ml',
    type: 'amount',
    isPredefined: false,
    version: 1,
    nameHistory: [],
    ...overrides,
  });
}

describe('GET /api/habits/definitions', () => {
  it('returns user-owned and predefined habits', async () => {
    const { token, user } = await createUser();
    await HabitDefinition.create({ userId: null, name: 'Sleep', unitSymbol: 'h', type: 'duration', isPredefined: true, version: 1, nameHistory: [] });
    await createHabitDef(user._id, { name: 'My Habit' });

    const res = await request(app)
      .get('/api/habits/definitions')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.some(h => h.name === 'Sleep')).toBe(true);
    expect(res.body.some(h => h.name === 'My Habit')).toBe(true);
  });

  it('does not return another user\'s custom habits', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    await createHabitDef(other._id, { name: 'Secret Habit' });

    const res = await request(app)
      .get('/api/habits/definitions')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.some(h => h.name === 'Secret Habit')).toBe(false);
  });

  it('marks no habits as selected when user has no selection (opt-in)', async () => {
    const { token } = await createUser();
    await HabitDefinition.create({ userId: null, name: 'Kreatin', unitSymbol: 'g', type: 'amount', isPredefined: true, version: 1, nameHistory: [] });

    const res = await request(app)
      .get('/api/habits/definitions')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.every(h => h.selected === false)).toBe(true);
  });

  it('marks only explicitly selected habits as selected', async () => {
    const { token, user } = await createUser();
    const picked = await createHabitDef(user._id, { name: 'Picked' });
    await createHabitDef(user._id, { name: 'Not picked' });

    await request(app)
      .put('/api/habits/selection')
      .set(authHeader(token))
      .send({ selectedIds: [picked._id.toString()] });

    const res = await request(app)
      .get('/api/habits/definitions')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.find(h => h.name === 'Picked').selected).toBe(true);
    expect(res.body.find(h => h.name === 'Not picked').selected).toBe(false);
  });
});

describe('POST /api/habits/definitions', () => {
  it('creates a new custom habit definition', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .post('/api/habits/definitions')
      .set(authHeader(token))
      .send({ name: 'Meditation', unitSymbol: 'min', type: 'duration' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Meditation');
    expect(res.body.unitSymbol).toBe('min');
    expect(res.body.isPredefined).toBe(false);
  });

  it('requires a name', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .post('/api/habits/definitions')
      .set(authHeader(token))
      .send({ unitSymbol: 'ml' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/habits/definitions/:id', () => {
  it('updates a custom habit and tracks version history when name changes', async () => {
    const { token, user } = await createUser();
    const def = await createHabitDef(user._id, { name: 'Old Name' });

    const res = await request(app)
      .put(`/api/habits/definitions/${def._id}`)
      .set(authHeader(token))
      .send({ name: 'New Name', unitSymbol: 'ml' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
    expect(res.body.version).toBe(2);
  });

  it('does not bump version when only non-name fields change', async () => {
    const { token, user } = await createUser();
    const def = await createHabitDef(user._id);

    const res = await request(app)
      .put(`/api/habits/definitions/${def._id}`)
      .set(authHeader(token))
      .send({ name: 'Water', unitSymbol: 'ml', type: 'amount' });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
  });

  it('returns 404 when trying to update a predefined habit', async () => {
    const { token } = await createUser();
    const predefined = await HabitDefinition.create({ userId: null, name: 'Schlaf', unitSymbol: 'h', type: 'duration', isPredefined: true, version: 1, nameHistory: [] });

    const res = await request(app)
      .put(`/api/habits/definitions/${predefined._id}`)
      .set(authHeader(token))
      .send({ name: 'Renamed' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/habits/definitions/:id', () => {
  it('deletes a user-owned habit definition', async () => {
    const { token, user } = await createUser();
    const def = await createHabitDef(user._id);

    const res = await request(app)
      .delete(`/api/habits/definitions/${def._id}`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('hides a predefined habit for this user only and allows restoring it', async () => {
    const { token, user } = await createUser();
    const { token: otherToken } = await createUser();
    const predefined = await HabitDefinition.create({
      userId: null, name: 'Wasser', unitSymbol: 'ml', type: 'amount',
      isPredefined: true, version: 1, nameHistory: [],
    });

    const delRes = await request(app)
      .delete(`/api/habits/definitions/${predefined._id}`)
      .set(authHeader(token));
    expect(delRes.status).toBe(200);
    expect(delRes.body.hidden).toBe(true);

    // Global definition still exists, only hidden for this user
    expect(await HabitDefinition.findById(predefined._id)).not.toBeNull();
    const mine = await request(app).get('/api/habits/definitions').set(authHeader(token));
    expect(mine.body.find(d => d._id === predefined._id.toString())).toBeUndefined();
    const others = await request(app).get('/api/habits/definitions').set(authHeader(otherToken));
    expect(others.body.find(d => d._id === predefined._id.toString())).toBeDefined();

    // includeHidden exposes it with the hidden flag for the manage modal
    const withHidden = await request(app)
      .get('/api/habits/definitions?includeHidden=true')
      .set(authHeader(token));
    const hiddenDef = withHidden.body.find(d => d._id === predefined._id.toString());
    expect(hiddenDef.hidden).toBe(true);
    expect(hiddenDef.selected).toBe(false);

    // Restore brings it back
    await request(app)
      .post(`/api/habits/definitions/${predefined._id}/restore`)
      .set(authHeader(token));
    const restored = await request(app).get('/api/habits/definitions').set(authHeader(token));
    expect(restored.body.find(d => d._id === predefined._id.toString())).toBeDefined();
  });

  it('returns 404 for a definition that does not exist', async () => {
    const { token, user } = await createUser();
    const def = await createHabitDef(user._id);
    await HabitDefinition.deleteOne({ _id: def._id });

    const res = await request(app)
      .delete(`/api/habits/definitions/${def._id}`)
      .set(authHeader(token));
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/habits/selection', () => {
  it('saves the selected habit IDs for the user', async () => {
    const { token, user } = await createUser();
    const def = await createHabitDef(user._id);

    const res = await request(app)
      .put('/api/habits/selection')
      .set(authHeader(token))
      .send({ selectedIds: [def._id.toString()] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('PUT /api/habits/settings/:id', () => {
  it('saves per-habit settings for the user', async () => {
    const { token, user } = await createUser();
    const def = await createHabitDef(user._id);

    const res = await request(app)
      .put(`/api/habits/settings/${def._id}`)
      .set(authHeader(token))
      .send({ missingDayMode: 'zero', defaultValue: 0 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('persists scheduleDays and returns them via GET /definitions', async () => {
    const { token, user } = await createUser();
    const def = await createHabitDef(user._id);

    const putRes = await request(app)
      .put(`/api/habits/settings/${def._id}`)
      .set(authHeader(token))
      .send({ missingDayMode: 'none', defaultValue: 0, scheduleDays: [1, 3, 5] });
    expect(putRes.status).toBe(200);

    const getRes = await request(app)
      .get('/api/habits/definitions')
      .set(authHeader(token));
    expect(getRes.status).toBe(200);
    const habit = getRes.body.find(d => d._id === def._id.toString());
    expect(habit.scheduleDays).toEqual([1, 3, 5]);
  });

  it('sanitizes invalid scheduleDays values', async () => {
    const { token, user } = await createUser();
    const def = await createHabitDef(user._id);

    await request(app)
      .put(`/api/habits/settings/${def._id}`)
      .set(authHeader(token))
      .send({ missingDayMode: 'none', defaultValue: 0, scheduleDays: [5, 5, -1, 7, 'x', 2.5, 0] });

    const getRes = await request(app)
      .get('/api/habits/definitions')
      .set(authHeader(token));
    const habit = getRes.body.find(d => d._id === def._id.toString());
    expect(habit.scheduleDays).toEqual([0, 5]);
  });

  it('persists a one-off scheduleDate and returns it via GET /definitions', async () => {
    const { token, user } = await createUser();
    const def = await createHabitDef(user._id);

    await request(app)
      .put(`/api/habits/settings/${def._id}`)
      .set(authHeader(token))
      .send({ missingDayMode: 'none', defaultValue: 0, scheduleDate: '2026-07-20' });

    const getRes = await request(app)
      .get('/api/habits/definitions')
      .set(authHeader(token));
    const habit = getRes.body.find(d => d._id === def._id.toString());
    expect(habit.scheduleDate).toBe('2026-07-20');
  });

  it('rejects malformed scheduleDate values as null', async () => {
    const { token, user } = await createUser();
    const def = await createHabitDef(user._id);

    await request(app)
      .put(`/api/habits/settings/${def._id}`)
      .set(authHeader(token))
      .send({ missingDayMode: 'none', defaultValue: 0, scheduleDate: '20.07.2026' });

    const getRes = await request(app)
      .get('/api/habits/definitions')
      .set(authHeader(token));
    const habit = getRes.body.find(d => d._id === def._id.toString());
    expect(habit.scheduleDate).toBeNull();
  });

  it('persists a completion target and returns it via GET /definitions', async () => {
    const { token, user } = await createUser();
    const def = await createHabitDef(user._id);

    await request(app)
      .put(`/api/habits/settings/${def._id}`)
      .set(authHeader(token))
      .send({ missingDayMode: 'none', defaultValue: 0, targetCondition: 'min', targetValue: 8 });

    const getRes = await request(app)
      .get('/api/habits/definitions')
      .set(authHeader(token));
    const habit = getRes.body.find(d => d._id === def._id.toString());
    expect(habit.targetCondition).toBe('min');
    expect(habit.targetValue).toBe(8);
  });

  it('sanitizes invalid target settings to none', async () => {
    const { token, user } = await createUser();
    const def = await createHabitDef(user._id);

    await request(app)
      .put(`/api/habits/settings/${def._id}`)
      .set(authHeader(token))
      .send({ missingDayMode: 'none', defaultValue: 0, targetCondition: 'banana', targetValue: -5 });

    const getRes = await request(app)
      .get('/api/habits/definitions')
      .set(authHeader(token));
    const habit = getRes.body.find(d => d._id === def._id.toString());
    expect(habit.targetCondition).toBe('none');
    expect(habit.targetValue).toBe(0);
  });

  it('defaults scheduleDays to an empty array when not provided', async () => {
    const { token, user } = await createUser();
    const def = await createHabitDef(user._id);

    await request(app)
      .put(`/api/habits/settings/${def._id}`)
      .set(authHeader(token))
      .send({ missingDayMode: 'default', defaultValue: 2 });

    const getRes = await request(app)
      .get('/api/habits/definitions')
      .set(authHeader(token));
    const habit = getRes.body.find(d => d._id === def._id.toString());
    expect(habit.scheduleDays).toEqual([]);
  });
});

describe('GET /api/habits/logs', () => {
  it('returns habit logs for the current user', async () => {
    const { token, user } = await createUser();
    const def = await createHabitDef(user._id);
    await HabitLog.create({ userId: user._id, habitId: def._id, date: new Date('2024-01-10'), value: 2000 });

    const res = await request(app)
      .get('/api/habits/logs')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].value).toBe(2000);
  });

  it('does not return logs from another user', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    const def = await createHabitDef(other._id);
    await HabitLog.create({ userId: other._id, habitId: def._id, date: new Date(), value: 500 });

    const res = await request(app)
      .get('/api/habits/logs')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });

  it('filters logs by date range', async () => {
    const { token, user } = await createUser();
    const def = await createHabitDef(user._id);
    await HabitLog.create({ userId: user._id, habitId: def._id, date: new Date('2024-01-05'), value: 100 });
    await HabitLog.create({ userId: user._id, habitId: def._id, date: new Date('2024-01-15'), value: 200 });

    const res = await request(app)
      .get('/api/habits/logs?startDate=2024-01-10&endDate=2024-01-20')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].value).toBe(200);
  });
});

describe('POST /api/habits/logs', () => {
  it('creates or upserts a habit log for the day', async () => {
    const { token, user } = await createUser();
    const def = await createHabitDef(user._id);

    const res = await request(app)
      .post('/api/habits/logs')
      .set(authHeader(token))
      .send({ habitId: def._id, date: '2024-01-10', value: 1500 });
    expect(res.status).toBe(201);
    expect(res.body.value).toBe(1500);
  });

  it('upserts when a log already exists for the same day', async () => {
    const { token, user } = await createUser();
    const def = await createHabitDef(user._id);

    await request(app)
      .post('/api/habits/logs')
      .set(authHeader(token))
      .send({ habitId: def._id, date: '2024-01-10', value: 1000 });

    const res = await request(app)
      .post('/api/habits/logs')
      .set(authHeader(token))
      .send({ habitId: def._id, date: '2024-01-10', value: 2000 });
    expect(res.status).toBe(201);
    expect(res.body.value).toBe(2000);

    const logs = await HabitLog.find({ userId: user._id, habitId: def._id });
    expect(logs.length).toBe(1);
  });
});

describe('DELETE /api/habits/logs/:id', () => {
  it('deletes a habit log belonging to the user', async () => {
    const { token, user } = await createUser();
    const def = await createHabitDef(user._id);
    const log = await HabitLog.create({ userId: user._id, habitId: def._id, date: new Date(), value: 500 });

    const res = await request(app)
      .delete(`/api/habits/logs/${log._id}`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('does not delete a log owned by another user', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    const def = await createHabitDef(other._id);
    const log = await HabitLog.create({ userId: other._id, habitId: def._id, date: new Date(), value: 500 });

    const res = await request(app)
      .delete(`/api/habits/logs/${log._id}`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    const stillExists = await HabitLog.findById(log._id);
    expect(stillExists).not.toBeNull();
  });
});
