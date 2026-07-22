// Strava OAuth lifecycle + webhook-subscription management. The actual
// activity sync (calling Strava's activities/zones/streams API on a loop)
// no longer happens here — it moved to the deltis-strava-integration plugin,
// which talks to Strava directly and reports back through the Plugin Host
// API's "strava:sync" capability (server/routes/pluginHostApi.js). This file
// keeps only what's genuinely tied to this server's fixed, publicly
// registered domain: the OAuth connect/callback round trip and the webhook
// subscription's registration/verification (Strava calls back to a URL that
// must exist here, not inside an isolated plugin container).
//
// Credentials come from the runtime config (env → admin UI override):
// STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET. Tokens are never logged.
const crypto = require('crypto');
const config = require('../utils/config');

const OAUTH_BASE = 'https://www.strava.com/oauth';
const API_BASE = 'https://www.strava.com/api/v3';

// Scope: read = public profile, activity:read_all = all activities incl.
// private ones (needed for a complete sync).
const OAUTH_SCOPE = 'read,activity:read_all';

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
  const StravaConnection = require('../models/StravaConnection');
  return StravaConnection.findById(connectionId).select('+accessToken +refreshToken');
}

// Refresh margin: renew the access token when it expires within this window.
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

// Returns a valid access token for the connection, refreshing and persisting
// new tokens when the current one is (nearly) expired. Used both by
// deauthorize() below and by the Plugin Host API's strava:sync token-serving
// route (routes/pluginHostApi.js) — the plugin itself never sees a refresh
// token, only short-lived access tokens minted here on demand.
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

async function deauthorize(connection) {
  const token = await ensureFreshToken(connection);
  await requestJson(`${OAUTH_BASE}/deauthorize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
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
// (e.g. events arriving after a disconnect). Delete/deauth are handled
// immediately (no Strava API call needed); create/update just flags the
// connection for the plugin's next poll tick to pick up — the actual
// re-fetch from Strava happens there, not here.
async function handleWebhookEvent(event) {
  const StravaConnection = require('../models/StravaConnection');
  const StravaActivity = require('../models/StravaActivity');
  const { object_type: objectType, aspect_type: aspectType, object_id: objectId, owner_id: ownerId } = event || {};

  if (objectType === 'athlete') {
    // The only athlete event today is a deauthorization (updates.authorized:'false').
    if (String(event?.updates?.authorized) === 'false') {
      await StravaConnection.deleteOne({ athleteId: ownerId });
    }
    return;
  }

  if (objectType !== 'activity') return;

  const connection = await StravaConnection.findOne({ athleteId: ownerId });
  if (!connection) return;

  if (aspectType === 'delete') {
    await StravaActivity.deleteOne({ userId: connection.userId, stravaId: objectId });
    return;
  }

  // create / update → request a sync; the plugin fetches the fresh activity.
  connection.syncRequestedAt = new Date();
  await connection.save();
}

module.exports = {
  OAUTH_SCOPE,
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
  deauthorize,
  ensureVerifyToken,
  viewWebhookSubscriptions,
  createWebhookSubscription,
  deleteWebhookSubscription,
  handleWebhookEvent,
};
