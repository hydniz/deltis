const request = require('supertest');
const crypto = require('crypto');
const { startDb, stopDb, clearDb, buildApp, createUser } = require('./helpers/testApp');
const PluginInstall = require('../models/PluginInstall');
const PluginUserGrant = require('../models/PluginUserGrant');
const HabitDefinition = require('../models/HabitDefinition');
const HabitLog = require('../models/HabitLog');
const ActivityLog = require('../models/ActivityLog');
const ActivityPlan = require('../models/ActivityPlan');
const Goal = require('../models/Goal');
const WeightLog = require('../models/WeightLog');
const StravaConnection = require('../models/StravaConnection');
const StravaActivity = require('../models/StravaActivity');

let app;
const RAW_TOKEN = 'a'.repeat(64);
const TOKEN_HASH = crypto.createHash('sha256').update(RAW_TOKEN).digest('hex');

beforeAll(async () => {
  await startDb();
  app = buildApp();
});

afterEach(async () => {
  await clearDb();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await stopDb();
});

async function installPlugin(capabilities) {
  const admin = await createUser({ isAdmin: true });
  return PluginInstall.create({
    pluginId: 'strava-integration',
    source: 'verified',
    manifest: { id: 'strava-integration', name: 'Strava' },
    capabilities,
    consentedAt: new Date(),
    consentedBy: admin.user._id,
    status: 'running',
    tokenHash: TOKEN_HASH,
  });
}

function pluginAuthHeader(pluginId = 'strava-integration') {
  return { Authorization: `Bearer ${RAW_TOKEN}`, 'X-Plugin-Id': pluginId };
}

describe('plugin token authentication', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = await request(app).get('/api/plugin-host/v1/habits').set({ 'X-Plugin-Id': 'x' });
    expect(res.status).toBe(401);
  });

  it('rejects a request with no X-Plugin-Id header', async () => {
    const res = await request(app).get('/api/plugin-host/v1/habits').set({ Authorization: `Bearer ${RAW_TOKEN}` });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown plugin id', async () => {
    const res = await request(app).get('/api/plugin-host/v1/habits').set(pluginAuthHeader('never-installed'));
    expect(res.status).toBe(401);
  });

  it('rejects a wrong token for a known plugin', async () => {
    await installPlugin(['habits:read']);
    const res = await request(app).get('/api/plugin-host/v1/habits')
      .set({ Authorization: `Bearer ${'b'.repeat(64)}`, 'X-Plugin-Id': 'strava-integration' });
    expect(res.status).toBe(401);
  });

  it('rejects a disabled install even with the correct token', async () => {
    await installPlugin(['habits:read']);
    await PluginInstall.updateOne({ pluginId: 'strava-integration' }, { enabled: false });
    const res = await request(app).get('/api/plugin-host/v1/habits').set(pluginAuthHeader());
    expect(res.status).toBe(401);
  });
});

describe('capability gating', () => {
  it('403s a route the plugin did not declare the capability for', async () => {
    await installPlugin(['activities:read']); // no habits:read
    const res = await request(app).get('/api/plugin-host/v1/habits').set(pluginAuthHeader());
    expect(res.status).toBe(403);
  });
});

describe('per-user grant gating', () => {
  it('400s when X-Plugin-User-Id is missing', async () => {
    await installPlugin(['habits:read']);
    const res = await request(app).get('/api/plugin-host/v1/habits').set(pluginAuthHeader());
    expect(res.status).toBe(400);
  });

  it('403s when the target user has not granted this plugin', async () => {
    await installPlugin(['habits:read']);
    const { user } = await createUser();
    const res = await request(app).get('/api/plugin-host/v1/habits')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });
    expect(res.status).toBe(403);
  });
});

