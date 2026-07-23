// Mongoose model: one user's Health Connect link (one Android device).
// Holds what the user consented to read, how far back to read it and the
// bookkeeping the companion app needs to sync incrementally.
const mongoose = require('mongoose');

// Health Connect record types Deltis can consume. The user picks a subset —
// nothing is read without an explicit opt-in.
//
// Every entry here MUST have somewhere to go. Advertising a type the sync
// endpoint silently drops would be worse than not offering it: the app would
// ask the user for a permission, report success, and discard the data.
//
//   exercise       ExerciseSessionRecord  → HealthActivity (a stored session)
//   weight         WeightRecord           → WeightLog (merged, see docs/HEALTH.md)
//   heartRate      HeartRateRecord        → HR samples ON a session, which is
//                                           what the heart-rate criteria need
//   steps          StepsRecord            ┐ aggregated ONTO a session; there is
//   activeCalories ActiveCaloriesBurned…  ├ no standalone daily series yet, so
//   distance       DistanceRecord         ┘ these only enrich `exercise`
//
// Standalone daily series (sleep, resting HR, body fat, water, …) need a
// generic user-defined measurement model, which Deltis does not have yet —
// so `sleep` is deliberately NOT offered rather than accepted and dropped.
const SUPPORTED_TYPES = [
  'exercise',
  'weight',
  'heartRate',
  'steps',
  'activeCalories',
  'distance',
];

// Types that only make sense together with exercise sessions — the UI shows
// them as enrichments rather than as independent sources.
const SESSION_ONLY_TYPES = ['heartRate', 'steps', 'activeCalories', 'distance'];

// Never read data written by an app Deltis already ingests server-side —
// that is duplicate prevention layer 1 (see docs/HEALTH.md).
const DEFAULT_EXCLUDED_ORIGINS = ['com.strava'];

// Below a week the habit/planner automation has too little history to be
// useful, so the user-chosen window is clamped here.
const MIN_BACKFILL_DAYS = 7;
const MAX_BACKFILL_DAYS = 365;
const DEFAULT_BACKFILL_DAYS = 30;

const healthConnectionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

  deviceId: { type: String, required: true },   // stable per install
  deviceName: { type: String, default: '' },    // "Pixel 8" — shown in settings
  platform: { type: String, default: 'android' },
  appVersion: { type: String, default: '' },

  // Opt-in subset of SUPPORTED_TYPES.
  enabledTypes: { type: [String], default: ['exercise', 'weight'] },

  // How far back to read on (re-)connect. Clamped to [MIN, MAX] on write.
  backfillDays: { type: Number, default: DEFAULT_BACKFILL_DAYS },

  // Package names whose records the app must skip.
  excludedOrigins: { type: [String], default: () => [...DEFAULT_EXCLUDED_ORIGINS] },

  lastSyncAt: { type: Date, default: null },
  lastSyncCounts: { type: mongoose.Schema.Types.Mixed, default: {} },

  createdAt: { type: Date, default: Date.now },
});

// Keeps the stored window inside the supported range regardless of caller.
healthConnectionSchema.statics.clampBackfillDays = function (value) {
  const days = Math.round(Number(value));
  if (!Number.isFinite(days)) return DEFAULT_BACKFILL_DAYS;
  return Math.min(Math.max(days, MIN_BACKFILL_DAYS), MAX_BACKFILL_DAYS);
};

healthConnectionSchema.statics.SUPPORTED_TYPES = SUPPORTED_TYPES;
healthConnectionSchema.statics.SESSION_ONLY_TYPES = SESSION_ONLY_TYPES;
healthConnectionSchema.statics.MIN_BACKFILL_DAYS = MIN_BACKFILL_DAYS;
healthConnectionSchema.statics.MAX_BACKFILL_DAYS = MAX_BACKFILL_DAYS;
healthConnectionSchema.statics.DEFAULT_BACKFILL_DAYS = DEFAULT_BACKFILL_DAYS;
healthConnectionSchema.statics.DEFAULT_EXCLUDED_ORIGINS = DEFAULT_EXCLUDED_ORIGINS;

module.exports = mongoose.model('HealthConnection', healthConnectionSchema);
