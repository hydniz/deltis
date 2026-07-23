const request = require('supertest');
const jwt = require('jsonwebtoken');
const {
  startDb, stopDb, clearDb, buildApp, createUser, createAdminUser, authHeader,
} = require('./helpers/testApp');
const JWT_SECRET = require('../utils/jwtSecret');
const strava = require('../services/strava');
const stravaRouter = require('../routes/strava');
const StravaConnection = require('../models/StravaConnection');
const StravaActivity = require('../models/StravaActivity');
const config = require('../utils/config');

let app;

beforeAll(async () => {
  await startDb();
  app = buildApp();
  process.env.STRAVA_CLIENT_ID = '12345';
  process.env.STRAVA_CLIENT_SECRET = 'test-secret';
});

afterEach(async () => {
  await clearDb();
  config._resetCache();
  stravaRouter._resetManualSyncThrottle();
  jest.restoreAllMocks();
});

afterAll(async () => {
  delete process.env.STRAVA_CLIENT_ID;
  delete process.env.STRAVA_CLIENT_SECRET;
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  await stopDb();
});

function signState(userId) {
  return jwt.sign({ purpose: 'strava_oauth', userId: String(userId) }, JWT_SECRET, { expiresIn: '10m' });
}

async function createConnection(userId, overrides = {}) {
  return StravaConnection.create({
    userId,
    athleteId: 4711,
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: new Date(Date.now() + 3600000),
    scope: 'read,activity:read_all',
    athlete: { id: 4711, firstname: 'Test', lastname: 'Athlet' },
    ...overrides,
  });
}

async function createStravaActivity(userId, overrides = {}) {
  return StravaActivity.create({
    userId,
    stravaId: Math.floor(Math.random() * 1e9),
    athleteId: 4711,
    name: 'Morgenlauf',
    sportType: 'Run',
    type: 'Run',
    startDate: new Date(),
    movingTime: 1800,
    distance: 5000,
    detail: { id: 1, private_note: 'raw' },
    streams: { heartrate: { data: [140] } },
    zones: [{ type: 'heartrate', distribution_buckets: [] }],
    ...overrides,
  });
}

describe('GET /api/strava/status', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/strava/status');
    expect(res.status).toBe(401);
  });

  it('reports unconfigured when credentials are missing', async () => {
    const saved = process.env.STRAVA_CLIENT_ID;
    delete process.env.STRAVA_CLIENT_ID;
    const { token } = await createUser();
    const res = await request(app).get('/api/strava/status').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: false, connected: false, connection: null });
    process.env.STRAVA_CLIENT_ID = saved;
  });

  it('returns the connection without tokens when connected', async () => {
    const { token, user } = await createUser();
    await createConnection(user._id);
    await createStravaActivity(user._id);

    const res = await request(app).get('/api/strava/status').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.connected).toBe(true);
    expect(res.body.activityCount).toBe(1);
    expect(res.body.connection.athleteId).toBe(4711);
    expect(res.body.connection.accessToken).toBeUndefined();
    expect(res.body.connection.refreshToken).toBeUndefined();
  });
});

