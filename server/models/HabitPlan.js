// Mongoose model: a habit planned for a weekday in the weekly planner.
const mongoose = require('mongoose');

const habitPlanSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  habitId: { type: mongoose.Schema.Types.ObjectId, ref: 'HabitDefinition', required: true },
  // Snapshots of habit metadata at planning time
  habitName: { type: String },
  unitSymbol: { type: String },
  habitType: { type: String },
  scheduledDate: { type: Date, required: true },
  completed: { type: Boolean, default: false },
  loggedValue: { type: Number },
  notes: { type: String },
  // Provenance: how this entry got into the planner ("Warum steht das hier?")
  // "plugin" = written by an installed plugin via the Plugin Host API.
  source: { type: String, enum: ["manual", "copy-week", "plugin"], default: "manual" },
  createdAt: { type: Date, default: Date.now }
});

habitPlanSchema.index({ userId: 1, scheduledDate: 1 });

module.exports = mongoose.model('HabitPlan', habitPlanSchema);
