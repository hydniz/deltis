// Strava API service: OAuth token lifecycle, authenticated API access,
// activity sync (summary → detail + heart-rate zones + streams, no GPS track)
// and webhook subscription management.
//
// Credentials come from the runtime config (env → admin UI override):
// STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET. Tokens are never logged.
const crypto = require('crypto');
const config = require('../utils/config');
const StravaConnection = require('../models/StravaConnection');
const StravaActivity = require('../models/StravaActivity');

const OAUTH_BASE = 'https://www.strava.com/oauth';
const API_BASE = 'https://www.strava.com/api/v3';

// Scope: read = public profile, activity:read_all = all activities incl.
// private ones (needed for a complete sync).
const OAUTH_SCOPE = 'read,activity:read_all';

// Every stream type Strava offers except latlng (GPS track — deliberately
// not stored, see docs/STRAVA.md).
const STREAM_KEYS = [
  'time', 'heartrate', 'velocity_smooth', 'distance', 'altitude',
  'cadence', 'watts', 'temp', 'moving', 'grade_smooth',
];

const INITIAL_SYNC_DAYS = 7;
// Polling re-fetches a small overlap window so activities uploaded late
// (device sync delays) are not missed.
const POLL_OVERLAP_MS = 2 * 60 * 60 * 1000;
// Refresh the access token when it expires within this margin.
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

class StravaApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'StravaApiError';
    this.status = status;
  }
}

function isConfigured() {
  return Boolean(config.get('STRAVA_CLIENT_ID') && config.get('STRAVA_CLIENT_SECRET'));
}

// Effective public base URL without trailing slash; empty string when unset.
function getPublicBaseUrl() {
  return String(config.get('PUBLIC_BASE_URL') || '').trim().replace(/\/+$/, '');
}

// Redirect URI for the OAuth flow. Falls back to the request host so local
// development works without configuring PUBLIC_BASE_URL.
function getRedirectUri(req) {
  const base = getPublicBaseUrl();
  if (base) return `${base}/api/strava/callback`;
  if (req) return `${req.protocol}://${req.get('host')}/api/strava/callback`;
  return '';
}

function getWebhookCallbackUrl() {
  const base = getPublicBaseUrl();
  return base ? `${base}/api/strava/webhook` : '';
}

function buildAuthorizeUrl({ state, redirectUri }) {
  const params = new URLSearchParams({
    client_id: config.get('STRAVA_CLIENT_ID'),
    response_type: 'code',
    redirect_uri: redirectUri,
    approval_prompt: 'auto',
    scope: OAUTH_SCOPE,
    state,
  });
  return `${OAUTH_BASE}/authorize?${params.toString()}`;
}

// fetch wrapper: parses JSON, converts non-2xx into StravaApiError without
// ever echoing tokens back into logs or error messages.
async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  let body = null;
  try { body = await res.json(); } catch { /* empty or non-JSON body */ }
  if (!res.ok) {
    const detail = body?.message || `HTTP ${res.status}`;
    throw new StravaApiError(`Strava API: ${detail}`, res.status);
  }
  return body;
}