describe('GET /api/strava/connect', () => {
  it('rejects when Strava is not configured', async () => {
    const saved = process.env.STRAVA_CLIENT_SECRET;
    delete process.env.STRAVA_CLIENT_SECRET;
    const { token } = await createUser();
    const res = await request(app).get('/api/strava/connect').set(authHeader(token));
    expect(res.status).toBe(400);
    process.env.STRAVA_CLIENT_SECRET = saved;
  });

  it('returns an authorize URL with a valid signed state', async () => {
    const { token, user } = await createUser();
    const res = await request(app).get('/api/strava/connect').set(authHeader(token));
    expect(res.status).toBe(200);

    const url = new URL(res.body.url);
    expect(url.origin + url.pathname).toBe('https://www.strava.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('12345');
    expect(url.searchParams.get('redirect_uri')).toContain('/api/strava/callback');

    const payload = jwt.verify(url.searchParams.get('state'), JWT_SECRET);
    expect(payload.purpose).toBe('strava_oauth');
    expect(payload.userId).toBe(String(user._id));
  });
});

describe('GET /api/strava/callback', () => {
  function tokenExchangeResponse(athleteId = 4711) {
    return {
      ok: true, status: 200,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_at: Math.floor(Date.now() / 1000) + 21600,
        athlete: { id: athleteId, firstname: 'Neu', lastname: 'Athlet' },
      }),
    };
  }

  it('redirects with invalid-state for a bad state', async () => {
    const res = await request(app).get('/api/strava/callback?state=nope&code=abc&scope=activity:read_all');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('strava=invalid-state');
  });

  it('redirects with denied when the user cancelled', async () => {
    const { user } = await createUser();
    const res = await request(app)
      .get(`/api/strava/callback?state=${signState(user._id)}&error=access_denied&scope=activity:read_all`);
    expect(res.headers.location).toContain('strava=denied');
  });

  it('redirects with scope when activity read access was not granted', async () => {
    const { user } = await createUser();
    const res = await request(app)
      .get(`/api/strava/callback?state=${signState(user._id)}&code=abc&scope=read`);
    expect(res.headers.location).toContain('strava=scope');
  });

  it('creates the connection, kicks off the initial sync and redirects with success', async () => {
    const { user } = await createUser();
    jest.spyOn(global, 'fetch').mockResolvedValue(tokenExchangeResponse());
    const initialSync = jest.spyOn(strava, 'runInitialSync').mockResolvedValue({ synced: 0, failed: 0 });

    const res = await request(app)
      .get(`/api/strava/callback?state=${signState(user._id)}&code=abc&scope=read,activity:read_all`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('strava=success');

    const connection = await StravaConnection.findOne({ userId: user._id }).select('+accessToken');
    expect(connection).not.toBeNull();
    expect(connection.athleteId).toBe(4711);
    expect(connection.accessToken).toBe('new-access');
    expect(connection.scope).toBe('read,activity:read_all');
    expect(initialSync).toHaveBeenCalledTimes(1);
  });

  it('does not restart the initial sync when reconnecting', async () => {
    const { user } = await createUser();
    await createConnection(user._id, { initialSyncDone: true });
    jest.spyOn(global, 'fetch').mockResolvedValue(tokenExchangeResponse());
    const initialSync = jest.spyOn(strava, 'runInitialSync').mockResolvedValue({ synced: 0, failed: 0 });

    const res = await request(app)
      .get(`/api/strava/callback?state=${signState(user._id)}&code=abc&scope=read,activity:read_all`);
    expect(res.headers.location).toContain('strava=success');
    expect(initialSync).not.toHaveBeenCalled();
  });

  it('rejects a Strava account that is already linked to another user', async () => {
    const { user: first } = await createUser();
    await createConnection(first._id); // athleteId 4711
    const { user: second } = await createUser({ name: 'Zweiter' });
    jest.spyOn(global, 'fetch').mockResolvedValue(tokenExchangeResponse(4711));

    const res = await request(app)
      .get(`/api/strava/callback?state=${signState(second._id)}&code=abc&scope=read,activity:read_all`);
    expect(res.headers.location).toContain('strava=athlete-taken');
    expect(await StravaConnection.countDocuments({})).toBe(1);
  });

  it('redirects with error when the token exchange fails', async () => {
    const { user } = await createUser();
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'bad code' }) });

    const res = await request(app)
      .get(`/api/strava/callback?state=${signState(user._id)}&code=abc&scope=activity:read_all`);
    expect(res.headers.location).toContain('strava=error');
  });
});

