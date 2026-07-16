// Strava integration endpoints (/api/strava): OAuth connect/callback, sync,
// synced activities, webhook (public) and admin subscription management.
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');
const JWT_SECRET = require('../utils/jwtSecret');
const config = require('../utils/config');
const strava = require('../services/strava');
const StravaConnection = require('../models/StravaConnection');
const StravaActivity = require('../models/StravaActivity');

const adminOnly = (req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Kein Zugriff' });
  next();
};

// Short-lived signed state for the OAuth round trip: identifies the user in
// the callback (which arrives cookie-less via Strava redirect) and prevents
// CSRF — an attacker cannot forge a valid state for a foreign account.
const STATE_PURPOSE = 'strava_oauth';

function signState(userId) {
  return jwt.sign({ purpose: STATE_PURPOSE, userId: String(userId) }, JWT_SECRET, { expiresIn: '10m' });
}

function verifyState(state) {
  const payload = jwt.verify(String(state || ''), JWT_SECRET);
  if (payload.purpose !== STATE_PURPOSE || !payload.userId) throw new Error('Ungültiger State');
  return payload.userId;
}

// Where to send the browser after the OAuth callback. Production serves the
// frontend from the same origin; development redirects to the Vite dev server.
function frontendRedirect(pathAndQuery) {
  const base = strava.getPublicBaseUrl();
  if (base) return `${base}${pathAndQuery}`;
  if (process.env.NODE_ENV !== 'production') return `http://localhost:5173${pathAndQuery}`;
  return pathAndQuery;
}

// Manual-sync throttle: one sync per user per minute, independent of the
// IP-based rate limiter (sync is expensive in Strava API quota, not in CPU).
const MANUAL_SYNC_COOLDOWN_MS = 60 * 1000;
const lastManualSync = new Map();

// User endpoints

