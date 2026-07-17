// Security regression tests: NoSQL injection, mass assignment, cross-tenant
// references, session invalidation, cascade deletion and hardening middleware.
const request = require('supertest');
const AdmZip = require('adm-zip');
const { startDb, stopDb, clearDb, buildApp, createUser, createUserWithPassword, createAdminUser, authHeader } = require('./helpers/testApp');
const User = require('../models/User');
const ActivityType = require('../models/ActivityType');
const ActivityLog = require('../models/ActivityLog');
const HabitDefinition = require('../models/HabitDefinition');
const HabitLog = require('../models/HabitLog');
const HabitPlan = require('../models/HabitPlan');
const WeightLog = require('../models/WeightLog');
const Goal = require('../models/Goal');
const { _sanitize } = require('../middleware/sanitizeBody');

let app;

beforeAll(async () => {
  await startDb();
  app = buildApp();
});

afterEach(async () => {
  await clearDb();
  require('../routes/auth').resetRateLimits();
  require('../routes/admin').resetRateLimits();
  require('../routes/init').resetRateLimits();
});

afterAll(async () => {
  await stopDb();
});

async function createOwnActivityType(userId, label = 'Joggen') {
  return ActivityType.create({ userId, label, showDistance: true, showDuration: true, customFields: [], version: 1, nameHistory: [] });
}

// ─ sanitizeBody middleware

describe('sanitizeBody', () => {
  it('strips $-operator, dotted and prototype keys recursively', () => {
    const body = {
      ok: 'yes',
      $where: 'attack',
      'a.b': 1,
      nested: { $gt: '', safe: true, list: [{ $ne: 1, keep: 2 }] },
    };
    _sanitize(body);
    expect(body).toEqual({ ok: 'yes', nested: { safe: true, list: [{ keep: 2 }] } });
  });

  it('removes operator keys from request bodies before routes see them', async () => {
    const { token } = await createUser();
    // $-keys inside customValues silently disappear instead of reaching Mongo.
    const res = await request(app)
      .post('/api/activities')
      .set(authHeader(token))
      .send({ activityType: 'Yoga', date: '2024-01-15', customValues: { '$set': { hacked: 1 }, mood: 'good' } });
    expect(res.status).toBe(201);
    expect(res.body.customValues).toEqual({ mood: 'good' });
  });
});

// ─ Login hardening

describe('POST /api/auth/login – injection', () => {
  it('rejects a non-string identifier (NoSQL injection)', async () => {
    await createUser(); // UUID-only account that an injected $gt would match
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: { $gt: '' } });
    expect(res.status).toBe(400);
  });

  it('rejects a non-string password', async () => {
    const { username } = await createUserWithPassword();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: username, password: { $gt: '' } });
    expect(res.status).toBe(400);
  });
});

// ─ Session invalidation on password change

describe('session versioning', () => {
  it('invalidates old sessions after a password change but keeps the current one', async () => {
    const { username, password } = await createUserWithPassword();

    const login = await request(app)
      .post('/api/auth/login')
      .send({ identifier: username, password });
    expect(login.status).toBe(200);
    const oldCookie = login.headers['set-cookie'][0].split(';')[0];

    const change = await request(app)
      .put('/api/auth/me/password')
      .set('Cookie', oldCookie)
      .send({ currentPassword: password, newPassword: 'newpassword123' });
    expect(change.status).toBe(200);
    const newCookie = change.headers['set-cookie'][0].split(';')[0];

    const withOld = await request(app).get('/api/auth/me').set('Cookie', oldCookie);
    expect(withOld.status).toBe(401);

    const withNew = await request(app).get('/api/auth/me').set('Cookie', newCookie);
    expect(withNew.status).toBe(200);
  });

  it('invalidates user sessions when an admin resets the password', async () => {
    const admin = await createAdminUser();
    const target = await createUserWithPassword({ username: 'opfer' });

    const me = await request(app).get('/api/auth/me').set(authHeader(target.token));
    expect(me.status).toBe(200);

    const reset = await request(app)
      .put(`/api/admin/users/${target.user._id}`)
      .set(authHeader(admin.token))
      .send({ password: 'resetpassword123' });
    expect(reset.status).toBe(200);

    const afterReset = await request(app).get('/api/auth/me').set(authHeader(target.token));
    expect(afterReset.status).toBe(401);
  });
});

