// Background poller: periodically syncs new Strava activities for every
// connected user. This is the fallback path for instances that are not
// publicly reachable (no webhook) — the interval comes from the runtime
// config and is re-read on every tick, so admin changes apply immediately.
const config = require('../utils/config');
const strava = require('./strava');

const CHECK_INTERVAL_MS = 60 * 1000;

let timer = null;
let lastRunAt = 0;
let running = false;

// One tick: runs a sync round when polling is enabled, credentials are
// configured and the interval has elapsed. Exported for tests.
async function tick(now = Date.now()) {
  if (running) return false;

  const minutes = parseInt(config.get('STRAVA_POLL_INTERVAL_MINUTES'), 10);
  if (!minutes || minutes <= 0) return false;
  if (!strava.isConfigured()) return false;
  if (now - lastRunAt < minutes * 60 * 1000) return false;

  running = true;
  lastRunAt = now;
  try {
    const StravaConnection = require('../models/StravaConnection');
    const connections = await StravaConnection.find({});
    for (const connection of connections) {
      try {
        await strava.syncConnection(connection);
      } catch (err) {
        // Never log tokens — err.message from the service is already clean.
        console.error(`✗ Strava-Sync fehlgeschlagen (Athlet ${connection.athleteId}): ${err.message}`);
      }
    }
    return true;
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(() => { tick().catch(() => {}); }, CHECK_INTERVAL_MS);
  timer.unref?.(); // never keep the process alive just for polling
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

// For tests
function _reset() {
  stop();
  lastRunAt = 0;
  running = false;
}

module.exports = { tick, start, stop, _reset, CHECK_INTERVAL_MS };
