const mongoose = require('mongoose');

const intermediateStepSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  targetValue: { type: Number, required: true },
  description: { type: String }
}, { _id: false });

// Filter applied to individual activities (only relevant when aggregation='max')
const activityFilterSchema = new mongoose.Schema({
  fieldKey: { type: String, required: true },
  fieldType: { type: String, enum: ['select', 'number'], default: 'select' },
  // select/multiselect:
  operator: { type: String, enum: ['anyOf', 'allOf'], default: 'anyOf' },
  values: [{ type: String }],
  // number (duration, distance, custom number):
  numOperator: { type: String, enum: ['min', 'max', 'exact'], default: 'min' },
  numValue: { type: Number }
}, { _id: false });

const conditionSchema = new mongoose.Schema({
  metric: { type: String },
  condition: { type: String, enum: ['min', 'max', 'exact'] },
  targetValue: { type: Number },
  unitSymbol: { type: String },
  valueScope: { type: String, enum: ['total', 'perActivity'], default: 'total' },
  aggregation: { type: String, enum: ['sum', 'max'], default: 'sum' },
  // Only when aggregation='max': the activity must satisfy these filters to count towards the best effort
  activityFilters: [activityFilterSchema]
}, { _id: false });

const goalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  name: { type: String, required: true },
  description: { type: String },

  type: {
    type: String,
    // periodic-* = freely configurable interval
    // weekly-*   = legacy, treated as periodic with intervalValue=1, intervalUnit='week'
    enum: ['periodic-activity', 'periodic-habit', 'weekly-activity', 'weekly-habit', 'long-term-activity', 'long-term-habit'],
    required: true
  },

  // Interval for periodic goals (ignored for long-term goals)
  intervalValue: { type: Number, default: 1, min: 1 },
  intervalUnit: { type: String, enum: ['day', 'week', 'month'], default: 'week' },

  // Polymorphic reference to either ActivityType or HabitDefinition.
  // New entries store the ObjectId of the referenced document.
  // Legacy entries store a string label (activity) or ObjectId string (habit).
  targetRef: { type: mongoose.Schema.Types.Mixed, required: true },

  // Determines which model targetRef points to.
  // Current values: 'ActivityType' | 'HabitDefinition'
  // Legacy values: 'activity' | 'habit' (still supported)
  targetRefModel: {
    type: String,
    enum: ['ActivityType', 'HabitDefinition', 'activity', 'habit'],
    required: true
  },

  // Legacy single-condition fields (backward compat)
  condition: { type: String, enum: ['min', 'max', 'exact'], required: true },
  targetValue: { type: Number, required: true },
  unitSymbol: { type: String },

  // How the value is measured (legacy single-metric, also used as fallback)
  // 'count'    – number of entries (default for activities)
  // 'distance' – sum of distance in km (activity goals only)
  // 'duration' – sum of duration in minutes (activity goals only)
  // 'value'    – sum of logged values (default for habits)
  // 'custom_fieldKey' – sum of a custom field (no enum, allows arbitrary keys)
  metric: { type: String },

  // Multi-condition support
  conditionOperator: { type: String, enum: ['AND', 'OR'], default: 'AND' },
  conditions: [conditionSchema],

  // Long-term goals only
  startDate: { type: Date },
  endDate: { type: Date },
  startValue: { type: Number },
  intermediateSteps: [intermediateStepSchema],

  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

goalSchema.index({ userId: 1, isActive: 1 });

module.exports = mongoose.model('Goal', goalSchema);