// ─ Profile update validation

describe('PUT /api/auth/me', () => {
  it('rejects an invalid weight unit', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .put('/api/auth/me')
      .set(authHeader(token))
      .send({ weightUnit: 'stone' });
    expect(res.status).toBe(400);
  });

  it('rejects an overlong name', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .put('/api/auth/me')
      .set(authHeader(token))
      .send({ name: 'x'.repeat(61) });
    expect(res.status).toBe(400);
  });

  it('cannot set isAdmin or other foreign fields', async () => {
    const { token, user } = await createUser();
    const res = await request(app)
      .put('/api/auth/me')
      .set(authHeader(token))
      .send({ name: 'Neuer Name', isAdmin: true, uuid: 'evil' });
    expect(res.status).toBe(200);
    const fresh = await User.findById(user._id);
    expect(fresh.isAdmin).toBe(false);
    expect(fresh.uuid).toBe(user.uuid);
    expect(fresh.name).toBe('Neuer Name');
  });
});

// ─ Mass assignment: userId must stay server-owned

describe('mass assignment protection', () => {
  it('POST /api/goals ignores a userId in the body', async () => {
    const { token, user } = await createUser();
    const other = await createUser({ name: 'Other' });
    const type = await createOwnActivityType(user._id);

    const res = await request(app)
      .post('/api/goals')
      .set(authHeader(token))
      .send({
        userId: other.user._id,
        name: 'Injected', type: 'periodic-activity',
        targetRef: type._id, targetRefModel: 'ActivityType',
        condition: 'min', targetValue: 5, metric: 'count', isActive: true,
      });
    expect(res.status).toBe(201);
    const goal = await Goal.findById(res.body._id);
    expect(goal.userId.toString()).toBe(user._id.toString());
  });

  it('PUT /api/goals/:id cannot move a goal to another user', async () => {
    const { token, user } = await createUser();
    const other = await createUser({ name: 'Other' });
    const type = await createOwnActivityType(user._id);
    const goal = await Goal.create({
      userId: user._id, name: 'Mine', type: 'periodic-activity',
      targetRef: type._id, targetRefModel: 'ActivityType',
      condition: 'min', targetValue: 5, metric: 'count', isActive: true,
    });

    const res = await request(app)
      .put(`/api/goals/${goal._id}`)
      .set(authHeader(token))
      .send({ userId: other.user._id, name: 'Still mine' });
    expect(res.status).toBe(200);
    const fresh = await Goal.findById(goal._id);
    expect(fresh.userId.toString()).toBe(user._id.toString());
    expect(fresh.name).toBe('Still mine');
  });

  it('POST /api/activity-types ignores a userId in the body', async () => {
    const { token, user } = await createUser();
    const other = await createUser({ name: 'Other' });

    const res = await request(app)
      .post('/api/activity-types')
      .set(authHeader(token))
      .send({ label: 'Klettern', userId: other.user._id, version: 99 });
    expect(res.status).toBe(201);
    const type = await ActivityType.findById(res.body._id);
    expect(type.userId.toString()).toBe(user._id.toString());
    expect(type.version).toBe(1);
  });

  it('PUT /api/activities/:id cannot change the owner', async () => {
    const { token, user } = await createUser();
    const other = await createUser({ name: 'Other' });
    const log = await ActivityLog.create({ userId: user._id, activityType: 'Yoga', date: new Date() });

    const res = await request(app)
      .put(`/api/activities/${log._id}`)
      .set(authHeader(token))
      .send({ userId: other.user._id, notes: 'updated' });
    expect(res.status).toBe(200);
    const fresh = await ActivityLog.findById(log._id);
    expect(fresh.userId.toString()).toBe(user._id.toString());
    expect(fresh.notes).toBe('updated');
  });

  it('PUT /api/planner/habits/:id cannot change habitId or owner', async () => {
    const { token, user } = await createUser();
    const other = await createUser({ name: 'Other' });
    const habit = await HabitDefinition.create({ userId: user._id, name: 'Wasser', unitSymbol: 'ml', type: 'amount', version: 1, nameHistory: [] });
    const plan = await HabitPlan.create({ userId: user._id, habitId: habit._id, habitName: 'Wasser', scheduledDate: new Date() });

    const res = await request(app)
      .put(`/api/planner/habits/${plan._id}`)
      .set(authHeader(token))
      .send({ userId: other.user._id, habitId: other.user._id, completed: true });
    expect(res.status).toBe(200);
    const fresh = await HabitPlan.findById(plan._id);
    expect(fresh.userId.toString()).toBe(user._id.toString());
    expect(fresh.habitId.toString()).toBe(habit._id.toString());
    expect(fresh.completed).toBe(true);
  });
});

