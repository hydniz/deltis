const mongoose = require('mongoose');

const habitDefinitionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  name: { type: String, required: true },
  unitSymbol: { type: String, required: true },
  type: { type: String, enum: ['duration', 'amount', 'boolean'], default: 'amount' },
  isPredefined: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('HabitDefinition', habitDefinitionSchema);
