const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const request = require('supertest');

function freshTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'deltis-logs-'));
}

function loadLogger(dir) {
  process.env.LOG_DIR = dir;
  jest.resetModules();
  return require('../utils/logger');
}

afterEach(() => {
  delete process.env.LOG_DIR;
  jest.resetModules();
});

function readEntries(logger) {
  const raw = fs.readFileSync(logger.fileFor(), 'utf8').trim();
  return raw.split('\n').map(line => JSON.parse(line));
}

describe('logger', () => {
  it('writes NDJSON entries with level, category and metadata', () => {
    const dir = freshTmpDir();
    const logger = loadLogger(dir);

    logger.info('http', 'GET /api/planner 200', { durationMs: 12.3 });
    logger.warn('boot', 'something odd');

    const entries = readEntries(logger);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      level: 'info', cat: 'http', msg: 'GET /api/planner 200',
      meta: { durationMs: 12.3 },
    });
    expect(new Date(entries[0].ts).toString()).not.toBe('Invalid Date');
    expect(entries[1]).toMatchObject({ level: 'warn', cat: 'boot' });
  });

  it('redacts sensitive keys recursively', () => {
    const dir = freshTmpDir();
    const logger = loadLogger(dir);

    logger.info('http', 'POST /api/auth/login 200', {
      body: {
        username: 'jan',
        password: 'super-geheim',
        nested: { adminToken: 'abc', uuid: '123-456', deep: { passwordHash: 'x' } },
      },
    });

    const [entry] = readEntries(logger);
    expect(entry.meta.body.username).toBe('jan');
    expect(entry.meta.body.password).toBe('[redacted]');
    expect(entry.meta.body.nested.adminToken).toBe('[redacted]');
    expect(entry.meta.body.nested.uuid).toBe('[redacted]');
    expect(entry.meta.body.nested.deep.passwordHash).toBe('[redacted]');
    expect(JSON.stringify(entry)).not.toContain('super-geheim');
  });

  it('prunes files older than the retention window on rollover', () => {
    const dir = freshTmpDir();
    const logger = loadLogger(dir);

    const dayMs = 24 * 60 * 60 * 1000;
    const old = new Date(Date.now() - (logger.RETENTION_DAYS + 2) * dayMs);
    const recent = new Date(Date.now() - (logger.RETENTION_DAYS - 1) * dayMs);
    const oldFile = logger.fileFor(old);
    const recentFile = logger.fileFor(recent);
    fs.writeFileSync(oldFile, '{"old":true}\n');
    fs.writeFileSync(recentFile, '{"recent":true}\n');
    // Foreign files are never touched
    const foreign = path.join(dir, 'notes.txt');
    fs.writeFileSync(foreign, 'keep me');

    logger._resetRollover();
    logger.info('boot', 'rollover');

    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(recentFile)).toBe(true);
    expect(fs.existsSync(foreign)).toBe(true);
  });

  it('truncates oversized metadata instead of writing megabyte lines', () => {
    const dir = freshTmpDir();
    const logger = loadLogger(dir);

    logger.info('http', 'big', { blob: 'x'.repeat(20000) });

    const [entry] = readEntries(logger);
    expect(entry.meta.truncated).toBe(true);
    expect(entry.meta.preview.length).toBeLessThanOrEqual(4000);
  });

  it('never throws when the directory cannot be created', () => {
    // A path below /dev/null fails with ENOTDIR immediately — unlike /proc,
    // where recursive mkdir can spin on procfs quirks.
    const logger = loadLogger('/dev/null/deltis-logs');
    expect(() => logger.info('boot', 'test')).not.toThrow();
  });
});

describe('requestLogger middleware', () => {
  it('logs one detailed entry per finished request with a sanitized body', async () => {
    const dir = freshTmpDir();
    const logger = loadLogger(dir);
    const requestLogger = require('../middleware/requestLogger');

    const app = express();
    app.use(express.json());
    app.use(requestLogger);
    app.post('/api/test', (req, res) => res.status(201).json({ ok: true }));
    app.get('/api/list', (req, res) => res.json([]));

    await request(app).post('/api/test').send({ name: 'Lauf', password: 'geheim' });
    await request(app).get('/api/list?limit=5');
    // res.on('finish') fires after the response — give the event loop a tick
    await new Promise(r => setTimeout(r, 20));

    const entries = readEntries(logger).filter(e => e.cat === 'http');
    expect(entries).toHaveLength(2);

    const post = entries.find(e => e.msg.startsWith('POST'));
    expect(post.msg).toBe('POST /api/test 201');
    expect(post.meta.body.name).toBe('Lauf');
    expect(post.meta.body.password).toBe('[redacted]');
    expect(post.meta.durationMs).toBeGreaterThanOrEqual(0);

    const get = entries.find(e => e.msg.startsWith('GET'));
    expect(get.msg).toBe('GET /api/list 200');
    expect(get.meta.query).toEqual({ limit: '5' });
    expect(get.meta.body).toBeUndefined();
  });
});