describe('POST /api/strava/sync', () => {
  it('404s without a connection', async () => {
    const { token } = await createUser();
    const res = await request(app).post('/api/strava/sync').set(authHeader(token));
    expect(res.status).toBe(404);
  });

  it('runs a sync and throttles the second attempt', async () => {
    const { token, user } = await createUser();
    await createConnection(user._id);
    const sync = jest.spyOn(strava, 'syncConnection').mockResolvedValue({ synced: 2, failed: 0 });

    const first = await request(app).post('/api/strava/sync').set(authHeader(token));
    expect(first.status).toBe(200);
    expect(first.body.synced).toBe(2);
    expect(first.body.connection.accessToken).toBeUndefined();
    expect(sync).toHaveBeenCalledTimes(1);

    const second = await request(app).post('/api/strava/sync').set(authHeader(token));
    expect(second.status).toBe(429);
    expect(sync).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE /api/strava/connection', () => {
  it('disconnects even when deauthorization at Strava fails', async () => {
    const { token, user } = await createUser();
    await createConnection(user._id);
    await createStravaActivity(user._id);
    jest.spyOn(strava, 'deauthorize').mockRejectedValue(new Error('offline'));

    const res = await request(app).delete('/api/strava/connection').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, purged: 0 });
    expect(await StravaConnection.countDocuments({})).toBe(0);
    expect(await StravaActivity.countDocuments({ userId: user._id })).toBe(1); // kept
  });

  it('purges synced activities with ?purge=1', async () => {
    const { token, user } = await createUser();
    await createConnection(user._id);
    await createStravaActivity(user._id);
    await createStravaActivity(user._id);
    jest.spyOn(strava, 'deauthorize').mockResolvedValue();

    const res = await request(app).delete('/api/strava/connection?purge=1').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.purged).toBe(2);
    expect(await StravaActivity.countDocuments({ userId: user._id })).toBe(0);
  });

  it('404s without a connection', async () => {
    const { token } = await createUser();
    const res = await request(app).delete('/api/strava/connection').set(authHeader(token));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/strava/activities', () => {
  it('lists own activities without raw payloads', async () => {
    const { token, user } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    await createStravaActivity(user._id, { name: 'Meiner' });
    await createStravaActivity(other._id, { name: 'Fremder' });

    const res = await request(app).get('/api/strava/activities').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.activities[0].name).toBe('Meiner');
    expect(res.body.activities[0].detail).toBeUndefined();
    expect(res.body.activities[0].streams).toBeUndefined();
    expect(res.body.activities[0].zones).toBeUndefined();
  });

  it('filters by sport type and date range', async () => {
    const { token, user } = await createUser();
    await createStravaActivity(user._id, { sportType: 'Run', startDate: new Date('2026-07-01') });
    await createStravaActivity(user._id, { sportType: 'Ride', startDate: new Date('2026-07-10') });

    const bySport = await request(app).get('/api/strava/activities?sportType=Ride').set(authHeader(token));
    expect(bySport.body.total).toBe(1);
    expect(bySport.body.activities[0].sportType).toBe('Ride');

    const byDate = await request(app)
      .get('/api/strava/activities?startDate=2026-07-05&endDate=2026-07-15')
      .set(authHeader(token));
    expect(byDate.body.total).toBe(1);
    expect(byDate.body.activities[0].sportType).toBe('Ride');
  });
});

