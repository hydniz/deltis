const { startDb, stopDb, clearDb, createUser } = require('./helpers/testApp');
const strava = require('../services/strava');
const StravaConnection = require('../models/StravaConnection');
const StravaActivity = require('../models/StravaActivity');
const config = require('../utils/config');

beforeAll(async () => {
  await startDb();
  process.env.STRAVA_CLIENT_ID = '12345';
  process.env.STRAVA_CLIENT_SECRET = 'test-secret';
});

afterEach(async () => {
  await clearDb();
  config._resetCache();
  jest.restoreAllMocks();
});

afterAll(async () => {
  delete process.env.STRAVA_CLIENT_ID;
  delete process.env.STRAVA_CLIENT_SECRET;
  delete process.env.PUBLIC_BASE_URL;
  await stopDb();
});

// fetch mock helpers — queue of responses, consumed in call order
function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function mockFetchQueue(...responses) {
  const calls = [];
  const spy = jest.spyOn(global, 'fetch').mockImplementation(async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (responses.length === 0) throw new Error(`Unexpected fetch: ${url}`);
    return responses.shift();
  });
  return { spy, calls };
}

async function makeConnection({ expiresInMs = 60 * 60 * 1000, ...overrides } = {}) {
  const { user } = await createUser();
  const connection = await StravaConnection.create({
    userId: user._id,
    athleteId: 4711,
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: new Date(Date.now() + expiresInMs),
    scope: 'read,activity:read_all',
    athlete: { id: 4711, firstname: 'Test', lastname: 'Athlet' },
    ...overrides,
  });
  return { user, connection: await StravaConnection.findById(connection._id).select('+accessToken +refreshToken') };
}