// GET /api/strava/status — integration state for the settings page.
router.get('/status', auth, async (req, res) => {
  try {
    const configured = strava.isConfigured();
    const connection = await StravaConnection.findOne({ userId: req.user._id });
    const activityCount = connection
      ? await StravaActivity.countDocuments({ userId: req.user._id })
      : 0;

    res.json({
      configured,
      connected: Boolean(connection),
      connection: connection ? connection.toJSON() : null,
      activityCount,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/strava/connect — returns the Strava authorize URL; the client
// redirects the browser there.
router.get('/connect', auth, (req, res) => {
  if (!strava.isConfigured()) {
    return res.status(400).json({
      error: 'Strava ist nicht konfiguriert. Ein Admin muss Client-ID und Client-Secret hinterlegen.',
    });
  }
  const url = strava.buildAuthorizeUrl({
    state: signState(req.user._id),
    redirectUri: strava.getRedirectUri(req),
  });
  res.json({ url });
});

// GET /api/strava/callback — OAuth redirect target (public: the user is
// identified by the signed state, not by a cookie). Always redirects back to
// the settings page with a status query parameter.
router.get('/callback', async (req, res) => {
  const redirect = status => res.redirect(frontendRedirect(`/settings?strava=${status}`));

  if (!strava.isConfigured()) return redirect('config');

  let userId;
  try {
    userId = verifyState(req.query.state);
  } catch {
    return redirect('invalid-state');
  }

  const { code, error } = req.query;
  if (error || !code) return redirect('denied');

  // Strava reports the actually granted scopes in the redirect. Without
  // activity read access the integration is pointless — treat as denied.
  const grantedScope = String(req.query.scope || '');
  if (!grantedScope.includes('activity:read')) return redirect('scope');

  try {
    const data = await strava.exchangeCode(String(code), strava.getRedirectUri(req));
    const athleteId = data?.athlete?.id;
    if (!athleteId || !data.access_token || !data.refresh_token) return redirect('error');

    // One Strava account can only feed one Deltis user.
    const existing = await StravaConnection.findOne({ athleteId });
    if (existing && String(existing.userId) !== String(userId)) return redirect('athlete-taken');

    const connection = await StravaConnection.findOneAndUpdate(
      { userId },
      {
        $set: {
          athleteId,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: new Date(data.expires_at * 1000),
          scope: grantedScope,
          athlete: data.athlete,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).select('+accessToken +refreshToken');

    // 7-day backfill in the background — the user gets redirected immediately
    // and the settings page shows the sync state.
    if (!connection.initialSyncDone) {
      strava.runInitialSync(connection).catch(err => {
        console.error(`✗ Strava-Erstsynchronisation fehlgeschlagen: ${err.message}`);
      });
    }

    return redirect('success');
  } catch (err) {
    console.error(`✗ Strava-OAuth-Callback fehlgeschlagen: ${err.message}`);
    return redirect('error');
  }
});

// POST /api/strava/sync — manual "sync now", max. once per minute per user.
router.post('/sync', auth, async (req, res) => {
  try {
    const key = String(req.user._id);
    const last = lastManualSync.get(key) || 0;
    if (Date.now() - last < MANUAL_SYNC_COOLDOWN_MS) {
      return res.status(429).json({ error: 'Bitte warte kurz – Synchronisation ist maximal einmal pro Minute möglich.' });
    }

    const connection = await StravaConnection.findOne({ userId: req.user._id });
    if (!connection) return res.status(404).json({ error: 'Kein Strava-Konto verbunden.' });

    lastManualSync.set(key, Date.now());
    const result = await strava.syncConnection(connection);
    const fresh = await StravaConnection.findOne({ userId: req.user._id });
    res.json({ ...result, connection: fresh ? fresh.toJSON() : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/strava/connection — disconnect; ?purge=1 also removes all
// synced activities. Deauthorization at Strava is best effort.
router.delete('/connection', auth, async (req, res) => {
  try {
    const connection = await StravaConnection.findOne({ userId: req.user._id })
      .select('+accessToken +refreshToken');
    if (!connection) return res.status(404).json({ error: 'Kein Strava-Konto verbunden.' });

    try {
      await strava.deauthorize(connection);
    } catch (err) {
      // Token already revoked / Strava unreachable — the local disconnect
      // must still succeed.
      console.error(`⚠ Strava-Deautorisierung fehlgeschlagen: ${err.message}`);
    }

    await StravaConnection.deleteOne({ _id: connection._id });

    const purge = req.query.purge === '1' || req.query.purge === 'true';
    let purged = 0;
    if (purge) {
      const result = await StravaActivity.deleteMany({ userId: req.user._id });
      purged = result.deletedCount || 0;
    }

    res.json({ success: true, purged });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/strava/activities — synced activities without the heavy raw
// payloads (detail/zones/streams stay on the single-activity endpoint).
router.get('/activities', auth, async (req, res) => {
  try {
    const { startDate, endDate, sportType, limit = 50, skip = 0 } = req.query;
    const query = { userId: req.user._id };
    if (startDate || endDate) {
      query.startDate = {};
      if (startDate) query.startDate.$gte = new Date(startDate);
      if (endDate) query.startDate.$lte = new Date(endDate);
    }
    if (sportType) query.sportType = sportType;

    const [activities, total] = await Promise.all([
      StravaActivity.find(query)
        .select('-detail -zones -streams')
        .sort({ startDate: -1 })
        .limit(Math.min(+limit || 50, 200))
        .skip(+skip || 0),
      StravaActivity.countDocuments(query),
    ]);

    res.json({ activities, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/strava/activities/:id — full stored payload; streams only on
// request (they are by far the largest part).
router.get('/activities/:id', auth, async (req, res) => {
  try {
    const includeStreams = req.query.streams === '1' || req.query.streams === 'true';
    const activity = await StravaActivity.findOne({ _id: req.params.id, userId: req.user._id })
      .select(includeStreams ? '' : '-streams');
    if (!activity) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(activity);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/strava/sport-types — the user's synced sport types (criteria builder).
router.get('/sport-types', auth, async (req, res) => {
  try {
    const types = await StravaActivity.distinct('sportType', { userId: req.user._id });
    res.json(types.filter(Boolean).sort());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Webhook (public — validated via verify token / event payloads)

// Strava webhook validation. The hub.* keys contain dots, which the global
// sanitizer strips from req.query — so they are read from the original URL.
// The values are only compared and echoed, never used in a query.
router.get('/webhook', (req, res) => {
  const params = new URL(req.originalUrl, 'http://internal').searchParams;
  const mode = params.get('hub.mode');
  const verifyToken = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');

  const expected = config.get('STRAVA_WEBHOOK_VERIFY_TOKEN');
  if (mode === 'subscribe' && expected && verifyToken === expected) {
    return res.json({ 'hub.challenge': challenge });
  }
  return res.status(403).json({ error: 'Ungültiger Verify-Token' });
});

// Strava requires a 200 within 2 seconds — acknowledge immediately and
// process the event in the background.
router.post('/webhook', (req, res) => {
  res.status(200).json({ received: true });
  strava.handleWebhookEvent(req.body).catch(err => {
    console.error(`✗ Strava-Webhook-Verarbeitung fehlgeschlagen: ${err.message}`);
  });
});

// Admin endpoints

// GET /api/strava/admin/overview — integration health for the admin UI.
router.get('/admin/overview', auth, adminOnly, async (req, res) => {
  try {
    const publicBaseUrl = strava.getPublicBaseUrl();
    let callbackDomain = null;
    try {
      callbackDomain = publicBaseUrl ? new URL(publicBaseUrl).hostname : null;
    } catch { /* invalid URL configured — leave null */ }

    const [connectedUsers, activityCount] = await Promise.all([
      StravaConnection.countDocuments({}),
      StravaActivity.countDocuments({}),
    ]);

    res.json({
      configured: strava.isConfigured(),
      clientIdSet: Boolean(config.get('STRAVA_CLIENT_ID')),
      clientSecretSet: Boolean(config.get('STRAVA_CLIENT_SECRET')),
      publicBaseUrl: publicBaseUrl || null,
      // This is the value to enter as "Authorization Callback Domain" at
      // strava.com/settings/api.
      callbackDomain,
      webhookCallbackUrl: strava.getWebhookCallbackUrl() || null,
      pollIntervalMinutes: parseInt(config.get('STRAVA_POLL_INTERVAL_MINUTES'), 10) || 0,
      connectedUsers,
      activityCount,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/strava/admin/subscription — current webhook subscription(s) at Strava.
router.get('/admin/subscription', auth, adminOnly, async (req, res) => {
  if (!strava.isConfigured()) {
    return res.status(400).json({ error: 'Strava ist nicht konfiguriert.' });
  }
  try {
    const subscriptions = await strava.viewWebhookSubscriptions();
    res.json({ subscriptions: Array.isArray(subscriptions) ? subscriptions : [] });
  } catch (err) {
    res.status(err.status && err.status >= 400 && err.status < 500 ? 400 : 500)
      .json({ error: err.message });
  }
});

// POST /api/strava/admin/subscription — create the webhook subscription.
// Strava validates the callback URL synchronously during this call.
router.post('/admin/subscription', auth, adminOnly, async (req, res) => {
  if (!strava.isConfigured()) {
    return res.status(400).json({ error: 'Strava ist nicht konfiguriert.' });
  }
  try {
    const subscription = await strava.createWebhookSubscription();
    res.status(201).json({ subscription });
  } catch (err) {
    res.status(err.status && err.status >= 400 && err.status < 500 ? 400 : 500)
      .json({ error: err.message });
  }
});

// DELETE /api/strava/admin/subscription/:id — remove the webhook subscription.
router.delete('/admin/subscription/:id', auth, adminOnly, async (req, res) => {
  if (!strava.isConfigured()) {
    return res.status(400).json({ error: 'Strava ist nicht konfiguriert.' });
  }
  try {
    await strava.deleteWebhookSubscription(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status && err.status >= 400 && err.status < 500 ? 400 : 500)
      .json({ error: err.message });
  }
});

// For tests
router._resetManualSyncThrottle = () => lastManualSync.clear();

module.exports = router;
