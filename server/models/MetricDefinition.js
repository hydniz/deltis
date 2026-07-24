// Mongoose model: a user-defined measurement type ("Messwert").
//
// This is the generic counterpart to the single-purpose WeightLog: instead of
// one hard-coded number-per-day, a user (or a Health Connect import) can define
// ANY scalar they want to track over time — body fat, resting heart rate, sleep
// duration, blood pressure, hydration, mood, blood glucose, VO2max, … — with
// its own unit, sane bounds and aggregation rules. `MetricLog` holds the values.
//
// Versioned renames mirror HabitDefinition/ActivityType so historical logs stay
// readable after a metric is renamed.
const mongoose = require('mongoose');

const VALUE_TYPES = ['number', 'duration', 'percent', 'scale'];
// How several readings collapse: `dayAggregation` within one calendar day,
// `aggregation` across a longer period (week/month/goal interval).
const AGGREGATIONS = ['last', 'avg', 'sum', 'min', 'max'];
// Trend direction — drives colouring and the sense of a goal ("lower is better").
const DIRECTIONS = ['up', 'down', 'none'];

const nameHistorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  unit: { type: String, default: '' },
  version: { type: Number, required: true },
  validFrom: { type: Date, required: true },
  validUntil: { type: Date, required: true },
}, { _id: false });

const metricDefinitionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Stable slug — used by imports and by group pairing; never renamed.
  key: { type: String, required: true, trim: true, lowercase: true, maxlength: 40 },
  name: { type: String, required: true, trim: true, maxlength: 60 }, // German display name
  unit: { type: String, default: '', maxlength: 16 },                // free text: %, bpm, mmHg, ml …

  valueType: { type: String, enum: VALUE_TYPES, default: 'number' },
  scaleMax: { type: Number, default: 5 },   // valueType 'scale' only (e.g. mood 1..5)
  decimals: { type: Number, default: 1, min: 0, max: 3 },

  dayAggregation: { type: String, enum: AGGREGATIONS, default: 'last' },
  aggregation: { type: String, enum: AGGREGATIONS, default: 'last' },

  direction: { type: String, enum: DIRECTIONS, default: 'none' },
  min: { type: Number, default: null },     // input sanity bounds (per-metric; replaces the
  max: { type: Number, default: null },     // hard-coded 0<w<=1000 that WeightLog carried)

  // Multi-component measurements stay SCALAR per log; the UI pairs metrics that
  // share a groupKey (e.g. blood pressure systolic + diastolic on one card).
  groupKey: { type: String, default: null, maxlength: 40 },
  groupOrder: { type: Number, default: 0 },

  icon: { type: String, default: 'Activity' },  // lucide name (allow-listed client-side)
  color: { type: String, default: 'rose' },     // tone key from the design system
  showOnDashboard: { type: Boolean, default: false },
  order: { type: Number, default: 0 },

  // Import routing: which Health Connect type feeds this metric. At most one
  // metric per user may claim a given health type (unique partial index below).
  healthType: { type: String, default: null },

  // Set for built-in metrics seeded from the catalog/health types (holds the
  // template key); null for hand-created ones. Lets the UI mark them and keeps
  // idempotent seeding simple.
  builtin: { type: String, default: null },

  version: { type: Number, default: 1 },
  nameHistory: [nameHistorySchema],
  deletedAt: { type: Date, default: null },  // soft delete, like HabitDefinition
  createdAt: { type: Date, default: Date.now },
});

// One live metric per key per user.
metricDefinitionSchema.index(
  { userId: 1, key: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
// One destination per health type, so import routing is never ambiguous.
metricDefinitionSchema.index(
  { userId: 1, healthType: 1 },
  { unique: true, partialFilterExpression: { healthType: { $type: 'string' }, deletedAt: null } }
);

metricDefinitionSchema.statics.VALUE_TYPES = VALUE_TYPES;
metricDefinitionSchema.statics.AGGREGATIONS = AGGREGATIONS;
metricDefinitionSchema.statics.DIRECTIONS = DIRECTIONS;

module.exports = mongoose.model('MetricDefinition', metricDefinitionSchema);
