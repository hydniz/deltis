const mongoose = require('mongoose');

const customFieldSchema = new mongoose.Schema({
  key: { type: String, required: true },
  label: { type: String, required: true },
  type: { type: String, enum: ['number', 'select'], default: 'number' },
  unit: { type: String },
  options: [{ type: String }],
}, { _id: false });

const activityTypeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  label: { type: String, required: true },
  showDistance: { type: Boolean, default: false },
  showDuration: { type: Boolean, default: true },
  customFields: [customFieldSchema],
  createdAt: { type: Date, default: Date.now }
});

activityTypeSchema.index({ userId: 1 });

module.exports = mongoose.model('ActivityType', activityTypeSchema);
