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

function detailPayload(id, extra = {}) {
  return {
    id,
    name: `Lauf ${id}`,
    sport_type: 'Run',
    type: 'Run',
    start_date: '2026-07-15T06:00:00Z',
    start_date_local: '2026-07-15T08:00:00Z',
    timezone: '(GMT+01:00) Europe/Berlin',
    moving_time: 1800,
    elapsed_time: 1900,
    distance: 5000,
    total_elevation_gain: 40,
    average_speed: 2.78,
    max_speed: 4.1,
    average_heartrate: 148,
    max_heartrate: 171,
    has_heartrate: true,
    suffer_score: 42,
    calories: 350,
    trainer: false,
    commute: false,
    manual: false,
    ...extra,
  };
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

  it('turns non-2xx responses into StravaApiError with status', async () => {
    const { connection } = await makeConnection();
    mockFetchQueue(jsonResponse({ message: 'Rate Limit Exceeded' }, 429));
    await expect(strava.apiGet(connection, '/athlete/activities')).rejects.toMatchObject({
      name: 'StravaApiError',
      status: 429,
    });
  });

  it('never leaks tokens through toJSON', async () => {
    const { connection } = await makeConnection();
    const json = connection.toJSON();
    expect(json.accessToken).toBeUndefined();
    expect(json.refreshToken).toBeUndefined();
    expect(json.athleteId).toBe(4711);
  });
});

describe('fetchActivityBundle', () => {
  it('fetches detail, zones and streams (latlng defensively removed)', async () => {
    const { connection } = await makeConnection();
    const { calls } = mockFetchQueue(
      jsonResponse(detailPayload(1)),
      jsonResponse([{ type: 'heartrate', distribution_buckets: [{ time: 100 }] }]),
      jsonResponse({
        heartrate: { data: [140, 150] },
        time: { data: [0, 1] },
        latlng: { data: [[48.1, 9.2]] },
      })
    );

    const bundle = await strava.fetchActivityBundle(connection, 1);
    expect(bundle.detail.id).toBe(1);
    expect(bundle.zones[0].type).toBe('heartrate');
    expect(bundle.streams.heartrate.data).toEqual([140, 150]);
    expect(bundle.streams.latlng).toBeUndefined();

    expect(calls[0].url).toContain('/activities/1?');
    expect(calls[1].url).toContain('/activities/1/zones');
    expect(calls[2].url).toContain('/activities/1/streams');
    expect(calls[2].url).not.toContain('latlng');
  });

  it('tolerates missing zones (403/404) and missing streams (404)', async () => {
    const { connection } = await makeConnection();
    mockFetchQueue(
      jsonResponse(detailPayload(2)),
      jsonResponse({ message: 'not found' }, 404),
      jsonResponse({ message: 'not found' }, 404)
    );
    const bundle = await strava.fetchActivityBundle(connection, 2);
    expect(bundle.detail.id).toBe(2);
    expect(bundle.zones).toBeNull();
    expect(bundle.streams).toBeNull();
  });

  it('propagates unexpected stream errors', async () => {
    const { connection } = await makeConnection();
    mockFetchQueue(
      jsonResponse(detailPayload(3)),
      jsonResponse([]),
      jsonResponse({ message: 'boom' }, 500)
    );
    await expect(strava.fetchActivityBundle(connection, 3)).rejects.toMatchObject({ status: 500 });
  });
});

describe('upsertActivity', () => {
  it('inserts and updates without creating duplicates', async () => {
    const { user, connection } = await makeConnection();

    await strava.upsertActivity(user._id, connection.athleteId, {
      detail: detailPayload(99),
      zones: null,
      streams: null,
    });
    await strava.upsertActivity(user._id, connection.athleteId, {
      detail: detailPayload(99, { name: 'Umbenannt', distance: 6000 }),
      zones: [{ type: 'heartrate', distribution_buckets: [] }],
      streams: { heartrate: { data: [1] } },
    });

    const docs = await StravaActivity.find({ userId: user._id });
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe('Umbenannt');
    expect(docs[0].distance).toBe(6000);
    expect(docs[0].sportType).toBe('Run');
    expect(docs[0].detail.name).toBe('Umbenannt');
    expect(docs[0].zones[0].type).toBe('heartrate');
  });
});

