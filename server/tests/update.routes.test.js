const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createAdminUser, createUser, authHeader } = require('./helpers/testApp');
const appConfig = require('../utils/config');

let app;
let origRepoDefault;

beforeAll(async () => {
  await startDb();
  app = buildApp();
  // Blank the shipped repo default so the "not configured" paths stay
  // testable without the suite reaching out to GitHub.
  origRepoDefault = appConfig.DEFINITIONS.UPDATE_REPO_URL.default;
  appConfig.DEFINITIONS.UPDATE_REPO_URL.default = '';
});

afterEach(async () => {
  await clearDb();
  require('../routes/update')._resetState();
  require('../utils/config')._resetCache();
  delete process.env.UPDATE_REPO_URL;
});

afterAll(async () => {
  appConfig.DEFINITIONS.UPDATE_REPO_URL.default = origRepoDefault;
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
    // Responds immediately – the update pipeline runs asynchronously
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

// ── Pre-update backup ─────────────────────────────────────────────────────

describe('pre-update backup', () => {
  const fs = require('fs');
  const updateRouter = require('../routes/update');
  const backupDir = updateRouter._PRE_UPDATE_BACKUP_DIR;

  afterEach(() => {
    fs.rmSync(backupDir, { recursive: true, force: true });
  });

  it('writes an EJSON snapshot into backups/pre-update/', async () => {
    await createUser(); // ensure the DB has at least one collection
    const file = await updateRouter._createPreUpdateBackup();
    expect(file.startsWith(backupDir)).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
    expect(file).toMatch(/\.ejson\.gz$/);
  });

  it('keeps at most 5 snapshots', async () => {
    await createUser();
    // Seed 6 older dummy snapshots (lexicographic filename order == age)
    fs.mkdirSync(backupDir, { recursive: true });
    for (let i = 0; i < 6; i++) {
      fs.writeFileSync(`${backupDir}/pre-migration_2020010${i + 1}T000000Z.ejson.gz`, '');
    }
    await updateRouter._createPreUpdateBackup();
    const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.ejson.gz'));
    expect(files.length).toBe(5);
    // The freshly created snapshot must have survived the pruning
    expect(files.some(f => !f.startsWith('pre-migration_2020'))).toBe(true);
  });
});

// ── GET /api/admin/update/check ───────────────────────────────────────────

describe('GET /api/admin/update/check', () => {
  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app).get('/api/admin/update/check');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a regular user', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .get('/api/admin/update/check')
      .set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('returns configured=false when no repo URL is set', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/update/check')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.checkedAt).toBeDefined();
  });
});

// ── POST /api/admin/update/rollback ───────────────────────────────────────

describe('POST /api/admin/update/rollback', () => {
  const updateStateUtil = require('../utils/updateState');

  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app).post('/api/admin/update/rollback');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a regular user', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .post('/api/admin/update/rollback')
      .set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('returns 400 when there is no rollback target', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/update/rollback')
      .set(authHeader(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Kein Rollback-Ziel/);
  });

  it('returns 409 while an update is running', async () => {
    const { token } = await createAdminUser();
    require('../routes/update')._setInProgress(true);
    const res = await request(app)
      .post('/api/admin/update/rollback')
      .set(authHeader(token));
    expect(res.status).toBe(409);
  });

  it('completes a no-swap rollback and records rolled-back', async () => {
    const { token } = await createAdminUser();
    // Simulate a failed update whose old container still exists, but in
    // host/test mode no docker swap is possible → DB-only rollback path.
    updateStateUtil.write({ phase: 'failed', oldContainerName: 'app-old', error: 'x' });

    const res = await request(app)
      .post('/api/admin/update/rollback')
      .set(authHeader(token))
      .send({ restoreDb: false });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // The rollback runs async – poll the persisted state.
    let phase;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 100));
      phase = updateStateUtil.read().phase;
      if (phase === 'rolled-back') break;
    }
    expect(phase).toBe('rolled-back');
  });
});

// ── Status: mode & updateState fields ─────────────────────────────────────

describe('GET /api/admin/update/status – mode & state', () => {
  it('reports host mode outside Docker and an idle update state', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/update/status')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('host');
    expect(res.body.updateState.phase).toBe('idle');
    expect(res.body.updateState.rollbackAvailable).toBe(false);
  });

  it('exposes rollbackAvailable when an old container is recorded', async () => {
    const updateStateUtil = require('../utils/updateState');
    updateStateUtil.write({ phase: 'failed', oldContainerName: 'app-old', error: 'boom', recovered: true });
    const { token } = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/update/status')
      .set(authHeader(token));
    expect(res.body.updateState.phase).toBe('failed');
    expect(res.body.updateState.error).toBe('boom');
    expect(res.body.updateState.rollbackAvailable).toBe(true);
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

// ── Version comparison ────────────────────────────────────────────────────

describe('compareSemver', () => {
  const cmp = require('../routes/update')._compareSemver;

  it('orders plain versions numerically', () => {
    expect(cmp('0.4.0', '0.3.1')).toBe(1);
    expect(cmp('0.3.1', '0.4.0')).toBe(-1);
    expect(cmp('0.4.0', '0.4.0')).toBe(0);
    expect(cmp('0.10.0', '0.9.0')).toBe(1); // numeric, not lexicographic
  });

  it('sorts a prerelease below its plain release', () => {
    expect(cmp('0.4.0-alpha', '0.4.0')).toBe(-1);
    expect(cmp('0.4.0', '0.4.0-alpha')).toBe(1);
  });

  it('orders prerelease identifiers per semver spec', () => {
    expect(cmp('0.4.0-alpha', '0.4.0-beta')).toBe(-1);
    expect(cmp('0.4.0-alpha.2', '0.4.0-alpha.10')).toBe(-1); // numeric compare
    expect(cmp('0.4.0-alpha', '0.4.0-alpha.1')).toBe(-1);    // shorter list first
    expect(cmp('0.4.0-alpha.1', '0.4.0-alpha.beta')).toBe(-1); // numeric < alphanumeric
    expect(cmp('0.4.0-alpha', '0.4.0-alpha')).toBe(0);
  });

  it('returns null for unparseable versions', () => {
    expect(cmp('not-a-version', '0.4.0')).toBeNull();
    expect(cmp('0.4.0', '')).toBeNull();
  });
});

describe('computeUpdateAvailable', () => {
  const compute = require('../routes/update')._computeUpdateAvailable;

  it('returns null without release info', () => {
    expect(compute(null, 'stable')).toBeNull();
    expect(compute({ version: null }, 'stable')).toBeNull();
  });

  it('reports an OLDER channel release as no update (regression: 0.3.1-alpha vs 0.4.0)', () => {
    expect(compute({ version: '0.0.1-alpha' }, 'alpha')).toBe(false);
  });

  it('reports the installed version itself as no update', () => {
    const pkg = require('../../package.json');
    const installed = pkg.stage ? `${pkg.version}-${pkg.stage}` : pkg.version;
    expect(compute({ version: installed }, 'stable')).toBe(false);
  });

  it('reports a newer release as update', () => {
    expect(compute({ version: '999.0.0' }, 'stable')).toBe(true);
  });

  it('compares commit SHAs on the main channel', () => {
    process.env.GIT_COMMIT = 'abcdef1234567890';
    expect(compute({ commitSha: 'abcdef1' }, 'main')).toBe(false);
    expect(compute({ commitSha: '1234567' }, 'main')).toBe(true);
    delete process.env.GIT_COMMIT;
    expect(compute({ commitSha: '1234567' }, 'main')).toBeNull();
  });
});
