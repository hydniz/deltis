const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createUser, createAdminUser, createUserWithPassword } = require('./helpers/testApp');
const serverState = require('../utils/serverState');

let app;

beforeAll(async () => {
  await startDb();
  app = buildApp();
});

afterEach(async () => {
  await clearDb();
  require('../utils/config')._resetCache();
  serverState.setupMode = false;
});

afterAll(async () => {
  await stopDb();
});

// GET /api/init/status

describe('GET /api/init/status', () => {
  it('reports initNeeded=true on a fresh installation', async () => {
    const res = await request(app).get('/api/init/status');
    expect(res.status).toBe(200);
    expect(res.body.initNeeded).toBe(true);
    expect(res.body.setupMode).toBe(false);
    expect(typeof res.body.pepperConfigured).toBe('boolean');
    expect(typeof res.body.jwtConfigured).toBe('boolean');
    expect(Array.isArray(res.body.settings)).toBe(true);
  });

  it('lists configurable settings but never bootstrap keys', async () => {
    const res = await request(app).get('/api/init/status');
    const keys = res.body.settings.map(s => s.key);
    expect(keys).toContain('UPDATE_REPO_URL');
    expect(keys).toContain('UPDATE_RELEASE_CHANNEL');
    // Bootstrap keys have dedicated wizard steps and stay out of the list.
    expect(keys).not.toContain('MONGODB_URI');
    expect(keys).not.toContain('JWT_SECRET');
    expect(keys).not.toContain('PEPPER_FILE');
    expect(keys).not.toContain('PASSWORD_PEPPER');
  });

  it('marks env-configured settings as locked and hides their value', async () => {
    process.env.UPDATE_DOCKER_IMAGE = 'env-image';
    const res = await request(app).get('/api/init/status');
    const entry = res.body.settings.find(s => s.key === 'UPDATE_DOCKER_IMAGE');
    expect(entry.locked).toBe(true);
    expect(entry.lockedReason).toBe('env');
    expect(entry.value).toBeNull();
    delete process.env.UPDATE_DOCKER_IMAGE;
  });

  it('marks non-env settings as unlocked with their default value', async () => {
    const envBackup = process.env.UPDATE_DOCKER_IMAGE;
    delete process.env.UPDATE_DOCKER_IMAGE;

    const res = await request(app).get('/api/init/status');
    const entry = res.body.settings.find(s => s.key === 'UPDATE_DOCKER_IMAGE');
    expect(entry.locked).toBe(false);
    expect(entry.lockedReason).toBeUndefined();
    expect(entry.value).toBe('hydniz/deltis');

    if (envBackup !== undefined) process.env.UPDATE_DOCKER_IMAGE = envBackup;
  });

  it('reports initNeeded=true while an admin without credentials exists', async () => {
    await createUser({ isAdmin: true }); // UUID-migration admin, no password yet
    const res = await request(app).get('/api/init/status');
    expect(res.body.initNeeded).toBe(true);
  });

  it('reports initNeeded=false once a credentialed admin exists – without settings', async () => {
    await createAdminUser();
    const res = await request(app).get('/api/init/status');
    expect(res.status).toBe(200);
    expect(res.body.initNeeded).toBe(false);
    expect(res.body.settings).toBeUndefined();
  });

  it('reports initNeeded=true in setup mode without touching the DB', async () => {
    serverState.setupMode = true;
    const res = await request(app).get('/api/init/status');
    expect(res.body.initNeeded).toBe(true);
    expect(res.body.setupMode).toBe(true);
    expect(Array.isArray(res.body.settings)).toBe(true);
  });
});

// POST /api/init