// ─ Cross-tenant references

describe('cross-tenant reference protection', () => {
  it('POST /api/activities rejects another user\'s activityTypeRef', async () => {
    const { token } = await createUser();
    const other = await createUser({ name: 'Other' });
    const foreignType = await createOwnActivityType(other.user._id);

    const res = await request(app)
      .post('/api/activities')
      .set(authHeader(token))
      .send({ activityType: 'Joggen', activityTypeRef: foreignType._id, date: '2024-01-15' });
    expect(res.status).toBe(404);
  });

  it('POST /api/planner rejects another user\'s activityTypeRef', async () => {
    const { token } = await createUser();
    const other = await createUser({ name: 'Other' });
    const foreignType = await createOwnActivityType(other.user._id);

    const res = await request(app)
      .post('/api/planner')
      .set(authHeader(token))
      .send({ activityType: 'Joggen', activityTypeRef: foreignType._id, scheduledDate: '2024-01-15' });
    expect(res.status).toBe(404);
  });

  it('POST /api/planner/habits rejects another user\'s habit', async () => {
    const { token } = await createUser();
    const other = await createUser({ name: 'Other' });
    const foreignHabit = await HabitDefinition.create({ userId: other.user._id, name: 'Fremd', unitSymbol: 'x', type: 'amount', version: 1, nameHistory: [] });

    const res = await request(app)
      .post('/api/planner/habits')
      .set(authHeader(token))
      .send({ habitId: foreignHabit._id, scheduledDate: '2024-01-20' });
    expect(res.status).toBe(404);
  });

  it('POST /api/habits/logs rejects another user\'s habit but allows global ones', async () => {
    const { token, user } = await createUser();
    const other = await createUser({ name: 'Other' });
    const foreignHabit = await HabitDefinition.create({ userId: other.user._id, name: 'Fremd', unitSymbol: 'x', type: 'amount', version: 1, nameHistory: [] });
    const globalHabit = await HabitDefinition.create({ userId: null, name: 'Wasser', unitSymbol: 'ml', type: 'amount', isPredefined: true, version: 1, nameHistory: [] });

    const foreign = await request(app)
      .post('/api/habits/logs')
      .set(authHeader(token))
      .send({ habitId: foreignHabit._id, date: '2024-01-10', value: 1 });
    expect(foreign.status).toBe(404);
    expect(await HabitLog.countDocuments({ userId: user._id })).toBe(0);

    const global = await request(app)
      .post('/api/habits/logs')
      .set(authHeader(token))
      .send({ habitId: globalHabit._id, date: '2024-01-10', value: 500 });
    expect(global.status).toBe(201);
  });

  it('POST /api/goals rejects a targetRef pointing at another user\'s activity type', async () => {
    const { token } = await createUser();
    const other = await createUser({ name: 'Other' });
    const foreignType = await createOwnActivityType(other.user._id);

    const res = await request(app)
      .post('/api/goals')
      .set(authHeader(token))
      .send({
        name: 'Spy', type: 'periodic-activity',
        targetRef: foreignType._id, targetRefModel: 'ActivityType',
        condition: 'min', targetValue: 5, metric: 'count', isActive: true,
      });
    expect(res.status).toBe(404);
  });
});

