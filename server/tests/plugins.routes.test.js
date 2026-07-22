const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createUser, createAdminUser, authHeader } = require('./helpers/testApp');

jest.mock('../services/pluginRuntime');
const pluginRuntime = require('../services/pluginRuntime');
const PluginInstall = require('../models/PluginInstall');
const PluginUserGrant = require('../models/PluginUserGrant');
const logger = require('../utils/logger');

let app;

beforeAll(async () => {
  await startDb();
  app = buildApp();
});

afterEach(async () => {
  await clearDb();
  jest.restoreAllMocks();
  jest.resetAllMocks();
});

afterAll(async () => {
  await stopDb();
});

function manifest(overrides = {}) {
  return {
    manifestVersion: 1,
    id: 'strava-integration',
    name: 'Strava',
    version: '1.0.0',
    description: 'Synchronisiert Aktivitäten von Strava.',
    author: 'hydniz',
    capabilities: ['habits:read', 'activities:write', 'network:api.strava.com'],
    runtime: { type: 'docker', image: 'ghcr.io/hydniz/deltis-strava-integration:1.0.0' },
    ...overrides,
  };
}

describe('GET /api/plugins/catalog/:store', () => {
  it('rejects a non-admin', async () => {
    const { token } = await createUser();
    const res = await request(app).get('/api/plugins/catalog/verified').set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('rejects an unknown store name', async () => {
    const { token } = await createAdminUser();
    const res = await request(app).get('/api/plugins/catalog/bogus').set(authHeader(token));
    expect(res.status).toBe(404);
  });

  it('proxies the store catalog for an admin', async () => {
    const { token } = await createAdminUser();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ([{ id: 'strava-integration', name: 'Strava' }]),
    });
    const res = await request(app).get('/api/plugins/catalog/verified').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'strava-integration', name: 'Strava' }]);
  });

  it('maps a store error to a client-visible failure', async () => {
    const { token } = await createAdminUser();
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'nicht gefunden' }) });
    const res = await request(app).get('/api/plugins/catalog/verified').set(authHeader(token));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('nicht gefunden');
  });

  it('falls back to a generic message and 502 for a 5xx store response with no error body', async () => {
    const { token } = await createAdminUser();
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const res = await request(app).get('/api/plugins/catalog/verified').set(authHeader(token));
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Store antwortete mit 500');
  });

  it('502s when the store is entirely unreachable', async () => {
    const { token } = await createAdminUser();
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(app).get('/api/plugins/catalog/verified').set(authHeader(token));
    expect(res.status).toBe(502);
  });

  it('502s with a generic message when the store response body is not valid JSON', async () => {
    const { token } = await createAdminUser();
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('unexpected token'); } });
    const res = await request(app).get('/api/plugins/catalog/verified').set(authHeader(token));
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Store antwortete mit 500');
  });
});

describe('GET /api/plugins/catalog/:store/:id', () => {
  it('includes German capability descriptions alongside the raw manifest', async () => {
    const { token } = await createAdminUser();
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ manifest: manifest() }) });
    const res = await request(app).get('/api/plugins/catalog/verified/strava-integration').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.capabilityDescriptions).toEqual(expect.arrayContaining([
      { capability: 'habits:read', description: expect.any(String) },
    ]));
  });

  it('rejects an unknown store name', async () => {
    const { token } = await createAdminUser();
    const res = await request(app).get('/api/plugins/catalog/bogus/strava-integration').set(authHeader(token));
    expect(res.status).toBe(404);
  });

  it('maps a store error to a client-visible failure', async () => {
    const { token } = await createAdminUser();
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'nicht gefunden' }) });
    const res = await request(app).get('/api/plugins/catalog/verified/unknown-plugin').set(authHeader(token));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('nicht gefunden');
  });

  it('502s when the store is entirely unreachable', async () => {
    const { token } = await createAdminUser();
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(app).get('/api/plugins/catalog/verified/strava-integration').set(authHeader(token));
    expect(res.status).toBe(502);
  });
});

