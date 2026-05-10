const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  uuid: { type: String, required: true, unique: true },
  name: { type: String, default: 'Nutzer' },
  weightUnit: { type: String, default: 'kg' },
  selectedHabitIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'HabitDefinition' }],
  habitSettings: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