// ─ Input validation

describe('input validation', () => {
  it('PUT /api/habits/settings/:id rejects a non-ObjectId key', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .put('/api/habits/settings/not-an-objectid')
      .set(authHeader(token))
      .send({ missingDayMode: 'none', defaultValue: 0 });
    expect(res.status).toBe(400);
  });

  it('POST /api/weight rejects a non-numeric weight', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .post('/api/weight')
      .set(authHeader(token))
      .send({ date: '2024-01-15', weight: 'heavy' });
    expect(res.status).toBe(400);
  });

  it('POST /api/data/import rejects archives with too many entries', async () => {
    const { token } = await createUser();
    const zip = new AdmZip();
    for (let i = 0; i < 65; i++) {
      zip.addFile(`file-${i}.csv`, Buffer.from('a,b\n1,2', 'utf8'));
    }
    const res = await request(app)
      .post('/api/data/import')
      .set(authHeader(token))
      .attach('file', zip.toBuffer(), 'import.zip');
    expect(res.status).toBe(400);
  });
});

// ─ Cascade deletion (data protection)

describe('DELETE /api/admin/users/:id', () => {
  it('removes all personal data together with the account', async () => {
    const admin = await createAdminUser();
    const { user } = await createUser();
    const type = await createOwnActivityType(user._id);
    await Promise.all([
      WeightLog.create({ userId: user._id, date: new Date(), weight: 80, unit: 'kg' }),
      ActivityLog.create({ userId: user._id, activityType: 'Joggen', activityTypeRef: type._id, date: new Date() }),
      HabitDefinition.create({ userId: user._id, name: 'Eigen', unitSymbol: 'x', type: 'amount', version: 1, nameHistory: [] }),
      Goal.create({
        userId: user._id, name: 'G', type: 'periodic-activity',
        targetRef: type._id, targetRefModel: 'ActivityType',
        condition: 'min', targetValue: 1, metric: 'count', isActive: true,
      }),
    ]);

    const res = await request(app)
      .delete(`/api/admin/users/${user._id}`)
      .set(authHeader(admin.token));
    expect(res.status).toBe(200);

    expect(await User.findById(user._id)).toBeNull();
    expect(await WeightLog.countDocuments({ userId: user._id })).toBe(0);
    expect(await ActivityLog.countDocuments({ userId: user._id })).toBe(0);
    expect(await ActivityType.countDocuments({ userId: user._id })).toBe(0);
    expect(await HabitDefinition.countDocuments({ userId: user._id })).toBe(0);
    expect(await Goal.countDocuments({ userId: user._id })).toBe(0);
  });
});

// ─ Security headers

describe('security headers', () => {
  it('are set on every response', async () => {
    const res = await request(app).get('/api/');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

// ─ Rate limiting on public setup endpoints

describe('setup rate limiting', () => {
  it('throttles POST /api/admin/setup after repeated attempts', async () => {
    let lastStatus = null;
    for (let i = 0; i < 31; i++) {
      const res = await request(app).post('/api/admin/setup').send({});
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe('PUT /api/auth/me – check-in times', () => {
  it('stores deduplicated sorted HH:MM times and rejects garbage', async () => {
    const { token } = await createUser();

    const ok = await request(app).put('/api/auth/me').set(authHeader(token)).send({
      checkinTimes: ['20:00', '08:30', '20:00'],
    });
    expect(ok.status).toBe(200);
    expect(ok.body.checkinTimes).toEqual(['08:30', '20:00']);

    // Clearing works with an empty array
    const cleared = await request(app).put('/api/auth/me').set(authHeader(token)).send({
      checkinTimes: [],
    });
    expect(cleared.body.checkinTimes).toEqual([]);

    for (const bad of [['25:00'], ['8:30'], ['abc'], 'nope', [1, 2]]) {
      const res = await request(app).put('/api/auth/me').set(authHeader(token)).send({
        checkinTimes: bad,
      });
      expect(res.status).toBe(400);
    }
  });
});
