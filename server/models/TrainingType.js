// Mongoose model: user-defined training type ("Zone 2", "Langer Lauf", …).
// A training type bundles criteria per integration — an activity fulfils the
// type when it matches the criteria of ANY integration it came from. The
// criteria map is Mixed on purpose: adding a new integration (e.g. Garmin)
// adds a new key, no schema migration needed.
//
//   criteria: {
//     strava: { operator: 'AND', rules: [...] },   // see services/stravaCriteria.js
//     // garmin: { ... }                            // future integrations
//   }
const mongoose = require('mongoose');

const trainingTypeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true, maxlength: 60 },
  description: { type: String, default: '', maxlength: 300 },
  criteria: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
});

trainingTypeSchema.index({ userId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('TrainingType', trainingTypeSchema);
