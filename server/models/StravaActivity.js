// Mongoose model: one synced Strava activity. Frequently queried fields are
// promoted to top-level columns; the complete API payloads (detail, heart-rate
// zones, streams) are kept verbatim in Mixed fields so no data is lost.
const mongoose = require('mongoose');

const stravaActivitySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  stravaId: { type: Number, required: true },
  athleteId: { type: Number },

  name: { type: String, default: '' },
  // sport_type is the modern field ("TrailRun", "GravelRide", …);
  // type is the legacy coarse field ("Run", "Ride") — both kept for criteria.
  sportType: { type: String, default: '' },
  type: { type: String, default: '' },

  startDate: { type: Date, required: true },
  startDateLocal: { type: Date },
  timezone: { type: String },

  movingTime: { type: Number, default: 0 },   // seconds
  elapsedTime: { type: Number, default: 0 },  // seconds
  distance: { type: Number, default: 0 },     // metres
  totalElevationGain: { type: Number, default: 0 }, // metres
  averageSpeed: { type: Number },             // m/s
  maxSpeed: { type: Number },                 // m/s
  averageHeartrate: { type: Number },         // bpm
  maxHeartrate: { type: Number },             // bpm
  averageCadence: { type: Number },
  averageWatts: { type: Number },
  kilojoules: { type: Number },
  calories: { type: Number },
  sufferScore: { type: Number },
  hasHeartrate: { type: Boolean, default: false },
  isTrainer: { type: Boolean, default: false },
  isCommute: { type: Boolean, default: false },
  isManual: { type: Boolean, default: false },

  // Full raw payloads from the Strava API (lossless storage)
  detail: { type: mongoose.Schema.Types.Mixed, default: {} },   // GET /activities/:id
  zones: { type: mongoose.Schema.Types.Mixed, default: null },  // GET /activities/:id/zones
  streams: { type: mongoose.Schema.Types.Mixed, default: null },// GET /activities/:id/streams (no latlng)

  syncedAt: { type: Date, default: Date.now },
});

stravaActivitySchema.index({ userId: 1, stravaId: 1 }, { unique: true });
stravaActivitySchema.index({ userId: 1, startDate: -1 });
stravaActivitySchema.index({ userId: 1, sportType: 1, startDate: -1 });

module.exports = mongoose.model('StravaActivity', stravaActivitySchema);
