const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp } = require('./helpers/testApp');
const { backupsPresent } = require('../routes/init');

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

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'deltis-backups-'));
}

describe('backupsPresent', () => {
  it('is false for a missing or empty backups directory', () => {
    expect(backupsPresent('/nonexistent/backups')).toBe(false);
    const dir = tmpDir();
    expect(backupsPresent(dir)).toBe(false);
  });

  it('detects mongodump archives in the backups directory', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'predeploy_20260716_120000.archive.gz'), '');
    expect(backupsPresent(dir)).toBe(true);
  });

  it('detects pre-migration and pre-update snapshots', () => {
    const withMigration = tmpDir();
    fs.mkdirSync(path.join(withMigration, 'pre-migration'));
    fs.writeFileSync(path.join(withMigration, 'pre-migration', '001.ejson.gz'), '');
    expect(backupsPresent(withMigration)).toBe(true);

    const withUpdate = tmpDir();
    fs.mkdirSync(path.join(withUpdate, 'pre-update'));
    fs.writeFileSync(path.join(withUpdate, 'pre-update', 'v0.5.6.ejson.gz'), '');
    expect(backupsPresent(withUpdate)).toBe(true);
  });

  it('ignores unrelated files (locks, logs)', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, '.backup.lock'), '');
    fs.writeFileSync(path.join(dir, 'update.log'), '');
    expect(backupsPresent(dir)).toBe(false);
  });
});

describe('GET /api/init/status', () => {
  it('reports the backupsPresent flag while init is needed', async () => {
    const res = await request(app).get('/api/init/status');
    expect(res.status).toBe(200);
    expect(res.body.initNeeded).toBe(true);
    expect(typeof res.body.backupsPresent).toBe('boolean');
  });
});
