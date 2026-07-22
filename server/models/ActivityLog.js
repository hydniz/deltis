// Mongoose model: one logged activity, with a reference to its ActivityType
// and the type version at logging time (for historical display).
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
  // Provenance: null/absent = logged manually by the user; "plugin:<id>" =
  // written by an installed plugin via the Plugin Host API (see
  // routes/pluginHostApi.js) — shown in the UI so it's always clear what a
  // plugin has touched.
  source: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});

activityLogSchema.index({ userId: 1, date: -1 });
activityLogSchema.index({ userId: 1, activityTypeRef: 1, date: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
