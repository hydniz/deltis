const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createAdminUser, createUser, authHeader } = require('./helpers/testApp');

let app;

beforeAll(async () => {
  await startDb();
  app = buildApp();
});

afterEach(async () => {
  await clearDb();
  require('../routes/update')._resetState();
  require('../utils/config')._resetCache();
  delete process.env.UPDATE_REPO_URL;
  delete process.env.WATCHTOWER_API_TOKEN;
});

afterAll(async () => {
  await stopDb();
});

// ── GET /api/admin/update/status ──────────────────────────────────────────

describe('GET /api/admin/update/status', () => {
  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app).get('/api/admin/update/status');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a regular user', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .get('/api/admin/update/status')
      .set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('returns configured=false when UPDATE_REPO_URL is not set', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/update/status')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.updateInProgress).toBe(false);
  });

  it('includes currentVersion from package.json', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/update/status')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(typeof res.body.currentVersion).toBe('string');
    expect(res.body.currentVersion.length).toBeGreaterThan(0);
  });

  it('returns configured=true with checkError when GitHub is unreachable', async () => {
    process.env.UPDATE_REPO_URL = 'https://github.com/nonexistent-org/nonexistent-repo-xyz.git';
    const { token } = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/update/status')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.checkError).toBeDefined();
    expect(res.body.latestCommit).toBeNull();
    expect(res.body.updateAvailable).toBeNull();
  });

  it('truncates GIT_COMMIT env to 7 characters for comparison', async () => {
    process.env.UPDATE_REPO_URL = 'https://github.com/nonexistent-org/nonexistent-repo-xyz.git';
    process.env.GIT_COMMIT = 'abcdef1234567890abcdef1234567890abcdef12';
    const { token } = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/update/status')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.currentCommit).toBe('abcdef1');
    delete process.env.GIT_COMMIT;
  });
});

// ── POST /api/admin/update/start ──────────────────────────────────────────

describe('POST /api/admin/update/start', () => {
  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app).post('/api/admin/update/start');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a regular user', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .post('/api/admin/update/start')
      .set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('returns 400 when UPDATE_REPO_URL is not configured', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/update/start')
      .set(authHeader(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/UPDATE_REPO_URL/);
  });

  it('returns 200 and starts the async update when configured', async () => {
    process.env.UPDATE_REPO_URL = 'https://github.com/hydniz/deltis';
    const { token } = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/update/start')
      .set(authHeader(token));
    // Responds immediately – Watchtower is triggered asynchronously
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 409 when an update is already in progress', async () => {
    process.env.UPDATE_REPO_URL = 'https://github.com/hydniz/deltis';
    const { token } = await createAdminUser();
    require('../routes/update')._setInProgress(true);
    const res = await request(app)
      .post('/api/admin/update/start')
      .set(authHeader(token));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/läuft bereits/);
  });
});

// ── GET /api/admin/update/stream ──────────────────────────────────────────

describe('GET /api/admin/update/stream', () => {
  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app).get('/api/admin/update/stream');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a regular user', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .get('/api/admin/update/stream')
      .set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('returns text/event-stream content-type for admin', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/update/stream')
      .set(authHeader(token))
      .timeout({ response: 500, deadline: 1000 })
      .catch(err => err.response || err);
    if (res && res.headers) {
      expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    }
  });
});
