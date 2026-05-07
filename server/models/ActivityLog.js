const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  activityType: { type: String, required: true },
  date: { type: Date, required: true },
  duration: { type: Number },
  distance: { type: Number },
  notes: { type: String },
  customValues: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now }
});

activityLogSchema.index({ userId: 1, date: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
