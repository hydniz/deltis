const express = require('express');
const request = require('supertest');
const serverState = require('../utils/serverState');
const emergencyGuard = require('../middleware/emergencyGuard');
const { listenOnAvailablePort } = require('../utils/portFinder');

function buildGuardedApp() {
  const app = express();
  app.use(emergencyGuard);
  app.get('/api', (req, res) => res.json({ ok: 'version' }));
  app.get('/api/branding', (req, res) => res.json({ ok: 'branding' }));
  app.post('/api/auth/login', (req, res) => res.json({ ok: 'login' }));
  app.get('/api/admin/update/status', (req, res) => res.json({ ok: 'status' }));
  app.get('/api/habits', (req, res) => res.json({ ok: 'habits' }));
  app.get('/index.html', (req, res) => res.send('frontend'));
  return app;
}

describe('emergencyGuard', () => {
  afterEach(() => { serverState.emergencyMode = null; });

  it('lets everything through when not in emergency mode', async () => {
    const app = buildGuardedApp();
    expect((await request(app).get('/api/habits')).status).toBe(200);
  });

  it('blocks normal API routes in emergency mode with 503', async () => {
    serverState.emergencyMode = { code: 'MIGRATION_FAILED', message: 'x' };
    const app = buildGuardedApp();
    const res = await request(app).get('/api/habits');
    expect(res.status).toBe(503);
    expect(res.body.emergencyMode).toBe(true);
    expect(res.body.error).toMatch(/Notfallbetrieb/);
  });

  it('keeps version, branding, auth and update endpoints reachable', async () => {
    serverState.emergencyMode = { code: 'MIGRATION_FAILED', message: 'x' };
    const app = buildGuardedApp();
    expect((await request(app).get('/api')).status).toBe(200);
    expect((await request(app).get('/api/branding')).status).toBe(200);
    expect((await request(app).post('/api/auth/login')).status).toBe(200);
    expect((await request(app).get('/api/admin/update/status')).status).toBe(200);
  });

  it('still serves the frontend in emergency mode', async () => {
    serverState.emergencyMode = { code: 'MIGRATION_FAILED', message: 'x' };
    const app = buildGuardedApp();
    expect((await request(app).get('/index.html')).status).toBe(200);
  });
});

describe('portFinder', () => {
  it('binds the desired port when it is free', async () => {
    const app = express();
    const desired = 4300 + Math.floor(Math.random() * 200);
    const { server, port } = await listenOnAvailablePort(app, desired);
    expect(port).toBe(desired);
    expect(server.address().port).toBe(desired);
    server.close();
  });

  it('falls forward to the next free port when the desired one is taken', async () => {
    const blocker = express();
    const { server: blockSrv, port: takenPort } = await listenOnAvailablePort(blocker, 3999);

    const app = express();
    const { server, port } = await listenOnAvailablePort(app, takenPort);
    expect(port).toBeGreaterThan(takenPort);

    server.close();
    blockSrv.close();
  });

  it('gives up after maxAttempts', async () => {
    const blockers = [];
    for (let p = 4100; p < 4103; p++) {
      const { server } = await listenOnAvailablePort(express(), p, 1);
      blockers.push(server);
    }
    await expect(listenOnAvailablePort(express(), 4100, 3))
      .rejects.toThrow(/Kein freier Port/);
    blockers.forEach(s => s.close());
  });
});
