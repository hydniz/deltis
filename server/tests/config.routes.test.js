const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createAdminUser, createUser, authHeader } = require('./helpers/testApp');

let app;

// REGISTRATION_ENABLED stands in for "an editable, non-secret key" in the
// generic route tests: it is editable, has a default ('off') and its value may
// be displayed. UPDATE_BRANCH used to play this role before the main channel
// was fixed to the main branch.
const EDITABLE_KEY = '/api/admin/config/REGISTRATION_ENABLED';

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
    expect(keys).toContain('JWT_SECRET');
    expect(keys).toContain('PEPPER_FILE');
    expect(keys).toContain('REGISTRATION_ENABLED');
  });

  it('does not offer a configurable update branch – main is fixed', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/config')
      .set(authHeader(token));
    expect(res.body.map(e => e.key)).not.toContain('UPDATE_BRANCH');
  });

  it('groups registration settings apart from the security secrets', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/config')
      .set(authHeader(token));
    const groupOf = key => res.body.find(e => e.key === key).group;

    expect(groupOf('REGISTRATION_ENABLED')).toBe('Registrierung & Zugang');
    expect(groupOf('REGISTRATION_USER_LIMIT')).toBe('Registrierung & Zugang');
    expect(groupOf('JWT_SECRET')).toBe('Sicherheit');
    expect(groupOf('PEPPER_FILE')).toBe('Sicherheit');
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
    const envBackup = process.env.REGISTRATION_ENABLED;
    delete process.env.REGISTRATION_ENABLED;

    const { token } = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/config')
      .set(authHeader(token));
    const entry = res.body.find(e => e.key === 'REGISTRATION_ENABLED');
    expect(entry.source).toBe('default');
    expect(entry.value).toBe('off');

    if (envBackup !== undefined) process.env.REGISTRATION_ENABLED = envBackup;
  });

  it('returns source=env when process.env has a value', async () => {
    process.env.REGISTRATION_ENABLED = 'on';
    const { token } = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/config')
      .set(authHeader(token));
    const entry = res.body.find(e => e.key === 'REGISTRATION_ENABLED');
    expect(entry.source).toBe('env');
    expect(entry.hasValue).toBe(true);
    delete process.env.REGISTRATION_ENABLED;
  });

  it('returns source=db when a DB override is stored', async () => {
    const { token } = await createAdminUser();
    await request(app)
      .put(EDITABLE_KEY)
      .set(authHeader(token))
      .send({ value: 'on' });

    const res = await request(app)
      .get('/api/admin/config')
      .set(authHeader(token));
    const entry = res.body.find(e => e.key === 'REGISTRATION_ENABLED');
    expect(entry.source).toBe('db');
    expect(entry.value).toBe('on');
  });

  // What may be shown is decided per key by its `expose` policy, not by where
  // the value came from. A port from .env is as harmless to display as a
  // default one – that it used to be blanked out was the bug.
  describe('value exposure', () => {
    it('shows a non-secret value even when it comes from env', async () => {
      const envBackup = process.env.PORT;
      process.env.PORT = '4123';

      const { token } = await createAdminUser();
      const res = await request(app)
        .get('/api/admin/config')
        .set(authHeader(token));
      const entry = res.body.find(e => e.key === 'PORT');
      expect(entry.source).toBe('env');
      expect(entry.value).toBe('4123');
      expect(entry.hasValue).toBe(true);
      expect(entry.masked).toBeUndefined();

      if (envBackup === undefined) delete process.env.PORT;
      else process.env.PORT = envBackup;
    });

    it('masks credentials in the MongoDB URI but keeps host and database', async () => {
      const envBackup = process.env.MONGODB_URI;
      process.env.MONGODB_URI = 'mongodb://admin:s3cret@db.local:27017/deltis';

      const { token } = await createAdminUser();
      const res = await request(app)
        .get('/api/admin/config')
        .set(authHeader(token));
      const entry = res.body.find(e => e.key === 'MONGODB_URI');
      expect(entry.value).toBe('mongodb://***:***@db.local:27017/deltis');
      expect(entry.value).not.toContain('s3cret');
      expect(entry.value).not.toContain('admin');
      expect(entry.masked).toBe(true);
      expect(entry.hasValue).toBe(true);

      if (envBackup === undefined) delete process.env.MONGODB_URI;
      else process.env.MONGODB_URI = envBackup;
    });

    it('returns a credential-free MongoDB URI unmasked', async () => {
      const envBackup = process.env.MONGODB_URI;
      process.env.MONGODB_URI = 'mongodb://localhost:27017/deltis';

      const { token } = await createAdminUser();
      const res = await request(app)
        .get('/api/admin/config')
        .set(authHeader(token));
      const entry = res.body.find(e => e.key === 'MONGODB_URI');
      expect(entry.value).toBe('mongodb://localhost:27017/deltis');
      // Nothing was hidden, so the row must not claim otherwise.
      expect(entry.masked).toBeUndefined();

      if (envBackup === undefined) delete process.env.MONGODB_URI;
      else process.env.MONGODB_URI = envBackup;
    });

    it('never exposes secret values, only their presence', async () => {
      // The admin is created before the peppers change: hashing reads them.
      const { token } = await createAdminUser();
      process.env.JWT_SECRET = 'supersecret';
      process.env.PASSWORD_PEPPER = 'pepper-value';
      try {
        const res = await request(app)
          .get('/api/admin/config')
          .set(authHeader(token));

        for (const key of ['JWT_SECRET', 'PASSWORD_PEPPER']) {
          const entry = res.body.find(e => e.key === key);
          expect(entry.value).toBeNull();
          expect(entry.hasValue).toBe(true);
        }
        expect(JSON.stringify(res.body)).not.toContain('supersecret');
        expect(JSON.stringify(res.body)).not.toContain('pepper-value');
      } finally {
        delete process.env.JWT_SECRET;
        delete process.env.PASSWORD_PEPPER;
      }
    });

    it('shows secret-file paths – a path is not a secret', async () => {
      // PEPPER_FILE must only be set once no more password hashing happens:
      // utils/password.js aborts the process when the file cannot be read.
      const { token } = await createAdminUser();
      process.env.PEPPER_FILE = '/etc/deltis/pepper';
      try {
        const res = await request(app)
          .get('/api/admin/config')
          .set(authHeader(token));
        const entry = res.body.find(e => e.key === 'PEPPER_FILE');
        expect(entry.value).toBe('/etc/deltis/pepper');
      } finally {
        delete process.env.PEPPER_FILE;
      }
    });
  });
});

