const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Activity name as string (kept for backwards compatibility and simple queries)
  activityType: { type: String, required: true },

  // Direct reference to the ActivityType document (since v2)
  activityTypeRef: { type: mongoose.Schema.Types.ObjectId, ref: 'ActivityType' },
  // ActivityType version at the time of logging (used for historical name display)
  activityTypeVersion: { type: Number },

  date: { type: Date, required: true },
  duration: { type: Number },   // minutes
  distance: { type: Number },   // kilometres
  notes: { type: String },
  customValues: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now }
});

activityLogSchema.index({ userId: 1, date: -1 });
activityLogSchema.index({ userId: 1, activityTypeRef: 1, date: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