describe('configuration helpers', () => {
  it('isConfigured requires both client id and secret', () => {
    expect(strava.isConfigured()).toBe(true);
    const saved = process.env.STRAVA_CLIENT_SECRET;
    delete process.env.STRAVA_CLIENT_SECRET;
    expect(strava.isConfigured()).toBe(false);
    process.env.STRAVA_CLIENT_SECRET = saved;
  });

  it('builds redirect and webhook URLs from PUBLIC_BASE_URL (trailing slash stripped)', () => {
    process.env.PUBLIC_BASE_URL = 'https://deltis.jlno.de/';
    expect(strava.getRedirectUri()).toBe('https://deltis.jlno.de/api/strava/callback');
    expect(strava.getWebhookCallbackUrl()).toBe('https://deltis.jlno.de/api/strava/webhook');
    delete process.env.PUBLIC_BASE_URL;
  });

  it('falls back to the request host without PUBLIC_BASE_URL', () => {
    const req = { protocol: 'http', get: () => 'localhost:3001' };
    expect(strava.getRedirectUri(req)).toBe('http://localhost:3001/api/strava/callback');
    expect(strava.getWebhookCallbackUrl()).toBe('');
  });

  it('returns an empty redirect uri with neither PUBLIC_BASE_URL nor a request', () => {
    expect(strava.getRedirectUri()).toBe('');
  });

  it('buildAuthorizeUrl contains client id, redirect uri, scope and state', () => {
    const url = new URL(strava.buildAuthorizeUrl({ state: 'st4te', redirectUri: 'https://x/cb' }));
    expect(url.origin + url.pathname).toBe('https://www.strava.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('12345');
    expect(url.searchParams.get('redirect_uri')).toBe('https://x/cb');
    expect(url.searchParams.get('scope')).toBe(strava.OAUTH_SCOPE);
    expect(url.searchParams.get('state')).toBe('st4te');
  });
});

describe('token lifecycle', () => {
  it('returns the current token when it is still fresh (no API call)', async () => {
    const { connection } = await makeConnection();
    const { spy } = mockFetchQueue();
    const token = await strava.ensureFreshToken(connection);
    expect(token).toBe('access-token');
    expect(spy).not.toHaveBeenCalled();
  });

  it('refreshes and persists an expired token', async () => {
    const { connection } = await makeConnection({ expiresInMs: -1000 });
    const { calls } = mockFetchQueue(jsonResponse({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 21600,
    }));

    const token = await strava.ensureFreshToken(connection);
    expect(token).toBe('new-access');
    expect(calls[0].url).toBe('https://www.strava.com/oauth/token');
    expect(JSON.parse(calls[0].options.body).grant_type).toBe('refresh_token');

    const stored = await StravaConnection.findById(connection._id).select('+accessToken +refreshToken');
    expect(stored.accessToken).toBe('new-access');
    expect(stored.refreshToken).toBe('new-refresh');
  });

  it('loadConnectionWithTokens loads a connection with its tokens selected', async () => {
    const { connection } = await makeConnection();
    const loaded = await strava.loadConnectionWithTokens(connection._id);
    expect(loaded.accessToken).toBe('access-token');
    expect(loaded.refreshToken).toBe('refresh-token');
  });

  it('deauthorize calls Strava with a fresh token', async () => {
    const { connection } = await makeConnection();
    const { calls } = mockFetchQueue(jsonResponse({}));
    await strava.deauthorize(connection);
    expect(calls[0].url).toBe('https://www.strava.com/oauth/deauthorize');
    expect(calls[0].options.headers.Authorization).toBe('Bearer access-token');
  });

  it('turns a non-2xx deauthorize response into StravaApiError with status', async () => {
    const { connection } = await makeConnection();
    mockFetchQueue(jsonResponse({ message: 'invalid' }, 401));
    await expect(strava.deauthorize(connection)).rejects.toMatchObject({ name: 'StravaApiError', status: 401 });
  });

  it('falls back to a generic HTTP-status message when the error body has no message', async () => {
    const { connection } = await makeConnection();
    mockFetchQueue({ ok: false, status: 500, json: async () => ({}) });
    await expect(strava.deauthorize(connection)).rejects.toMatchObject({ message: 'Strava API: HTTP 500' });
  });

  it('does not reuse the in-memory access token when it is missing, even if not yet expired', async () => {
    const { connection } = await makeConnection();
    connection.accessToken = undefined;
    mockFetchQueue(jsonResponse({
      access_token: 'refreshed', refresh_token: 'refreshed-r',
      expires_at: Math.floor(Date.now() / 1000) + 21600,
    }));
    const token = await strava.ensureFreshToken(connection);
    expect(token).toBe('refreshed');
  });

  it('never leaks tokens through toJSON', async () => {
    const { connection } = await makeConnection();
    const json = connection.toJSON();
    expect(json.accessToken).toBeUndefined();
    expect(json.refreshToken).toBeUndefined();
    expect(json.athleteId).toBe(4711);
  });
});

describe('webhook subscription management', () => {
  it('generates and persists a verify token once', async () => {
    const first = await strava.ensureVerifyToken();
    const second = await strava.ensureVerifyToken();
    expect(first).toHaveLength(48);
    expect(second).toBe(first);
    expect(config.get('STRAVA_WEBHOOK_VERIFY_TOKEN')).toBe(first);
  });

  it('createWebhookSubscription requires PUBLIC_BASE_URL', async () => {
    await expect(strava.createWebhookSubscription()).rejects.toMatchObject({ status: 400 });
  });

  it('creates, lists and deletes the subscription with app credentials', async () => {
    process.env.PUBLIC_BASE_URL = 'https://deltis.jlno.de';
    const { calls } = mockFetchQueue(
      jsonResponse({ id: 55 }),          // create
      jsonResponse([{ id: 55 }]),        // view
      jsonResponse({}, 204)              // delete
    );

    const created = await strava.createWebhookSubscription();
    expect(created.id).toBe(55);
    const body = JSON.parse(calls[0].options.body);
    expect(body.callback_url).toBe('https://deltis.jlno.de/api/strava/webhook');
    expect(body.client_id).toBe('12345');
    expect(body.verify_token).toBeTruthy();

    const subs = await strava.viewWebhookSubscriptions();
    expect(subs).toEqual([{ id: 55 }]);

    await strava.deleteWebhookSubscription(55);
    expect(calls[2].options.method).toBe('DELETE');
    expect(calls[2].url).toContain('/push_subscriptions/55');
    delete process.env.PUBLIC_BASE_URL;
  });
});

// The actual Strava-API-calling sync logic (fetch/upsert activities) moved
// to the deltis-strava-integration plugin — handleWebhookEvent now only
// handles what needs no Strava API call: immediate delete/deauth, and
// flagging the connection (syncRequestedAt) for create/update so the
// plugin's poll loop picks it up. See docs/plugins/MANIFEST.md
// "The Strava plugin".
describe('handleWebhookEvent', () => {
  it('flags the connection for sync on activity create/update, without calling Strava', async () => {
    const { connection } = await makeConnection();
    const { spy } = mockFetchQueue();

    await strava.handleWebhookEvent({
      object_type: 'activity', aspect_type: 'create', object_id: 31, owner_id: connection.athleteId,
    });

    expect(spy).not.toHaveBeenCalled();
    const fresh = await StravaConnection.findById(connection._id);
    expect(fresh.syncRequestedAt).not.toBeNull();
  });

  it('removes the activity immediately on delete events (no Strava API call)', async () => {
    const { user, connection } = await makeConnection();
    await StravaActivity.create({
      userId: user._id, stravaId: 32, athleteId: connection.athleteId, startDate: new Date(),
    });
    const { spy } = mockFetchQueue();

    await strava.handleWebhookEvent({
      object_type: 'activity', aspect_type: 'delete', object_id: 32, owner_id: connection.athleteId,
    });

    expect(spy).not.toHaveBeenCalled();
    expect(await StravaActivity.findOne({ userId: user._id, stravaId: 32 })).toBeNull();
  });

  it('removes the connection on athlete deauthorization', async () => {
    const { connection } = await makeConnection();
    await strava.handleWebhookEvent({
      object_type: 'athlete', aspect_type: 'update', object_id: connection.athleteId,
      owner_id: connection.athleteId, updates: { authorized: 'false' },
    });
    expect(await StravaConnection.findById(connection._id)).toBeNull();
  });

  it('ignores an athlete event that is not a deauthorization', async () => {
    const { connection } = await makeConnection();
    await strava.handleWebhookEvent({
      object_type: 'athlete', aspect_type: 'update', object_id: connection.athleteId,
      owner_id: connection.athleteId, updates: { authorized: 'true' },
    });
    expect(await StravaConnection.findById(connection._id)).not.toBeNull();
  });

  it('ignores events for unknown athletes and unknown object types', async () => {
    const { spy } = mockFetchQueue();
    await strava.handleWebhookEvent({ object_type: 'activity', aspect_type: 'create', object_id: 1, owner_id: 999999 });
    await strava.handleWebhookEvent({ object_type: 'gear', aspect_type: 'create', object_id: 1, owner_id: 1 });
    await strava.handleWebhookEvent(undefined);
    expect(spy).not.toHaveBeenCalled();
  });
});