// PUT /api/admin/config/:key

describe('PUT /api/admin/config/:key', () => {
  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app)
      .put(EDITABLE_KEY)
      .send({ value: 'on' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a regular user', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .put(EDITABLE_KEY)
      .set(authHeader(token))
      .send({ value: 'on' });
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

  it('returns 400 for the removed update branch key', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .put('/api/admin/config/UPDATE_BRANCH')
      .set(authHeader(token))
      .send({ value: 'develop' });
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
      .put(EDITABLE_KEY)
      .set(authHeader(token))
      .send({ value: '   ' });
    expect(res.status).toBe(400);
  });

  it('saves the value and returns ok with source=db', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .put(EDITABLE_KEY)
      .set(authHeader(token))
      .send({ value: 'on' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('db');
  });

  it('saved value appears in subsequent GET', async () => {
    const { token } = await createAdminUser();
    await request(app)
      .put('/api/admin/config/REGISTRATION_USER_LIMIT')
      .set(authHeader(token))
      .send({ value: '5' });

    const res = await request(app)
      .get('/api/admin/config')
      .set(authHeader(token));
    const entry = res.body.find(e => e.key === 'REGISTRATION_USER_LIMIT');
    expect(entry.value).toBe('5');
    expect(entry.source).toBe('db');
  });

  it('env value takes precedence over DB value in config.get()', async () => {
    const cfg = require('../utils/config');
    process.env.REGISTRATION_ENABLED = 'on';
    const { token } = await createAdminUser();
    await request(app)
      .put(EDITABLE_KEY)
      .set(authHeader(token))
      .send({ value: 'off' });

    // config.get() must return the env value
    expect(cfg.get('REGISTRATION_ENABLED')).toBe('on');
    delete process.env.REGISTRATION_ENABLED;
  });
});

// DELETE /api/admin/config/:key

describe('DELETE /api/admin/config/:key', () => {
  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app).delete(EDITABLE_KEY);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a regular user', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .delete(EDITABLE_KEY)
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
    const envBackup = process.env.REGISTRATION_ENABLED;
    delete process.env.REGISTRATION_ENABLED;

    const { token } = await createAdminUser();
    await request(app)
      .put(EDITABLE_KEY)
      .set(authHeader(token))
      .send({ value: 'on' });

    const del = await request(app)
      .delete(EDITABLE_KEY)
      .set(authHeader(token));
    expect(del.status).toBe(200);
    expect(del.body.source).toBe('default');

    const res = await request(app)
      .get('/api/admin/config')
      .set(authHeader(token));
    const entry = res.body.find(e => e.key === 'REGISTRATION_ENABLED');
    expect(entry.source).toBe('default');

    if (envBackup !== undefined) process.env.REGISTRATION_ENABLED = envBackup;
  });
});
