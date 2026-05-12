const mongoose = require('mongoose');

const customFieldSchema = new mongoose.Schema({
  key: { type: String, required: true },
  label: { type: String, required: true },
  type: { type: String, enum: ['number', 'select', 'multiselect'], default: 'number' },
  unit: { type: String },
  options: [{ type: String }],
  showInPreview: { type: Boolean, default: true },
}, { _id: false });

// Stores the complete state of a version (name + field definitions)
const nameHistorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  customFields: { type: mongoose.Schema.Types.Mixed, default: [] },
  version: { type: Number, required: true },
  validFrom: { type: Date, required: true },
  validUntil: { type: Date, required: true },
}, { _id: false });

const activityTypeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  label: { type: String, required: true },
  version: { type: Number, default: 1 },
  nameHistory: [nameHistorySchema],
  showDistance: { type: Boolean, default: false },
  showDuration: { type: Boolean, default: true },
  customFields: [customFieldSchema],
  createdAt: { type: Date, default: Date.now }
});

activityTypeSchema.index({ userId: 1 });

module.exports = mongoose.model('ActivityType', activityTypeSchema);
