// Mongoose model: one reading of a MetricDefinition.
//
// Unlike WeightLog/HabitLog, `date` is a real INSTANT, never snapped to
// midnight — so morning/evening weigh-ins, two blood-pressure readings a day or
// hourly glucose all coexist. Collapsing to one value per day is a read-time
// concern driven by the definition's `dayAggregation`, which is strictly more
// general and costs nothing here.
const mongoose = require('mongoose');

const metricLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  metricId: { type: mongoose.Schema.Types.ObjectId, ref: 'MetricDefinition', required: true },
  metricVersion: { type: Number },              // like HabitLog.habitVersion

  date: { type: Date, required: true },
  value: { type: Number, required: true },
  note: { type: String, default: '', maxlength: 200 },

  source: { type: String, default: 'manual' },  // 'manual' | 'health' | 'import'
  sourceId: { type: String, default: null },     // Health Connect record id for imports
  createdAt: { type: Date, default: Date.now },
});

metricLogSchema.index({ userId: 1, metricId: 1, date: -1 });
// Idempotency for imported readings: re-uploading the same Health Connect record
// updates it instead of inserting a copy. Partial (not sparse) so manual rows —
// which carry sourceId:null — are never indexed and can repeat freely; scoped by
// metricId as well so two metrics can never collide on one source id.
metricLogSchema.index(
  { userId: 1, metricId: 1, source: 1, sourceId: 1 },
  { unique: true, partialFilterExpression: { sourceId: { $type: 'string' } } }
);

module.exports = mongoose.model('MetricLog', metricLogSchema);