describe('POST /api/init', () => {
  const validBody = { username: 'chef', password: 'supersecret1', name: 'Chef' };

  it('returns 503 while the server is in setup mode', async () => {
    serverState.setupMode = true;
    const res = await request(app).post('/api/init').send(validBody);
    expect(res.status).toBe(503);
    expect(res.body.setupMode).toBe(true);
  });

  it('creates the admin account and logs it in via cookie', async () => {
    const res = await request(app).post('/api/init').send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.username).toBe('chef');
    expect(res.body.user.name).toBe('Chef');
    expect(res.body.user.isAdmin).toBe(true);
    expect(res.body.user.passwordHash).toBeUndefined();
    const cookies = res.headers['set-cookie'] || [];
    expect(cookies.some(c => c.startsWith('auth_token='))).toBe(true);
  });

  it('created credentials work for a regular login', async () => {
    await request(app).post('/api/init').send(validBody);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'chef', password: 'supersecret1' });
    expect(res.status).toBe(200);
    expect(res.body.isAdmin).toBe(true);
  });

  it('upgrades an existing credential-less admin instead of creating a second one', async () => {
    const { user } = await createUser({ isAdmin: true });
    const res = await request(app).post('/api/init').send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.user._id).toBe(String(user._id));

    const User = require('../models/User');
    expect(await User.countDocuments({ isAdmin: true })).toBe(1);
  });

  it('returns 403 once initialisation is completed', async () => {
    await createAdminUser();
    const res = await request(app).post('/api/init').send(validBody);
    expect(res.status).toBe(403);
  });

  it('validates the username', async () => {
    for (const username of ['ab', 'x'.repeat(31), 'bad name!']) {
      const res = await request(app).post('/api/init').send({ ...validBody, username });
      expect(res.status).toBe(400);
    }
  });

  it('validates the password length', async () => {
    for (const password of [undefined, 'short', 'x'.repeat(129)]) {
      const res = await request(app).post('/api/init').send({ ...validBody, password });
      expect(res.status).toBe(400);
    }
  });

  it('returns 409 when the username is already taken', async () => {
    await createUserWithPassword({ username: 'taken' });
    const res = await request(app).post('/api/init').send({ ...validBody, username: 'taken' });
    expect(res.status).toBe(409);
  });

  it('applies submitted settings as DB overrides', async () => {
    const res = await request(app).post('/api/init').send({
      ...validBody,
      settings: { UPDATE_DOCKER_IMAGE: 'develop', UPDATE_RELEASE_CHANNEL: 'beta' },
    });
    expect(res.status).toBe(201);
    expect(res.body.applied.sort()).toEqual(['UPDATE_DOCKER_IMAGE', 'UPDATE_RELEASE_CHANNEL']);
    expect(res.body.restartRequired).toBe(false);

    const cfg = require('../utils/config');
    expect(cfg.get('UPDATE_DOCKER_IMAGE')).toBe('develop');
    expect(cfg.get('UPDATE_RELEASE_CHANNEL')).toBe('beta');
    expect(cfg.getSource('UPDATE_DOCKER_IMAGE')).toBe('db');
  });

  it('skips env-locked settings instead of overwriting them', async () => {
    process.env.UPDATE_DOCKER_IMAGE = 'env-image';
    const res = await request(app).post('/api/init').send({
      ...validBody,
      settings: { UPDATE_DOCKER_IMAGE: 'develop' },
    });
    expect(res.status).toBe(201);
    expect(res.body.applied).toEqual([]);
    expect(res.body.skipped).toEqual(['UPDATE_DOCKER_IMAGE']);

    const cfg = require('../utils/config');
    expect(cfg.getSource('UPDATE_DOCKER_IMAGE')).toBe('env');
    delete process.env.UPDATE_DOCKER_IMAGE;
  });

  it('ignores empty setting values (keep default)', async () => {
    const res = await request(app).post('/api/init').send({
      ...validBody,
      settings: { UPDATE_DOCKER_IMAGE: '   ' },
    });
    expect(res.status).toBe(201);
    expect(res.body.applied).toEqual([]);
  });

  it('rejects unknown setting keys', async () => {
    const res = await request(app).post('/api/init').send({
      ...validBody,
      settings: { NOT_A_KEY: 'x' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects bootstrap keys smuggled into settings', async () => {
    const res = await request(app).post('/api/init').send({
      ...validBody,
      settings: { JWT_SECRET: 'evil' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid select options and non-numeric numbers', async () => {
    let res = await request(app).post('/api/init').send({
      ...validBody,
      settings: { UPDATE_RELEASE_CHANNEL: 'nightly' },
    });
    expect(res.status).toBe(400);

    res = await request(app).post('/api/init').send({
      ...validBody,
      settings: { PORT: 'abc' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects settings that are not an object', async () => {
    const res = await request(app).post('/api/init').send({
      ...validBody,
      settings: ['UPDATE_DOCKER_IMAGE'],
    });
    expect(res.status).toBe(400);
  });

  it('flags restartRequired when such a setting was applied', async () => {
    const res = await request(app).post('/api/init').send({
      ...validBody,
      settings: { PORT: '4001' },
    });
    expect(res.status).toBe(201);
    expect(res.body.restartRequired).toBe(true);
  });

  it('does not create the account when a setting is invalid', async () => {
    await request(app).post('/api/init').send({
      ...validBody,
      settings: { UPDATE_RELEASE_CHANNEL: 'nightly' },
    });
    const User = require('../models/User');
    expect(await User.countDocuments()).toBe(0);
  });
});
