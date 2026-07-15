// Mongoose model: which habits a user tracks plus per-habit preferences.
const mongoose = require('mongoose');

const userHabitSettingsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  selectedHabitIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'HabitDefinition' }],
  // Predefined habits this user "deleted". They are global documents shared
  // by all users (and re-seeded on every server start), so deletion is
  // implemented as per-user hiding — restorable at any time.
  hiddenHabitIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'HabitDefinition' }],
  // True once the user explicitly saved a selection. Distinguishes
  // "never chose anything" (→ all habits shown) from "deliberately chose
  // none" (→ empty list stays empty, e.g. after onboarding).
  hasSelection: { type: Boolean, default: false },
  habitSettings: { type: mongoose.Schema.Types.Mixed, default: {} },
});

module.exports = mongoose.model('UserHabitSettings', userHabitSettingsSchema);