describe('data access, scoped to the granting user only', () => {
  async function grantedUser(capabilities) {
    await installPlugin(capabilities);
    const { user } = await createUser();
    await PluginUserGrant.create({ pluginId: 'strava-integration', userId: user._id, capabilities, enabled: true });
    return user;
  }

  it('reads only the granting user’s habits', async () => {
    const user = await grantedUser(['habits:read']);
    const other = await createUser();
    await HabitDefinition.create({ userId: user._id, name: 'Wasser trinken', unitSymbol: 'ml' });
    await HabitDefinition.create({ userId: other.user._id, name: 'Fremde Gewohnheit', unitSymbol: 'x' });
    await HabitDefinition.create({ userId: user._id, name: 'Gelöscht', unitSymbol: 'x', deletedAt: new Date() });

    const res = await request(app).get('/api/plugin-host/v1/habits')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.map(h => h.name)).toEqual(['Wasser trinken']);
  });

  it('reads only the granting user’s activities, newest first', async () => {
    const user = await grantedUser(['activities:read']);
    const other = await createUser();
    await ActivityLog.create({ userId: user._id, activityType: 'Lauf', date: new Date('2026-07-10T06:00:00Z') });
    await ActivityLog.create({ userId: user._id, activityType: 'Rad', date: new Date('2026-07-15T06:00:00Z') });
    await ActivityLog.create({ userId: other.user._id, activityType: 'Fremd', date: new Date('2026-07-16T06:00:00Z') });

    const res = await request(app).get('/api/plugin-host/v1/activities')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.map(a => a.activityType)).toEqual(['Rad', 'Lauf']);
  });

  it('filters activities by startDate/endDate together', async () => {
    const user = await grantedUser(['activities:read']);
    await ActivityLog.create({ userId: user._id, activityType: 'Zu früh', date: new Date('2026-06-01T06:00:00Z') });
    await ActivityLog.create({ userId: user._id, activityType: 'Im Fenster', date: new Date('2026-07-10T06:00:00Z') });
    await ActivityLog.create({ userId: user._id, activityType: 'Zu spät', date: new Date('2026-08-01T06:00:00Z') });

    const res = await request(app).get('/api/plugin-host/v1/activities')
      .query({ startDate: '2026-07-01', endDate: '2026-07-31', limit: 9999 })
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.map(a => a.activityType)).toEqual(['Im Fenster']);
  });

  it('filters activities by startDate alone', async () => {
    const user = await grantedUser(['activities:read']);
    await ActivityLog.create({ userId: user._id, activityType: 'Vorher', date: new Date('2026-06-01T06:00:00Z') });
    await ActivityLog.create({ userId: user._id, activityType: 'Nachher', date: new Date('2026-07-10T06:00:00Z') });

    const res = await request(app).get('/api/plugin-host/v1/activities')
      .query({ startDate: '2026-07-01' })
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.map(a => a.activityType)).toEqual(['Nachher']);
  });

  it('filters activities by endDate alone', async () => {
    const user = await grantedUser(['activities:read']);
    await ActivityLog.create({ userId: user._id, activityType: 'Vorher', date: new Date('2026-06-01T06:00:00Z') });
    await ActivityLog.create({ userId: user._id, activityType: 'Nachher', date: new Date('2026-07-10T06:00:00Z') });

    const res = await request(app).get('/api/plugin-host/v1/activities')
      .query({ endDate: '2026-06-30' })
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.map(a => a.activityType)).toEqual(['Vorher']);
  });

  it('writes an activity tagged with the plugin as its source', async () => {
    const user = await grantedUser(['activities:write']);

    const res = await request(app).post('/api/plugin-host/v1/activities')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ activityType: 'Lauf', date: '2026-07-21T06:00:00.000Z', duration: 30, distance: 5 });

    expect(res.status).toBe(201);
    expect(res.body.source).toBe('plugin:strava-integration');
    const stored = await ActivityLog.findOne({ userId: user._id });
    expect(stored.activityType).toBe('Lauf');
    expect(stored.source).toBe('plugin:strava-integration');
  });

  it('rejects an activity write missing required fields', async () => {
    const user = await grantedUser(['activities:write']);
    const res = await request(app).post('/api/plugin-host/v1/activities')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ duration: 30 });
    expect(res.status).toBe(400);
  });

  it('reads only the granting user’s active goals', async () => {
    const user = await grantedUser(['goals:read']);
    await Goal.create({
      userId: user._id, name: 'Aktiv', type: 'periodic-activity', targetRef: 'x', targetRefModel: 'activity',
      condition: 'min', targetValue: 1, isActive: true,
    });
    await Goal.create({
      userId: user._id, name: 'Inaktiv', type: 'periodic-activity', targetRef: 'x', targetRefModel: 'activity',
      condition: 'min', targetValue: 1, isActive: false,
    });

    const res = await request(app).get('/api/plugin-host/v1/goals')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });
    expect(res.status).toBe(200);
    expect(res.body.map(g => g.name)).toEqual(['Aktiv']);
  });

  it('creates a simple single-condition goal', async () => {
    const user = await grantedUser(['goals:write']);
    const res = await request(app).post('/api/plugin-host/v1/goals')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({
        name: 'Vom Plugin erstellt', type: 'periodic-activity', targetRef: 'x', targetRefModel: 'activity',
        condition: 'min', targetValue: 3, unitSymbol: 'Mal', metric: 'count', intervalValue: 1, intervalUnit: 'week',
      });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Vom Plugin erstellt');
    const stored = await Goal.findOne({ userId: user._id });
    expect(stored.targetValue).toBe(3);
  });

  it('rejects a goal write missing required fields', async () => {
    const user = await grantedUser(['goals:write']);
    const res = await request(app).post('/api/plugin-host/v1/goals')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ name: 'Unvollständig' });
    expect(res.status).toBe(400);
  });

  it('creates a habit definition', async () => {
    const user = await grantedUser(['habits:write']);
    const res = await request(app).post('/api/plugin-host/v1/habits')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ name: 'Wasser', unitSymbol: 'ml' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Wasser');
    expect(await HabitDefinition.countDocuments({ userId: user._id })).toBe(1);
  });

  it('rejects a habit write missing required fields', async () => {
    const user = await grantedUser(['habits:write']);
    const res = await request(app).post('/api/plugin-host/v1/habits')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ name: 'Ohne Einheit' });
    expect(res.status).toBe(400);
  });

  it('logs a value against the granting user’s own habit', async () => {
    const user = await grantedUser(['habits:write']);
    const habit = await HabitDefinition.create({ userId: user._id, name: 'Wasser', unitSymbol: 'ml' });

    const res = await request(app).post('/api/plugin-host/v1/habits/logs')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ habitId: habit._id.toString(), date: '2026-07-22T12:00:00.000Z', value: 500 });

    expect(res.status).toBe(201);
    expect(res.body.value).toBe(500);
    expect(await HabitLog.countDocuments({ habitId: habit._id })).toBe(1);
  });

  it('404s logging against a habit that is not the granting user’s own', async () => {
    const user = await grantedUser(['habits:write']);
    const other = await createUser();
    const foreignHabit = await HabitDefinition.create({ userId: other.user._id, name: 'Fremd', unitSymbol: 'x' });

    const res = await request(app).post('/api/plugin-host/v1/habits/logs')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ habitId: foreignHabit._id.toString(), date: '2026-07-22T12:00:00.000Z', value: 1 });
    expect(res.status).toBe(404);
  });

  it('rejects a habit log write missing required fields', async () => {
    const user = await grantedUser(['habits:write']);
    const res = await request(app).post('/api/plugin-host/v1/habits/logs')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ value: 1 });
    expect(res.status).toBe(400);
  });

  it('reads only the granting user’s planner entries in a date range', async () => {
    const user = await grantedUser(['planner:read']);
    const other = await createUser();
    await ActivityPlan.create({ userId: user._id, activityType: 'Lauf', scheduledDate: new Date('2026-07-20') });
    await ActivityPlan.create({ userId: user._id, activityType: 'Zu spät', scheduledDate: new Date('2026-08-01') });
    await ActivityPlan.create({ userId: other.user._id, activityType: 'Fremd', scheduledDate: new Date('2026-07-20') });

    const res = await request(app).get('/api/plugin-host/v1/planner')
      .query({ startDate: '2026-07-01', endDate: '2026-07-31' })
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });
    expect(res.status).toBe(200);
    expect(res.body.map(p => p.activityType)).toEqual(['Lauf']);
  });

  it('lists all of the granting user’s planner entries when no date range is given', async () => {
    const user = await grantedUser(['planner:read']);
    await ActivityPlan.create({ userId: user._id, activityType: 'Lauf', scheduledDate: new Date('2026-07-20') });

    const res = await request(app).get('/api/plugin-host/v1/planner')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('filters planner entries by startDate alone', async () => {
    const user = await grantedUser(['planner:read']);
    await ActivityPlan.create({ userId: user._id, activityType: 'Vorher', scheduledDate: new Date('2026-06-01') });
    await ActivityPlan.create({ userId: user._id, activityType: 'Nachher', scheduledDate: new Date('2026-07-20') });

    const res = await request(app).get('/api/plugin-host/v1/planner')
      .query({ startDate: '2026-07-01' })
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });
    expect(res.body.map(p => p.activityType)).toEqual(['Nachher']);
  });

  it('filters planner entries by endDate alone', async () => {
    const user = await grantedUser(['planner:read']);
    await ActivityPlan.create({ userId: user._id, activityType: 'Vorher', scheduledDate: new Date('2026-06-01') });
    await ActivityPlan.create({ userId: user._id, activityType: 'Nachher', scheduledDate: new Date('2026-07-20') });

    const res = await request(app).get('/api/plugin-host/v1/planner')
      .query({ endDate: '2026-06-30' })
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });
    expect(res.body.map(p => p.activityType)).toEqual(['Vorher']);
  });

  it('creates a planner entry tagged with plugin provenance', async () => {
    const user = await grantedUser(['planner:write']);
    const res = await request(app).post('/api/plugin-host/v1/planner')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ activityType: 'Lauf', scheduledDate: '2026-07-25', duration: 30 });
    expect(res.status).toBe(201);
    expect(res.body.source).toBe('plugin');
  });

  it('rejects a planner write missing required fields', async () => {
    const user = await grantedUser(['planner:write']);
    const res = await request(app).post('/api/plugin-host/v1/planner')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ duration: 30 });
    expect(res.status).toBe(400);
  });

  it('reads only the granting user’s weight history, newest first', async () => {
    const user = await grantedUser(['weight:read']);
    const other = await createUser();
    await WeightLog.create({ userId: user._id, date: new Date('2026-07-01'), weight: 80 });
    await WeightLog.create({ userId: user._id, date: new Date('2026-07-10'), weight: 79 });
    await WeightLog.create({ userId: other.user._id, date: new Date('2026-07-10'), weight: 100 });

    const res = await request(app).get('/api/plugin-host/v1/weight')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });
    expect(res.status).toBe(200);
    expect(res.body.map(w => w.weight)).toEqual([79, 80]);
  });

  it('logs a weight entry, defaulting the unit to kg', async () => {
    const user = await grantedUser(['weight:write']);
    const res = await request(app).post('/api/plugin-host/v1/weight')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ date: '2026-07-22', weight: 78.5 });
    expect(res.status).toBe(201);
    expect(res.body.unit).toBe('kg');
  });

  it('rejects a weight write missing required fields', async () => {
    const user = await grantedUser(['weight:write']);
    const res = await request(app).post('/api/plugin-host/v1/weight')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ date: '2026-07-22' });
    expect(res.status).toBe(400);
  });

  it('404s when the granting user record no longer exists', async () => {
    await installPlugin(['user:read']);
    const ghostId = new (require('mongoose').Types.ObjectId)();
    await PluginUserGrant.create({ pluginId: 'strava-integration', userId: ghostId, capabilities: ['user:read'], enabled: true });

    const res = await request(app).get('/api/plugin-host/v1/user')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': ghostId.toString() });
    expect(res.status).toBe(404);
  });

  it('reads basic user info but never the password hash', async () => {
    const user = await grantedUser(['user:read']);
    const res = await request(app).get('/api/plugin-host/v1/user')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(user._id.toString());
    expect(res.body.name).toBe(user.name);
    expect(res.body.username == null).toBe(true); // eslint-disable-line eqeqeq -- createUser() leaves it unset
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/i);
  });

  it('accepts (but does not yet deliver) a notification', async () => {
    const user = await grantedUser(['notifications:send']);
    const res = await request(app).post('/api/plugin-host/v1/notifications')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ title: 'Neue Aktivität synchronisiert' });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true, delivered: false, note: expect.any(String) });
  });

  it('rejects a notification with no title', async () => {
    const user = await grantedUser(['notifications:send']);
    const res = await request(app).post('/api/plugin-host/v1/notifications')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('unexpected database failures surface as 5xx, never crash the process', () => {
  it('pluginAuth 500s when the install lookup itself fails', async () => {
    await installPlugin(['habits:read']);
    jest.spyOn(PluginInstall, 'findOne').mockReturnValue({ select: () => Promise.reject(new Error('db down')) });

    const res = await request(app).get('/api/plugin-host/v1/habits').set(pluginAuthHeader());
    expect(res.status).toBe(500);
  });

  it('requireUserGrant 500s when the grant lookup fails', async () => {
    await installPlugin(['habits:read']);
    const { user } = await createUser();
    jest.spyOn(PluginUserGrant, 'findOne').mockRejectedValue(new Error('db down'));

    const res = await request(app).get('/api/plugin-host/v1/habits')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });
    expect(res.status).toBe(500);
  });

  async function grantedUser(capabilities) {
    await installPlugin(capabilities);
    const { user } = await createUser();
    await PluginUserGrant.create({ pluginId: 'strava-integration', userId: user._id, capabilities, enabled: true });
    return user;
  }

  it('GET /habits 500s when the query fails', async () => {
    const user = await grantedUser(['habits:read']);
    jest.spyOn(HabitDefinition, 'find').mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/api/plugin-host/v1/habits')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });
    expect(res.status).toBe(500);
  });

  it('GET /activities 500s when the query fails', async () => {
    const user = await grantedUser(['activities:read']);
    jest.spyOn(ActivityLog, 'find').mockImplementation(() => { throw new Error('db down'); });
    const res = await request(app).get('/api/plugin-host/v1/activities')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });
    expect(res.status).toBe(500);
  });

  it('POST /activities 400s when the write itself fails (e.g. validation at the DB layer)', async () => {
    const user = await grantedUser(['activities:write']);
    jest.spyOn(ActivityLog, 'create').mockRejectedValue(new Error('invalid data'));
    const res = await request(app).post('/api/plugin-host/v1/activities')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ activityType: 'Lauf', date: '2026-07-21T06:00:00.000Z' });
    expect(res.status).toBe(400);
  });

  it('GET /goals 500s when the query fails', async () => {
    const user = await grantedUser(['goals:read']);
    jest.spyOn(Goal, 'find').mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/api/plugin-host/v1/goals')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });
    expect(res.status).toBe(500);
  });

  it('GET /user 500s when the lookup fails', async () => {
    const user = await grantedUser(['user:read']);
    const User = require('../models/User');
    jest.spyOn(User, 'findById').mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/api/plugin-host/v1/user')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });
    expect(res.status).toBe(500);
  });

  it('POST /habits 400s when the write fails', async () => {
    const user = await grantedUser(['habits:write']);
    jest.spyOn(HabitDefinition, 'create').mockRejectedValue(new Error('invalid'));
    const res = await request(app).post('/api/plugin-host/v1/habits')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ name: 'X', unitSymbol: 'y' });
    expect(res.status).toBe(400);
  });

  it('POST /habits/logs 400s when the write fails', async () => {
    const user = await grantedUser(['habits:write']);
    const habit = await HabitDefinition.create({ userId: user._id, name: 'Wasser', unitSymbol: 'ml' });
    jest.spyOn(HabitLog, 'create').mockRejectedValue(new Error('invalid'));
    const res = await request(app).post('/api/plugin-host/v1/habits/logs')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ habitId: habit._id.toString(), date: '2026-07-22', value: 1 });
    expect(res.status).toBe(400);
  });

  it('POST /habits/logs 400s when the ownership lookup itself fails', async () => {
    const user = await grantedUser(['habits:write']);
    jest.spyOn(HabitDefinition, 'findOne').mockRejectedValue(new Error('db down'));
    const res = await request(app).post('/api/plugin-host/v1/habits/logs')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ habitId: new (require('mongoose').Types.ObjectId)().toString(), date: '2026-07-22', value: 1 });
    expect(res.status).toBe(400);
  });

  it('POST /goals 400s when the write fails', async () => {
    const user = await grantedUser(['goals:write']);
    jest.spyOn(Goal, 'create').mockRejectedValue(new Error('invalid'));
    const res = await request(app).post('/api/plugin-host/v1/goals')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ name: 'X', type: 'periodic-activity', targetRef: 'x', targetRefModel: 'activity', condition: 'min', targetValue: 1 });
    expect(res.status).toBe(400);
  });

  it('GET /planner 500s when the query fails', async () => {
    const user = await grantedUser(['planner:read']);
    jest.spyOn(ActivityPlan, 'find').mockImplementation(() => { throw new Error('db down'); });
    const res = await request(app).get('/api/plugin-host/v1/planner')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });
    expect(res.status).toBe(500);
  });

  it('POST /planner 400s when the write fails', async () => {
    const user = await grantedUser(['planner:write']);
    jest.spyOn(ActivityPlan, 'create').mockRejectedValue(new Error('invalid'));
    const res = await request(app).post('/api/plugin-host/v1/planner')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ activityType: 'Lauf', scheduledDate: '2026-07-22' });
    expect(res.status).toBe(400);
  });

  it('GET /weight 500s when the query fails', async () => {
    const user = await grantedUser(['weight:read']);
    jest.spyOn(WeightLog, 'find').mockImplementation(() => { throw new Error('db down'); });
    const res = await request(app).get('/api/plugin-host/v1/weight')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });
    expect(res.status).toBe(500);
  });

  it('POST /weight 400s when the write fails', async () => {
    const user = await grantedUser(['weight:write']);
    jest.spyOn(WeightLog, 'create').mockRejectedValue(new Error('invalid'));
    const res = await request(app).post('/api/plugin-host/v1/weight')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ date: '2026-07-22', weight: 80 });
    expect(res.status).toBe(400);
  });
});