describe('GET /api/strava/activities/:id', () => {
  it('returns the full document without streams by default', async () => {
    const { token, user } = await createUser();
    const activity = await createStravaActivity(user._id);

    const res = await request(app).get(`/api/strava/activities/${activity._id}`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.detail).toBeDefined();
    expect(res.body.zones).toBeDefined();
    expect(res.body.streams).toBeUndefined();

    const withStreams = await request(app)
      .get(`/api/strava/activities/${activity._id}?streams=1`).set(authHeader(token));
    expect(withStreams.body.streams.heartrate.data).toEqual([140]);
  });

  it('does not expose another user\'s activity', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    const activity = await createStravaActivity(other._id);

    const res = await request(app).get(`/api/strava/activities/${activity._id}`).set(authHeader(token));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/strava/sport-types', () => {
  it('returns the user\'s distinct sport types sorted', async () => {
    const { token, user } = await createUser();
    await createStravaActivity(user._id, { sportType: 'Run' });
    await createStravaActivity(user._id, { sportType: 'Ride' });
    await createStravaActivity(user._id, { sportType: 'Run' });

    const res = await request(app).get('/api/strava/sport-types').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(['Ride', 'Run']);
  });
});

describe('webhook endpoint', () => {
  it('echoes the challenge for a valid verify token (dotted query keys survive)', async () => {
    process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = 'vtoken';
    const res = await request(app)
      .get('/api/strava/webhook?hub.mode=subscribe&hub.verify_token=vtoken&hub.challenge=chall-123');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ 'hub.challenge': 'chall-123' });
    delete process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  });

  it('rejects wrong or missing verify tokens', async () => {
    process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = 'vtoken';
    const wrong = await request(app)
      .get('/api/strava/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=x');
    expect(wrong.status).toBe(403);
    delete process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;

    // No token configured at all → never validate
    const unconfigured = await request(app)
      .get('/api/strava/webhook?hub.mode=subscribe&hub.verify_token=&hub.challenge=x');
    expect(unconfigured.status).toBe(403);
  });

  it('acknowledges events immediately and processes them in the background', async () => {
    const handled = jest.spyOn(strava, 'handleWebhookEvent').mockResolvedValue();
    const event = { object_type: 'activity', aspect_type: 'create', object_id: 9, owner_id: 4711 };

    const res = await request(app).post('/api/strava/webhook').send(event);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    await new Promise(resolve => setImmediate(resolve));
    expect(handled).toHaveBeenCalledWith(expect.objectContaining({ object_id: 9 }));
  });

  it('stays 200 even when event processing fails', async () => {
    jest.spyOn(strava, 'handleWebhookEvent').mockRejectedValue(new Error('boom'));
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).post('/api/strava/webhook').send({ object_type: 'activity' });
    expect(res.status).toBe(200);

    await new Promise(resolve => setImmediate(resolve));
    expect(errorLog).toHaveBeenCalled();
  });
});

describe('admin endpoints', () => {
  it('rejects non-admins', async () => {
    const { token } = await createUser();
    for (const call of [
      request(app).get('/api/strava/admin/overview').set(authHeader(token)),
      request(app).get('/api/strava/admin/subscription').set(authHeader(token)),
      request(app).post('/api/strava/admin/subscription').set(authHeader(token)),
      request(app).delete('/api/strava/admin/subscription/1').set(authHeader(token)),
    ]) {
      const res = await call;
      expect(res.status).toBe(403);
    }
  });

  it('overview reports config state and the authorization callback domain', async () => {
    process.env.PUBLIC_BASE_URL = 'https://deltis.jlno.de';
    const { token, user } = await createAdminUser();
    await createConnection(user._id);
    await createStravaActivity(user._id);

    const res = await request(app).get('/api/strava/admin/overview').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      configured: true,
      publicBaseUrl: 'https://deltis.jlno.de',
      callbackDomain: 'deltis.jlno.de',
      webhookCallbackUrl: 'https://deltis.jlno.de/api/strava/webhook',
      connectedUsers: 1,
      activityCount: 1,
    });
    delete process.env.PUBLIC_BASE_URL;
  });

  it('manages the webhook subscription', async () => {
    process.env.PUBLIC_BASE_URL = 'https://deltis.jlno.de';
    const { token } = await createAdminUser();
    jest.spyOn(strava, 'createWebhookSubscription').mockResolvedValue({ id: 7 });
    jest.spyOn(strava, 'viewWebhookSubscriptions').mockResolvedValue([{ id: 7 }]);
    jest.spyOn(strava, 'deleteWebhookSubscription').mockResolvedValue();

    const created = await request(app).post('/api/strava/admin/subscription').set(authHeader(token));
    expect(created.status).toBe(201);
    expect(created.body.subscription.id).toBe(7);

    const listed = await request(app).get('/api/strava/admin/subscription').set(authHeader(token));
    expect(listed.body.subscriptions).toEqual([{ id: 7 }]);

    const deleted = await request(app).delete('/api/strava/admin/subscription/7').set(authHeader(token));
    expect(deleted.body).toEqual({ success: true });
    delete process.env.PUBLIC_BASE_URL;
  });

  it('subscription routes reject when Strava is unconfigured', async () => {
    const savedId = process.env.STRAVA_CLIENT_ID;
    delete process.env.STRAVA_CLIENT_ID;
    const { token } = await createAdminUser();
    const res = await request(app).get('/api/strava/admin/subscription').set(authHeader(token));
    expect(res.status).toBe(400);
    process.env.STRAVA_CLIENT_ID = savedId;
  });
});
