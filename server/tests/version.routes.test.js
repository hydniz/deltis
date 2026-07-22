const request = require('supertest');
const { startDb, stopDb, buildApp } = require('./helpers/testApp');

let app;

beforeAll(async () => {
  await startDb();
  app = buildApp();
});

afterAll(async () => {
  await stopDb();
});

describe('GET /api', () => {
  it('returns a version string', async () => {
    const res = await request(app).get('/api');
    expect(res.status).toBe(200);
    expect(typeof res.body.version).toBe('string');
  });

  it('version matches semver+hash format (x.y.z+<hash>)', async () => {
    const res = await request(app).get('/api');
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+\+.+$/);
  });

  it('version starts with the package.json version', async () => {
    const { version } = require('../../package.json');
    const res = await request(app).get('/api');
    expect(res.body.version.startsWith(version + '+')).toBe(true);
  });

  it('exposes the Plugin Host API version', async () => {
    const { PLUGIN_HOST_API_VERSION } = require('../services/pluginCompatibility');
    const res = await request(app).get('/api');
    expect(res.body.pluginHostApiVersion).toBe(PLUGIN_HOST_API_VERSION);
  });
});
