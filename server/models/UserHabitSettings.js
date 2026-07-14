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
  habitSettings: { type: mongoose.Schema.Types.Mixed, default: {} },
});

module.exports = mongoose.model('UserHabitSettings', userHabitSettingsSchema);