describe('sync', () => {
  it('paginates the activity list until exhausted', async () => {
    const { connection } = await makeConnection();
    const page1 = Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }));
    const page2 = [{ id: 51 }];
    const { calls } = mockFetchQueue(jsonResponse(page1), jsonResponse(page2));

    const all = await strava.listActivitiesSince(connection, new Date('2026-07-09'));
    expect(all).toHaveLength(51);
    expect(calls[0].url).toContain('page=1');
    expect(calls[1].url).toContain('page=2');
  });

  it('syncs listed activities and records lastSyncAt', async () => {
    const { user, connection } = await makeConnection();
    mockFetchQueue(
      jsonResponse([{ id: 7 }]),          // list
      jsonResponse(detailPayload(7)),     // detail
      jsonResponse([]),                   // zones
      jsonResponse({ heartrate: { data: [140] } }) // streams
    );

    const result = await strava.syncConnectionSince(connection, new Date('2026-07-09'));
    expect(result).toEqual({ synced: 1, failed: 0 });

    const activity = await StravaActivity.findOne({ userId: user._id, stravaId: 7 });
    expect(activity).not.toBeNull();
    const fresh = await StravaConnection.findById(connection._id);
    expect(fresh.lastSyncAt).not.toBeNull();
    expect(fresh.lastSyncError).toBeNull();
  });

  it('continues after a failing activity and records the first error', async () => {
    const { connection } = await makeConnection();
    mockFetchQueue(
      jsonResponse([{ id: 1 }, { id: 2 }]),
      jsonResponse({ message: 'kaputt' }, 500), // detail of 1 fails
      jsonResponse(detailPayload(2)),
      jsonResponse([]),
      jsonResponse({ message: 'not found' }, 404)
    );

    const result = await strava.syncConnectionSince(connection, new Date('2026-07-09'));
    expect(result).toEqual({ synced: 1, failed: 1 });
    const fresh = await StravaConnection.findById(connection._id);
    expect(fresh.lastSyncError).toContain('kaputt');
  });

  it('aborts the run on a rate-limit error (429)', async () => {
    const { connection } = await makeConnection();
    mockFetchQueue(
      jsonResponse([{ id: 1 }, { id: 2 }, { id: 3 }]),
      jsonResponse({ message: 'Rate Limit Exceeded' }, 429)
    );

    const result = await strava.syncConnectionSince(connection, new Date('2026-07-09'));
    expect(result.synced).toBe(0);
    expect(result.failed).toBe(1); // only the first — the rest is postponed
  });

  it('runInitialSync backfills and marks initialSyncDone', async () => {
    const { connection } = await makeConnection();
    const { calls } = mockFetchQueue(jsonResponse([]));

    await strava.runInitialSync(connection);

    const after = Number(new URL(calls[0].url).searchParams.get('after'));
    const expected = Math.floor((Date.now() - strava.INITIAL_SYNC_DAYS * 86400000) / 1000);
    expect(Math.abs(after - expected)).toBeLessThan(60);

    const fresh = await StravaConnection.findById(connection._id);
    expect(fresh.initialSyncDone).toBe(true);
  });

  it('syncConnection resumes from lastSyncAt with an overlap window', async () => {
    const lastSyncAt = new Date('2026-07-15T12:00:00Z');
    const { connection } = await makeConnection({ lastSyncAt });
    const { calls } = mockFetchQueue(jsonResponse([]));

    await strava.syncConnection(connection);

    const after = Number(new URL(calls[0].url).searchParams.get('after'));
    expect(after).toBeLessThan(Math.floor(lastSyncAt.getTime() / 1000));
  });

  it('loads tokens itself when given a token-less connection document', async () => {
    const { connection } = await makeConnection();
    const bare = await StravaConnection.findById(connection._id); // no tokens selected
    expect(bare.accessToken).toBeUndefined();
    mockFetchQueue(jsonResponse([]));
    const result = await strava.syncConnectionSince(bare, new Date());
    expect(result.failed).toBe(0);
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

describe('handleWebhookEvent', () => {
  it('fetches and upserts on activity create/update', async () => {
    const { user, connection } = await makeConnection();
    mockFetchQueue(
      jsonResponse(detailPayload(31)),
      jsonResponse([]),
      jsonResponse({ message: 'not found' }, 404)
    );

    await strava.handleWebhookEvent({
      object_type: 'activity', aspect_type: 'create', object_id: 31, owner_id: connection.athleteId,
    });

    expect(await StravaActivity.findOne({ userId: user._id, stravaId: 31 })).not.toBeNull();
  });

  it('removes the activity on delete events', async () => {
    const { user, connection } = await makeConnection();
    await strava.upsertActivity(user._id, connection.athleteId, { detail: detailPayload(32), zones: null, streams: null });

    await strava.handleWebhookEvent({
      object_type: 'activity', aspect_type: 'delete', object_id: 32, owner_id: connection.athleteId,
    });

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

  it('ignores events for unknown athletes and unknown object types', async () => {
    const { spy } = mockFetchQueue();
    await strava.handleWebhookEvent({ object_type: 'activity', aspect_type: 'create', object_id: 1, owner_id: 999999 });
    await strava.handleWebhookEvent({ object_type: 'gear', aspect_type: 'create', object_id: 1, owner_id: 1 });
    await strava.handleWebhookEvent(undefined);
    expect(spy).not.toHaveBeenCalled();
  });
});