async function exchangeCode(code, redirectUri) {
  return requestJson(`${OAUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.get('STRAVA_CLIENT_ID'),
      client_secret: config.get('STRAVA_CLIENT_SECRET'),
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
}

async function refreshTokens(refreshToken) {
  return requestJson(`${OAUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.get('STRAVA_CLIENT_ID'),
      client_secret: config.get('STRAVA_CLIENT_SECRET'),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
}

// Loads the connection with tokens included. Callers holding a token-less
// document (select:false) go through here before any API call.
async function loadConnectionWithTokens(connectionId) {
  return StravaConnection.findById(connectionId).select('+accessToken +refreshToken');
}

// Returns a valid access token for the connection, refreshing and persisting
// new tokens when the current one is (nearly) expired.
async function ensureFreshToken(connection) {
  const expiresAt = connection.expiresAt ? new Date(connection.expiresAt).getTime() : 0;
  if (expiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS && connection.accessToken) {
    return connection.accessToken;
  }

  const data = await refreshTokens(connection.refreshToken);
  connection.accessToken = data.access_token;
  connection.refreshToken = data.refresh_token;
  connection.expiresAt = new Date(data.expires_at * 1000);
  await connection.save();
  return connection.accessToken;
}

// Authenticated GET against the Strava API for a connection document that
// includes its tokens.
async function apiGet(connection, path, params = {}) {
  const token = await ensureFreshToken(connection);
  const qs = new URLSearchParams(params).toString();
  const url = `${API_BASE}${path}${qs ? `?${qs}` : ''}`;
  return requestJson(url, { headers: { Authorization: `Bearer ${token}` } });
}

async function deauthorize(connection) {
  const token = await ensureFreshToken(connection);
  await requestJson(`${OAUTH_BASE}/deauthorize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Activity sync

// Maps a detailed Strava activity onto the promoted top-level fields.
function mapActivityFields(detail) {
  return {
    name: detail.name || '',
    sportType: detail.sport_type || detail.type || '',
    type: detail.type || '',
    startDate: detail.start_date ? new Date(detail.start_date) : new Date(),
    startDateLocal: detail.start_date_local ? new Date(detail.start_date_local) : undefined,
    timezone: detail.timezone,
    movingTime: detail.moving_time ?? 0,
    elapsedTime: detail.elapsed_time ?? 0,
    distance: detail.distance ?? 0,
    totalElevationGain: detail.total_elevation_gain ?? 0,
    averageSpeed: detail.average_speed,
    maxSpeed: detail.max_speed,
    averageHeartrate: detail.average_heartrate,
    maxHeartrate: detail.max_heartrate,
    averageCadence: detail.average_cadence,
    averageWatts: detail.average_watts,
    kilojoules: detail.kilojoules,
    calories: detail.calories,
    sufferScore: detail.suffer_score,
    hasHeartrate: Boolean(detail.has_heartrate),
    isTrainer: Boolean(detail.trainer),
    isCommute: Boolean(detail.commute),
    isManual: Boolean(detail.manual),
  };
}

// Fetches everything we store for one activity: full detail, heart-rate zones
// and all non-GPS streams. Zones/streams are optional extras — activities
// without heart-rate data or manual entries simply have none (404 → null).
async function fetchActivityBundle(connection, stravaId) {
  const detail = await apiGet(connection, `/activities/${stravaId}`, { include_all_efforts: 'true' });

  let zones = null;
  try {
    zones = await apiGet(connection, `/activities/${stravaId}/zones`);
  } catch (err) {
    if (err.status !== 404 && err.status !== 403) throw err;
  }

  let streams = null;
  try {
    streams = await apiGet(connection, `/activities/${stravaId}/streams`, {
      keys: STREAM_KEYS.join(','),
      key_by_type: 'true',
    });
    if (streams && streams.latlng) delete streams.latlng; // defensive: never store GPS
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  return { detail, zones, streams };
}

async function upsertActivity(userId, athleteId, bundle) {
  const { detail, zones, streams } = bundle;
  return StravaActivity.findOneAndUpdate(
    { userId, stravaId: detail.id },
    {
      $set: {
        athleteId,
        ...mapActivityFields(detail),
        detail,
        zones,
        streams,
        syncedAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

// Lists activity summaries after the given date (paginated until exhausted).
async function listActivitiesSince(connection, afterDate) {
  const after = Math.floor(afterDate.getTime() / 1000);
  const perPage = 50;
  const all = [];
  for (let page = 1; ; page++) {
    const batch = await apiGet(connection, '/athlete/activities', {
      after: String(after),
      page: String(page),
      per_page: String(perPage),
    });
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < perPage) break;
  }
  return all;
}

// Syncs all activities after `afterDate` for a connection (token-less or full
// document). Per-activity failures don't abort the run; the first error is
// recorded on the connection. Returns { synced, failed }.
async function syncConnectionSince(connection, afterDate) {
  const conn = connection.accessToken
    ? connection
    : await loadConnectionWithTokens(connection._id);
  if (!conn) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;
  let firstError = null;

  try {
    const summaries = await listActivitiesSince(conn, afterDate);
    for (const summary of summaries) {
      try {
        const bundle = await fetchActivityBundle(conn, summary.id);
        await upsertActivity(conn.userId, conn.athleteId, bundle);
        synced++;
      } catch (err) {
        failed++;
        if (!firstError) firstError = err.message;
        // 429 = rate limit exhausted — retrying the remaining activities in
        // this run would only burn the next window too. The next poll/webhook
        // picks them up via the overlap window.
        if (err.status === 429) break;
      }
    }
  } catch (err) {
    firstError = err.message;
    failed++;
  }

  conn.lastSyncAt = new Date();
  conn.lastSyncError = firstError;
  await conn.save();
  return { synced, failed };
}

// First sync after connecting: backfill the last 7 days.
async function runInitialSync(connection) {
  const afterDate = new Date(Date.now() - INITIAL_SYNC_DAYS * 24 * 60 * 60 * 1000);
  const result = await syncConnectionSince(connection, afterDate);
  await StravaConnection.updateOne(
    { _id: connection._id },
    { $set: { initialSyncDone: true } }
  );
  return result;
}

// Incremental sync (poller / manual): everything since the last sync, with an
// overlap window; falls back to the 7-day window if never synced.
async function syncConnection(connection) {
  const since = connection.lastSyncAt
    ? new Date(new Date(connection.lastSyncAt).getTime() - POLL_OVERLAP_MS)
    : new Date(Date.now() - INITIAL_SYNC_DAYS * 24 * 60 * 60 * 1000);
  return syncConnectionSince(connection, since);
}

// Webhook subscription management (one subscription per Strava application)

// The verify token is generated on first use and persisted via the runtime
// config so it survives restarts and validates future webhook challenges.
async function ensureVerifyToken() {
  let token = config.get('STRAVA_WEBHOOK_VERIFY_TOKEN');
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    await config.set('STRAVA_WEBHOOK_VERIFY_TOKEN', token);
  }
  return token;
}

function subscriptionCredentials() {
  return {
    client_id: config.get('STRAVA_CLIENT_ID'),
    client_secret: config.get('STRAVA_CLIENT_SECRET'),
  };
}

async function viewWebhookSubscriptions() {
  const qs = new URLSearchParams(subscriptionCredentials()).toString();
  return requestJson(`${API_BASE}/push_subscriptions?${qs}`);
}

// Strava synchronously calls GET <callback_url> with a challenge during this
// request — the webhook route must already be reachable and answer it.
async function createWebhookSubscription() {
  const callbackUrl = getWebhookCallbackUrl();
  if (!callbackUrl) {
    throw new StravaApiError('PUBLIC_BASE_URL ist nicht konfiguriert.', 400);
  }
  const verifyToken = await ensureVerifyToken();
  return requestJson(`${API_BASE}/push_subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...subscriptionCredentials(),
      callback_url: callbackUrl,
      verify_token: verifyToken,
    }),
  });
}

