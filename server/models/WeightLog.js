// Mongoose model: one weight measurement per user and day.
const mongoose = require('mongoose');

const weightLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: Date, required: true },
  weight: { type: Number, required: true },
  unit: { type: String, default: 'kg' },
  // Where the measurement came from. A manual entry always wins for its day —
  // an imported reading never overwrites what the user typed (docs/HEALTH.md).
  source: { type: String, default: 'manual' },  // 'manual' | 'health'
  // Health Connect `metadata.id` for imported rows; null for manual ones.
  sourceId: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});

weightLogSchema.index({ userId: 1, date: -1 });
// Idempotency for imported measurements: re-uploading the same record updates
// it instead of inserting a copy. PARTIAL rather than sparse on purpose — a
// compound sparse index would still index manual rows (sourceId: null) and
// reject the user's second hand-typed entry.
weightLogSchema.index(
  { userId: 1, source: 1, sourceId: 1 },
  { unique: true, partialFilterExpression: { sourceId: { $type: 'string' } } }
);

module.exports = mongoose.model('WeightLog', weightLogSchema);
