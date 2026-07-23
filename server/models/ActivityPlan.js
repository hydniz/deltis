// Mongoose model: an activity planned for a weekday in the weekly planner.
const mongoose = require('mongoose');

const activityPlanSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Activity name as string (kept for backwards compatibility)
  activityType: { type: String, required: true },

  // Direct reference to the ActivityType document (since v2)
  activityTypeRef: { type: mongoose.Schema.Types.ObjectId, ref: 'ActivityType' },
  // ActivityType version at the time of planning
  activityTypeVersion: { type: Number },

  scheduledDate: { type: Date, required: true },
  duration: { type: Number },   // planned minutes
  distance: { type: Number },   // planned kilometres
  completed: { type: Boolean, default: false },
  notes: { type: String },
  customValues: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Provenance: how this entry got into the planner ("Warum steht das hier?")
  source: { type: String, enum: ["manual", "copy-week"], default: "manual" },
  createdAt: { type: Date, default: Date.now }
});

activityPlanSchema.index({ userId: 1, scheduledDate: 1 });

module.exports = mongoose.model('ActivityPlan', activityPlanSchema);
