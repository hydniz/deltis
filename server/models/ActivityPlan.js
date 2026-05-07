const mongoose = require('mongoose');

const activityPlanSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  activityType: { type: String, required: true },
  scheduledDate: { type: Date, required: true },
  duration: { type: Number },
  distance: { type: Number },
  completed: { type: Boolean, default: false },
  notes: { type: String },
  createdAt: { type: Date, default: Date.now }
});

activityPlanSchema.index({ userId: 1, scheduledDate: 1 });

module.exports = mongoose.model('ActivityPlan', activityPlanSchema);