describe('GET /granted-users', () => {
  it('lists only users who granted this specific plugin', async () => {
    await installPlugin(['strava:sync']);
    const { user: granted } = await createUser();
    const { user: notGranted } = await createUser();
    await PluginUserGrant.create({ pluginId: 'strava-integration', userId: granted._id, capabilities: ['strava:sync'], enabled: true });
    await PluginUserGrant.create({ pluginId: 'strava-integration', userId: notGranted._id, capabilities: ['strava:sync'], enabled: false });

    const res = await request(app).get('/api/plugin-host/v1/granted-users').set(pluginAuthHeader());
    expect(res.status).toBe(200);
    expect(res.body.map(g => g.userId)).toEqual([granted._id.toString()]);
  });

  it('500s when the lookup fails', async () => {
    await installPlugin(['strava:sync']);
    jest.spyOn(PluginUserGrant, 'find').mockReturnValue({ select: () => Promise.reject(new Error('db down')) });
    const res = await request(app).get('/api/plugin-host/v1/granted-users').set(pluginAuthHeader());
    expect(res.status).toBe(500);
  });
});

describe('Strava sync (strava:sync capability)', () => {
  async function grantedUser(capabilities = ['strava:sync']) {
    await installPlugin(capabilities);
    const { user } = await createUser();
    await PluginUserGrant.create({ pluginId: 'strava-integration', userId: user._id, capabilities, enabled: true });
    return user;
  }

  it('reports connected:false for a user with no Strava connection', async () => {
    const user = await grantedUser();
    const res = await request(app).get('/api/plugin-host/v1/strava/connection')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false });
  });

  it('returns a fresh access token and never the refresh token', async () => {
    const user = await grantedUser();
    await StravaConnection.create({
      userId: user._id, athleteId: 4711, accessToken: 'access-tok', refreshToken: 'refresh-tok',
      expiresAt: new Date(Date.now() + 3600000), scope: 'read,activity:read_all',
    });

    const res = await request(app).get('/api/plugin-host/v1/strava/connection')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ connected: true, athleteId: 4711, accessToken: 'access-tok', initialSyncDone: false });
    expect(JSON.stringify(res.body)).not.toContain('refresh-tok');
  });

  it('500s when the connection lookup fails', async () => {
    const user = await grantedUser();
    jest.spyOn(StravaConnection, 'findOne').mockReturnValue({ select: () => Promise.reject(new Error('db down')) });
    const res = await request(app).get('/api/plugin-host/v1/strava/connection')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });
    expect(res.status).toBe(500);
  });

  it('records a sync result and marks the initial sync done', async () => {
    const user = await grantedUser();
    await StravaConnection.create({
      userId: user._id, athleteId: 4711, accessToken: 'a', refreshToken: 'r',
      expiresAt: new Date(Date.now() + 3600000),
    });

    const res = await request(app).post('/api/plugin-host/v1/strava/sync-result')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ synced: 3, failed: 1 });
    expect(res.status).toBe(200);

    const connection = await StravaConnection.findOne({ userId: user._id });
    expect(connection.lastSyncSyncedCount).toBe(3);
    expect(connection.lastSyncFailedCount).toBe(1);
    expect(connection.lastSyncError).toBeNull();
    expect(connection.initialSyncDone).toBe(true);
  });

  it('records a sync error', async () => {
    const user = await grantedUser();
    await StravaConnection.create({
      userId: user._id, athleteId: 4711, accessToken: 'a', refreshToken: 'r',
      expiresAt: new Date(Date.now() + 3600000), initialSyncDone: true,
    });

    await request(app).post('/api/plugin-host/v1/strava/sync-result')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ synced: 0, failed: 1, error: 'Rate Limit Exceeded' });

    const connection = await StravaConnection.findOne({ userId: user._id });
    expect(connection.lastSyncError).toBe('Rate Limit Exceeded');
  });

  it('records a fully successful sync with zero failures', async () => {
    const user = await grantedUser();
    await StravaConnection.create({
      userId: user._id, athleteId: 4711, accessToken: 'a', refreshToken: 'r', expiresAt: new Date(Date.now() + 3600000),
    });

    await request(app).post('/api/plugin-host/v1/strava/sync-result')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ synced: 5, failed: 0 });

    const connection = await StravaConnection.findOne({ userId: user._id });
    expect(connection.lastSyncSyncedCount).toBe(5);
    expect(connection.lastSyncFailedCount).toBe(0);
    expect(connection.lastSyncError).toBeNull();
  });

  it('404s a sync-result for a user with no connection', async () => {
    const user = await grantedUser();
    const res = await request(app).post('/api/plugin-host/v1/strava/sync-result')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ synced: 0, failed: 0 });
    expect(res.status).toBe(404);
  });

  it('500s when saving the sync result fails', async () => {
    const user = await grantedUser();
    await StravaConnection.create({
      userId: user._id, athleteId: 4711, accessToken: 'a', refreshToken: 'r', expiresAt: new Date(Date.now() + 3600000),
    });
    jest.spyOn(StravaConnection, 'findOne').mockRejectedValue(new Error('db down'));
    const res = await request(app).post('/api/plugin-host/v1/strava/sync-result')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ synced: 0, failed: 0 });
    expect(res.status).toBe(500);
  });

  it('upserts a synced activity without creating duplicates', async () => {
    const user = await grantedUser();
    await StravaConnection.create({
      userId: user._id, athleteId: 4711, accessToken: 'a', refreshToken: 'r', expiresAt: new Date(Date.now() + 3600000),
    });

    const detail = (extra = {}) => ({
      id: 99, name: 'Lauf', sport_type: 'Run', type: 'Run', start_date: '2026-07-20T06:00:00Z',
      moving_time: 1800, distance: 5000, ...extra,
    });

    await request(app).post('/api/plugin-host/v1/strava/activities')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ detail: detail() });
    const res = await request(app).post('/api/plugin-host/v1/strava/activities')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ detail: detail({ name: 'Umbenannt' }), zones: [{ type: 'heartrate' }], streams: { heartrate: { data: [140] } } });

    expect(res.status).toBe(201);
    const docs = await StravaActivity.find({ userId: user._id });
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe('Umbenannt');
    expect(docs[0].athleteId).toBe(4711);
    expect(docs[0].zones[0].type).toBe('heartrate');
  });

  it('stores start_date_local when provided and defaults a missing name to empty string', async () => {
    const user = await grantedUser();
    await StravaConnection.create({
      userId: user._id, athleteId: 4711, accessToken: 'a', refreshToken: 'r', expiresAt: new Date(Date.now() + 3600000),
    });

    const res = await request(app).post('/api/plugin-host/v1/strava/activities')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ detail: { id: 100, start_date: '2026-07-20T06:00:00Z', start_date_local: '2026-07-20T08:00:00Z' } });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('');
    expect(new Date(res.body.startDateLocal).toISOString()).toBe('2026-07-20T08:00:00.000Z');
  });

  it('rejects an activity write with no detail.id', async () => {
    const user = await grantedUser();
    const res = await request(app).post('/api/plugin-host/v1/strava/activities')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ detail: { name: 'x' } });
    expect(res.status).toBe(400);
  });

  it('400s when the activity upsert fails', async () => {
    const user = await grantedUser();
    jest.spyOn(StravaActivity, 'findOneAndUpdate').mockRejectedValue(new Error('invalid'));
    const res = await request(app).post('/api/plugin-host/v1/strava/activities')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() })
      .send({ detail: { id: 1, name: 'x' } });
    expect(res.status).toBe(400);
  });

  it('deletes a synced activity', async () => {
    const user = await grantedUser();
    await StravaActivity.create({ userId: user._id, stravaId: 42, athleteId: 4711, startDate: new Date() });

    const res = await request(app).delete('/api/plugin-host/v1/strava/activities/42')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });
    expect(res.status).toBe(200);
    expect(await StravaActivity.findOne({ userId: user._id, stravaId: 42 })).toBeNull();
  });

  it('500s when the activity delete fails', async () => {
    const user = await grantedUser();
    jest.spyOn(StravaActivity, 'deleteOne').mockRejectedValue(new Error('db down'));
    const res = await request(app).delete('/api/plugin-host/v1/strava/activities/42')
      .set({ ...pluginAuthHeader(), 'X-Plugin-User-Id': user._id.toString() });
    expect(res.status).toBe(500);
  });
});
