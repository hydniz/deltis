// Mongoose model: one exercise session read from Android Health Connect.
//
// Mirrors StravaActivity: frequently queried fields are promoted to top-level
// columns and the untouched record stays in `raw`, so nothing is lost.
//
// Heart-rate samples are stored in the SAME shape Strava uses
// (`streams.heartrate.data` / `streams.time.data`) so the heart-rate helpers in
// services/stravaCriteria.js evaluate health sessions without modification.
//
// Deduplication (see docs/HEALTH.md): a session that duplicates a Strava
// activity — or another health session — is kept but flagged `canonical:false`
// with a `superseded` marker. Only canonical records reach criteria, goals and
// the planner, so every real workout counts exactly once.
const mongoose = require('mongoose');

const healthActivitySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Health Connect `metadata.id` — stable across edits, which is what makes
  // ingestion idempotent and the backfill window safely replayable.
  healthId: { type: String, required: true },
  deviceId: { type: String, default: '' },
  // Package name of the app that WROTE the record (com.strava, com.garmin, …).
  dataOrigin: { type: String, default: '' },

  // Raw Health Connect exercise type ("EXERCISE_TYPE_RUNNING") plus the
  // normalized family used for matching and criteria.
  exerciseType: { type: String, default: '' },
  sportType: { type: String, default: '' },
  title: { type: String, default: '' },

  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  startDateLocal: { type: Date },
  timezone: { type: String },

  movingTime: { type: Number, default: 0 },   // seconds, excluding pauses
  elapsedTime: { type: Number, default: 0 },  // seconds, wall clock
  distance: { type: Number, default: 0 },     // metres
  totalElevationGain: { type: Number, default: 0 }, // metres
  averageSpeed: { type: Number },             // m/s
  maxSpeed: { type: Number },                 // m/s
  averageHeartrate: { type: Number },         // bpm
  maxHeartrate: { type: Number },             // bpm
  averageWatts: { type: Number },             // W (from PowerRecord over the session)
  maxWatts: { type: Number },                 // W
  averageCadence: { type: Number },           // rpm / steps-per-min
  steps: { type: Number },
  calories: { type: Number },                 // kcal, total
  activeCalories: { type: Number },           // kcal

  // Strava-compatible stream shape (see header).
  streams: { type: mongoose.Schema.Types.Mixed, default: null },
  raw: { type: mongoose.Schema.Types.Mixed, default: {} },

  // Dedup state. `canonical:false` records stay queryable but are invisible to
  // everything that counts, and can be promoted back if the winning source
  // disappears (e.g. the user disconnects Strava).
  canonical: { type: Boolean, default: true },
  superseded: {
    by: { type: String, default: null },      // 'strava' | 'health'
    ref: { type: String, default: null },     // id of the winning record
    reason: { type: String, default: null },  // 'overlap'
    at: { type: Date, default: null },
  },

  lastModifiedTime: { type: Date },
  syncedAt: { type: Date, default: Date.now },
});

// Idempotency key — the upsert target for every upload.
healthActivitySchema.index({ userId: 1, healthId: 1 }, { unique: true });
// Reconciliation and listing both query by user + time window.
healthActivitySchema.index({ userId: 1, startDate: -1 });
healthActivitySchema.index({ userId: 1, canonical: 1, startDate: -1 });

module.exports = mongoose.model('HealthActivity', healthActivitySchema);
