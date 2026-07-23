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

  lastSyncAt: { type: Date, default: null },
  lastSyncError: { type: String, default: null },

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
