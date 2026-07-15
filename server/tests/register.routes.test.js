const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createUser } = require('./helpers/testApp');
const User = require('../models/User');
const config = require('../utils/config');

let app;

beforeAll(async () => {
  await startDb();
  app = buildApp();
});

afterEach(async () => {
  await clearDb();
  config._resetCache();
  require('../routes/auth').resetRateLimits();
});

afterAll(async () => {
  await stopDb();
});

const VALID_BODY = { username: 'neuer.nutzer', password: 'sicheres-passwort', name: 'Neuer Nutzer' };

async function enableRegistration(limit) {
  await config.set('REGISTRATION_ENABLED', 'on');
  if (limit !== undefined) await config.set('REGISTRATION_USER_LIMIT', String(limit));
}

describe('GET /api/auth/registration-status', () => {
  it('reports disabled by default', async () => {
    const res = await request(app).get('/api/auth/registration-status');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  it('reports enabled once the admin turns it on', async () => {
    await enableRegistration();
    const res = await request(app).get('/api/auth/registration-status');
    expect(res.body.enabled).toBe(true);
  });
});

describe('POST /api/auth/register', () => {
  it('rejects registration while disabled (default)', async () => {
    const res = await request(app).post('/api/auth/register').send(VALID_BODY);
    expect(res.status).toBe(403);
    expect(await User.countDocuments()).toBe(0);
  });

  it('creates an account, sets the session cookie and flags onboarding', async () => {
    await enableRegistration();
    const res = await request(app).post('/api/auth/register').send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.username).toBe('neuer.nutzer');
    expect(res.body.isAdmin).toBe(false);
    expect(res.body.onboardingPending).toBe(true);
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.headers['set-cookie']?.join(';')).toContain('auth_token=');
  });

  it('never grants admin rights, even when requested', async () => {
    await enableRegistration();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...VALID_BODY, isAdmin: true, makeAdmin: true });
    expect(res.status).toBe(201);
    const user = await User.findOne({ username: 'neuer.nutzer' });
    expect(user.isAdmin).toBe(false);
  });

  it('validates username format and password length', async () => {
    await enableRegistration();

    let res = await request(app).post('/api/auth/register')
      .send({ ...VALID_BODY, username: 'ab' });
    expect(res.status).toBe(400);

    res = await request(app).post('/api/auth/register')
      .send({ ...VALID_BODY, username: 'böse zeichen!' });
    expect(res.status).toBe(400);

    res = await request(app).post('/api/auth/register')
      .send({ ...VALID_BODY, password: 'kurz' });
    expect(res.status).toBe(400);

    res = await request(app).post('/api/auth/register')
      .send({ ...VALID_BODY, password: 'x'.repeat(200) });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate usernames', async () => {
    await enableRegistration();
    await request(app).post('/api/auth/register').send(VALID_BODY);
    const res = await request(app).post('/api/auth/register').send(VALID_BODY);
    expect(res.status).toBe(409);
  });

  it('enforces the configured user limit', async () => {
    await enableRegistration(1);
    await createUser(); // instance already has one account

    const res = await request(app).post('/api/auth/register').send(VALID_BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Nutzerlimit/);
  });

  it('rate-limits repeated registration attempts per IP', async () => {
    await enableRegistration();

    // Limit is 5 per hour — invalid attempts count as well.
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/register').send({ username: 'ab', password: 'x' });
    }
    const res = await request(app).post('/api/auth/register').send(VALID_BODY);
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});