async function deleteWebhookSubscription(id) {
  const qs = new URLSearchParams(subscriptionCredentials()).toString();
  await requestJson(`${API_BASE}/push_subscriptions/${id}?${qs}`, { method: 'DELETE' });
}

// Processes one webhook event. Events reference athletes, not Deltis users —
// owner_id resolves the connection. Unknown athletes are ignored silently
// (e.g. events arriving after a disconnect).
async function handleWebhookEvent(event) {
  const { object_type: objectType, aspect_type: aspectType, object_id: objectId, owner_id: ownerId } = event || {};

  if (objectType === 'athlete') {
    // The only athlete event today is a deauthorization (updates.authorized:'false').
    if (String(event?.updates?.authorized) === 'false') {
      await StravaConnection.deleteOne({ athleteId: ownerId });
    }
    return;
  }

  if (objectType !== 'activity') return;

  const connection = await StravaConnection.findOne({ athleteId: ownerId })
    .select('+accessToken +refreshToken');
  if (!connection) return;

  if (aspectType === 'delete') {
    await StravaActivity.deleteOne({ userId: connection.userId, stravaId: objectId });
    return;
  }

  // create / update → (re-)fetch the full bundle
  const bundle = await fetchActivityBundle(connection, objectId);
  await upsertActivity(connection.userId, connection.athleteId, bundle);
}

module.exports = {
  OAUTH_SCOPE,
  STREAM_KEYS,
  INITIAL_SYNC_DAYS,
  StravaApiError,
  isConfigured,
  getPublicBaseUrl,
  getRedirectUri,
  getWebhookCallbackUrl,
  buildAuthorizeUrl,
  exchangeCode,
  refreshTokens,
  loadConnectionWithTokens,
  ensureFreshToken,
  apiGet,
  deauthorize,
  mapActivityFields,
  fetchActivityBundle,
  upsertActivity,
  listActivitiesSince,
  syncConnectionSince,
  runInitialSync,
  syncConnection,
  ensureVerifyToken,
  viewWebhookSubscriptions,
  createWebhookSubscription,
  deleteWebhookSubscription,
  handleWebhookEvent,
};
