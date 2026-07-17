// Mongoose model: a training planned for a weekday ("Montag Zone-2-Training").
// References either a saved TrainingType or carries its own criteria map.
// Fulfilment is never stored — it is derived at read time from the synced
// activities of that day, so late syncs and deletions stay correct.
const mongoose = require('mongoose');

const trainingPlanSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Exactly one of the two defines what counts:
  trainingTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'TrainingType', default: null },
  // Ad-hoc criteria map keyed by integration (same shape as TrainingType.criteria)
  criteria: { type: mongoose.Schema.Types.Mixed, default: null },

  scheduledDate: { type: Date, required: true },
  notes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

trainingPlanSchema.index({ userId: 1, scheduledDate: 1 });

module.exports = mongoose.model('TrainingPlan', trainingPlanSchema);
