// Mongoose model: one habit measurement per user, habit and day.
const mongoose = require('mongoose');

const habitLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  habitId: { type: mongoose.Schema.Types.ObjectId, ref: 'HabitDefinition', required: true },
  // HabitDefinition version at the time of logging
  habitVersion: { type: Number },
  date: { type: Date, required: true },
  value: { type: Number, required: true },
  // 'manual' = typed by the user (always wins), 'auto' = materialized from a
  // bound metric or matching activities (see services/autoFillHabits.js).
  source: { type: String, default: 'manual' },
  createdAt: { type: Date, default: Date.now }
});

habitLogSchema.index({ userId: 1, habitId: 1, date: -1 });

module.exports = mongoose.model('HabitLog', habitLogSchema);
