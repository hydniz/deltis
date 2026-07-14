const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createAdminUser, createUser, authHeader } = require('./helpers/testApp');

let app;

beforeAll(async () => {
  await startDb();
  app = buildApp();
});

afterEach(async () => {
  await clearDb();
  require('../utils/config')._resetCache();
});

afterAll(async () => {
  await stopDb();
});

// GET /api/admin/config

describe('GET /api/admin/config', () => {
  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app).get('/api/admin/config');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a regular user', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .get('/api/admin/config')
      .set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('returns an array of config entries for admin', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/config')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('includes all expected keys', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/config')
      .set(authHeader(token));
    const keys = res.body.map(e => e.key);
    expect(keys).toContain('UPDATE_REPO_URL');
    expect(keys).toContain('UPDATE_BRANCH');
    expect(keys).toContain('JWT_SECRET');
    expect(keys).toContain('PEPPER_FILE');
  });

  it('ships the Deltis repository as default update source', async () => {
    const envBackup = process.env.UPDATE_REPO_URL;
    delete process.env.UPDATE_REPO_URL;

    const { token } = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/config')
      .set(authHeader(token));
    const entry = res.body.find(e => e.key === 'UPDATE_REPO_URL');
    expect(entry.default).toBe('https://github.com/hydniz/deltis');
    expect(entry.value).toBe('https://github.com/hydniz/deltis');
    expect(entry.source).toBe('default');

    if (envBackup !== undefined) process.env.UPDATE_REPO_URL = envBackup;
  });

  it('marks docker-only settings with context=docker', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/config')
      .set(authHeader(token));
    const dockerImage = res.body.find(e => e.key === 'UPDATE_DOCKER_IMAGE');
    expect(dockerImage.context).toBe('docker');
    // Entries without an environment restriction carry no context field.
    const repoUrl = res.body.find(e => e.key === 'UPDATE_REPO_URL');
    expect(repoUrl.context).toBeUndefined();
  });

  it('returns source=default for entries with no env or DB value', async () => {
    const envBackup = process.env.UPDATE_BRANCH;
    delete process.env.UPDATE_BRANCH;

    const { token } = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/config')
      .set(authHeader(token));
    const entry = res.body.find(e => e.key === 'UPDATE_BRANCH');
    expect(entry.source).toBe('default');
    expect(entry.value).toBe('main');

    if (envBackup !== undefined) process.env.UPDATE_BRANCH = envBackup;
  });

  it('returns source=env when process.env has a value', async () => {
    process.env.UPDATE_BRANCH = 'develop';
    const { token } = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/config')
      .set(authHeader(token));
    const entry = res.body.find(e => e.key === 'UPDATE_BRANCH');
    expect(entry.source).toBe('env');
    expect(entry.value).toBeNull(); // env values are never exposed
    delete process.env.UPDATE_BRANCH;
  });

  it('returns source=db when a DB override is stored', async () => {
    const { token } = await createAdminUser();
    await request(app)
      .put('/api/admin/config/UPDATE_BRANCH')
      .set(authHeader(token))
      .send({ value: 'staging' });

    const res = await request(app)
      .get('/api/admin/config')
      .set(authHeader(token));
    const entry = res.body.find(e => e.key === 'UPDATE_BRANCH');
    expect(entry.source).toBe('db');
    expect(entry.value).toBe('staging');
  });

  it('never exposes values for status-type entries', async () => {
    process.env.JWT_SECRET = 'supersecret';
    const { token } = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/config')
      .set(authHeader(token));
    const entry = res.body.find(e => e.key === 'JWT_SECRET');
    expect(entry.value).toBeNull();
    expect(entry.hasValue).toBe(true);
    delete process.env.JWT_SECRET;
  });
});

// PUT /api/admin/config/:key

describe('PUT /api/admin/config/:key', () => {
  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app)
      .put('/api/admin/config/UPDATE_BRANCH')
      .send({ value: 'develop' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a regular user', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .put('/api/admin/config/UPDATE_BRANCH')
      .set(authHeader(token))
      .send({ value: 'develop' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for an unknown key', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .put('/api/admin/config/UNKNOWN_KEY')
      .set(authHeader(token))
      .send({ value: 'foo' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for a non-editable key', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .put('/api/admin/config/JWT_SECRET')
      .set(authHeader(token))
      .send({ value: 'newsecret' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/UI/);
  });

  it('returns 400 when value is empty', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .put('/api/admin/config/UPDATE_BRANCH')
      .set(authHeader(token))
      .send({ value: '   ' });
    expect(res.status).toBe(400);
  });

  it('saves the value and returns ok with source=db', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .put('/api/admin/config/UPDATE_BRANCH')
      .set(authHeader(token))
      .send({ value: 'develop' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('db');
  });

  it('saved value appears in subsequent GET', async () => {
    const { token } = await createAdminUser();
    await request(app)
      .put('/api/admin/config/UPDATE_BRANCH')
      .set(authHeader(token))
      .send({ value: 'feature-x' });

    const res = await request(app)
      .get('/api/admin/config')
      .set(authHeader(token));
    const entry = res.body.find(e => e.key === 'UPDATE_BRANCH');
    expect(entry.value).toBe('feature-x');
    expect(entry.source).toBe('db');
  });

  it('env value takes precedence over DB value in config.get()', async () => {
    const cfg = require('../utils/config');
    process.env.UPDATE_BRANCH = 'env-branch';
    const { token } = await createAdminUser();
    await request(app)
      .put('/api/admin/config/UPDATE_BRANCH')
      .set(authHeader(token))
      .send({ value: 'db-branch' });

    // config.get() must return the env value
    expect(cfg.get('UPDATE_BRANCH')).toBe('env-branch');
    delete process.env.UPDATE_BRANCH;
  });
});

// DELETE /api/admin/config/:key

describe('DELETE /api/admin/config/:key', () => {
  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app).delete('/api/admin/config/UPDATE_BRANCH');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a regular user', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .delete('/api/admin/config/UPDATE_BRANCH')
      .set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('returns 400 for a non-editable key', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .delete('/api/admin/config/MONGODB_URI')
      .set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('removes DB override and source reverts to default', async () => {
    const envBackup = process.env.UPDATE_BRANCH;
    delete process.env.UPDATE_BRANCH;

    const { token } = await createAdminUser();
    await request(app)
      .put('/api/admin/config/UPDATE_BRANCH')
      .set(authHeader(token))
      .send({ value: 'develop' });

    const del = await request(app)
      .delete('/api/admin/config/UPDATE_BRANCH')
      .set(authHeader(token));
    expect(del.status).toBe(200);
    expect(del.body.source).toBe('default');

    const res = await request(app)
      .get('/api/admin/config')
      .set(authHeader(token));
    const entry = res.body.find(e => e.key === 'UPDATE_BRANCH');
    expect(entry.source).toBe('default');

    if (envBackup !== undefined) process.env.UPDATE_BRANCH = envBackup;
  });
});