describe('GET /api/plugins/installed', () => {
  it('rejects a non-admin', async () => {
    const { token } = await createUser();
    const res = await request(app).get('/api/plugins/installed').set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('lists installed plugins for an admin, newest first', async () => {
    const { token } = await createAdminUser();
    pluginRuntime.provision.mockResolvedValue({ token: 't', tokenHash: 'h', containerId: 'c1', containerName: 'n' });
    await request(app).post('/api/plugins/install').set(authHeader(token)).send({ source: 'verified', manifest: manifest() });

    const res = await request(app).get('/api/plugins/installed').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([expect.objectContaining({ pluginId: 'strava-integration' })]);
  });

  it('includes compatibilityWarnings computed against the current core version', async () => {
    const { token } = await createAdminUser();
    pluginRuntime.provision.mockResolvedValue({ token: 't', tokenHash: 'h', containerId: 'c1', containerName: 'n' });
    await request(app).post('/api/plugins/install').set(authHeader(token))
      .send({ source: 'verified', manifest: manifest({ compatibility: { testedCoreVersion: '0.0.1' } }) });

    const res = await request(app).get('/api/plugins/installed').set(authHeader(token));
    expect(res.body[0].compatibilityWarnings).toEqual([expect.stringContaining('nur mit Deltis 0.0.1 getestet')]);
  });

  it('500s when the lookup fails', async () => {
    const { token } = await createAdminUser();
    jest.spyOn(PluginInstall, 'find').mockReturnValue({ sort: () => Promise.reject(new Error('db down')) });
    const res = await request(app).get('/api/plugins/installed').set(authHeader(token));
    expect(res.status).toBe(500);
  });
});

describe('POST /api/plugins/install', () => {
  it('rejects a non-admin', async () => {
    const { token } = await createUser();
    const res = await request(app).post('/api/plugins/install').set(authHeader(token)).send({ source: 'verified', manifest: manifest() });
    expect(res.status).toBe(403);
  });

  it('rejects a request with no body at all', async () => {
    const { token } = await createAdminUser();
    const res = await request(app).post('/api/plugins/install').set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('rejects an invalid source', async () => {
    const { token } = await createAdminUser();
    const res = await request(app).post('/api/plugins/install').set(authHeader(token)).send({ source: 'sketchy', manifest: manifest() });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid manifest with details', async () => {
    const { token } = await createAdminUser();
    const res = await request(app).post('/api/plugins/install').set(authHeader(token))
      .send({ source: 'verified', manifest: manifest({ capabilities: ['not-a-real-capability'] }) });
    expect(res.status).toBe(400);
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it('provisions a container and stores the install on success', async () => {
    const { token, user } = await createAdminUser();
    pluginRuntime.provision.mockResolvedValue({
      token: 'raw-token', tokenHash: 'hashed-token', containerId: 'c1', containerName: 'deltis-plugin-strava-integration',
    });

    const res = await request(app).post('/api/plugins/install').set(authHeader(token))
      .send({ source: 'verified', manifest: manifest(), sourceRef: 'v1.0.0' });

    expect(res.status).toBe(201);
    expect(res.body.pluginId).toBe('strava-integration');
    expect(res.body.status).toBe('running');
    expect(res.body.containerId).toBe('c1');
    // The raw token must never be echoed back to the client.
    expect(JSON.stringify(res.body)).not.toContain('raw-token');

    const stored = await PluginInstall.findOne({ pluginId: 'strava-integration' }).select('+tokenHash');
    expect(stored.tokenHash).toBe('hashed-token');
    expect(stored.consentedBy.toString()).toBe(user._id.toString());
  });

  it('logs a compatibility warning at install time when the manifest is already stale', async () => {
    const { token } = await createAdminUser();
    pluginRuntime.provision.mockResolvedValue({ token: 't', tokenHash: 'h', containerId: 'c1', containerName: 'n' });
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    await request(app).post('/api/plugins/install').set(authHeader(token))
      .send({ source: 'verified', manifest: manifest({ compatibility: { testedCoreVersion: '0.0.1' } }) });

    expect(warnSpy).toHaveBeenCalledWith('plugins', expect.stringContaining('Kompatibilitätswarnung'));
  });

  it('rejects installing the same plugin twice', async () => {
    const { token } = await createAdminUser();
    pluginRuntime.provision.mockResolvedValue({ token: 't', tokenHash: 'h', containerId: 'c1', containerName: 'n' });
    await request(app).post('/api/plugins/install').set(authHeader(token)).send({ source: 'verified', manifest: manifest() });

    const res = await request(app).post('/api/plugins/install').set(authHeader(token)).send({ source: 'verified', manifest: manifest() });
    expect(res.status).toBe(409);
  });

  it('surfaces a provisioning failure as 502 without creating an install record', async () => {
    const { token } = await createAdminUser();
    pluginRuntime.provision.mockRejectedValue(new Error('docker.sock unreachable'));

    const res = await request(app).post('/api/plugins/install').set(authHeader(token)).send({ source: 'verified', manifest: manifest() });
    expect(res.status).toBe(502);
    expect(await PluginInstall.countDocuments({})).toBe(0);
  });
});

describe('PUT /api/plugins/:pluginId/enabled', () => {
  async function installOne(token) {
    pluginRuntime.provision.mockResolvedValue({ token: 't', tokenHash: 'h', containerId: 'c1', containerName: 'n' });
    await request(app).post('/api/plugins/install').set(authHeader(token)).send({ source: 'verified', manifest: manifest() });
  }

  it('404s for an unknown plugin', async () => {
    const { token } = await createAdminUser();
    const res = await request(app).put('/api/plugins/nope/enabled').set(authHeader(token)).send({ enabled: false });
    expect(res.status).toBe(404);
  });

  it('stops the container when disabling a running plugin', async () => {
    const { token } = await createAdminUser();
    await installOne(token);

    const res = await request(app).put('/api/plugins/strava-integration/enabled').set(authHeader(token)).send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('stopped');
    expect(pluginRuntime.stop).toHaveBeenCalledWith('c1');
  });

  it('starts the container when re-enabling a stopped plugin', async () => {
    const { token } = await createAdminUser();
    await installOne(token);
    await request(app).put('/api/plugins/strava-integration/enabled').set(authHeader(token)).send({ enabled: false });

    const res = await request(app).put('/api/plugins/strava-integration/enabled').set(authHeader(token)).send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('running');
    expect(pluginRuntime.start).toHaveBeenCalledWith('c1');
  });

  it('surfaces a container stop failure as 502', async () => {
    const { token } = await createAdminUser();
    await installOne(token);
    pluginRuntime.stop.mockRejectedValue(new Error('docker.sock unreachable'));

    const res = await request(app).put('/api/plugins/strava-integration/enabled').set(authHeader(token)).send({ enabled: false });
    expect(res.status).toBe(502);
  });
});

describe('DELETE /api/plugins/:pluginId', () => {
  it('404s for an unknown plugin', async () => {
    const { token } = await createAdminUser();
    const res = await request(app).delete('/api/plugins/nope').set(authHeader(token));
    expect(res.status).toBe(404);
  });

  it('removes the container, the install and any user grants', async () => {
    const { token: adminToken } = await createAdminUser();
    const { token: userToken, user } = await createUser();
    pluginRuntime.provision.mockResolvedValue({ token: 't', tokenHash: 'h', containerId: 'c1', containerName: 'n' });
    await request(app).post('/api/plugins/install').set(authHeader(adminToken)).send({ source: 'verified', manifest: manifest() });
    await request(app).post('/api/plugins/strava-integration/grant').set(authHeader(userToken));

    const res = await request(app).delete('/api/plugins/strava-integration').set(authHeader(adminToken));

    expect(res.status).toBe(200);
    expect(pluginRuntime.remove).toHaveBeenCalledWith('c1');
    expect(await PluginInstall.countDocuments({})).toBe(0);
    expect(await PluginUserGrant.countDocuments({ userId: user._id })).toBe(0);
  });

  it('deletes a plugin that never got a container (e.g. provisioning failed before start) without calling remove', async () => {
    const { token, user } = await createAdminUser();
    await PluginInstall.create({
      pluginId: 'strava-integration', source: 'verified', manifest: manifest(), capabilities: manifest().capabilities,
      consentedAt: new Date(), consentedBy: user._id, status: 'error', containerId: null, tokenHash: 'h',
    });

    const res = await request(app).delete('/api/plugins/strava-integration').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(pluginRuntime.remove).not.toHaveBeenCalled();
  });

  it('surfaces a container removal failure as 502', async () => {
    const { token } = await createAdminUser();
    pluginRuntime.provision.mockResolvedValue({ token: 't', tokenHash: 'h', containerId: 'c1', containerName: 'n' });
    await request(app).post('/api/plugins/install').set(authHeader(token)).send({ source: 'verified', manifest: manifest() });
    pluginRuntime.remove.mockRejectedValue(new Error('docker.sock unreachable'));

    const res = await request(app).delete('/api/plugins/strava-integration').set(authHeader(token));
    expect(res.status).toBe(502);
  });
});

describe('user-facing grant flow', () => {
  async function installOne(adminToken) {
    pluginRuntime.provision.mockResolvedValue({ token: 't', tokenHash: 'h', containerId: 'c1', containerName: 'n' });
    await request(app).post('/api/plugins/install').set(authHeader(adminToken)).send({ source: 'verified', manifest: manifest() });
  }

  it('lists installed plugins as not-yet-granted for a fresh user', async () => {
    const { token: adminToken } = await createAdminUser();
    await installOne(adminToken);
    const { token: userToken } = await createUser();

    const res = await request(app).get('/api/plugins/available').set(authHeader(userToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([expect.objectContaining({ pluginId: 'strava-integration', granted: false, compatibilityWarnings: [] })]);
  });

  it('reflects granted:true after the user grants, and false again after revoking', async () => {
    const { token: adminToken } = await createAdminUser();
    await installOne(adminToken);
    const { token: userToken } = await createUser();

    const grantRes = await request(app).post('/api/plugins/strava-integration/grant').set(authHeader(userToken));
    expect(grantRes.status).toBe(201);
    expect(grantRes.body.capabilities).toEqual(manifest().capabilities);

    let res = await request(app).get('/api/plugins/available').set(authHeader(userToken));
    expect(res.body[0].granted).toBe(true);

    const revokeRes = await request(app).delete('/api/plugins/strava-integration/grant').set(authHeader(userToken));
    expect(revokeRes.status).toBe(200);

    res = await request(app).get('/api/plugins/available').set(authHeader(userToken));
    expect(res.body[0].granted).toBe(false);
  });

  it('revoking a grant that never existed is a harmless no-op', async () => {
    const { token: userToken } = await createUser();
    const res = await request(app).delete('/api/plugins/never-installed/grant').set(authHeader(userToken));
    expect(res.status).toBe(200);
  });

  it('does not let a user grant a plugin that is not installed', async () => {
    const { token: userToken } = await createUser();
    const res = await request(app).post('/api/plugins/never-installed/grant').set(authHeader(userToken));
    expect(res.status).toBe(404);
  });

  it('GET /available 500s when the lookup fails', async () => {
    const { token: userToken } = await createUser();
    jest.spyOn(PluginInstall, 'find').mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/api/plugins/available').set(authHeader(userToken));
    expect(res.status).toBe(500);
  });

  it('POST /:pluginId/grant 500s when the upsert fails', async () => {
    const { token: adminToken } = await createAdminUser();
    await installOne(adminToken);
    const { token: userToken } = await createUser();
    jest.spyOn(PluginUserGrant, 'findOneAndUpdate').mockRejectedValue(new Error('db down'));

    const res = await request(app).post('/api/plugins/strava-integration/grant').set(authHeader(userToken));
    expect(res.status).toBe(500);
  });

  it('DELETE /:pluginId/grant 500s when the update fails', async () => {
    const { token: userToken } = await createUser();
    jest.spyOn(PluginUserGrant, 'findOneAndUpdate').mockRejectedValue(new Error('db down'));

    const res = await request(app).delete('/api/plugins/strava-integration/grant').set(authHeader(userToken));
    expect(res.status).toBe(500);
  });
});
