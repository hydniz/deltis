// Mongoose model: per-user Strava OAuth connection. Tokens use select:false
// and are stripped from JSON output — they never leave the server.
const mongoose = require('mongoose');

const stravaConnectionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

  // Strava athlete id — globally unique per Strava account. Unique here so one
  // Strava account can never feed two Deltis users.
  athleteId: { type: Number, required: true, unique: true },

  accessToken: { type: String, required: true, select: false },
  refreshToken: { type: String, required: true, select: false },
  // Access-token expiry (Strava tokens live ~6h and are refreshed on demand)
  expiresAt: { type: Date, required: true },
  scope: { type: String, default: '' },

  // Raw athlete profile as delivered by the token exchange (all fields kept)
  athlete: { type: mongoose.Schema.Types.Mixed, default: {} },

  // 7-day backfill after the first connect
  initialSyncDone: { type: Boolean, default: false },

  // Job-queue handoff to the strava-integration plugin (server/routes/
  // pluginHostApi.js "strava:sync" capability): core sets syncRequestedAt
  // whenever a sync should happen (new connection, webhook event, manual
  // "sync now") — the actual Strava API call happens in the plugin's own
  // poll loop, which reports back via lastSyncAt/lastSyncSyncedCount/
  // lastSyncFailedCount. A sync is "done" once lastSyncAt >= syncRequestedAt.
  syncRequestedAt: { type: Date, default: null },
  lastSyncAt: { type: Date, default: null },
  lastSyncError: { type: String, default: null },
  lastSyncSyncedCount: { type: Number, default: 0 },
  lastSyncFailedCount: { type: Number, default: 0 },

  createdAt: { type: Date, default: Date.now },
});

stravaConnectionSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.accessToken;
    delete ret.refreshToken;
    return ret;
  },
});

module.exports = mongoose.model('StravaConnection', stravaConnectionSchema);
