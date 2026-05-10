const mongoose = require('mongoose');

// Speichert den Zustand einer Version (Name + Einheit)
const nameHistorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  unitSymbol: { type: String },
  version: { type: Number, required: true },
  validFrom: { type: Date, required: true },
  validUntil: { type: Date, required: true },
}, { _id: false });

const habitDefinitionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  name: { type: String, required: true },
  version: { type: Number, default: 1 },
  nameHistory: [nameHistorySchema],
  unitSymbol: { type: String, required: true },
  type: { type: String, enum: ['duration', 'amount', 'boolean'], default: 'amount' },
  isPredefined: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('HabitDefinition', habitDefinitionSchema);
