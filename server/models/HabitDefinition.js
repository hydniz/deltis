// Mongoose model: definition of a trackable habit (name, unit), versioned so
// old logs keep their historical name.
const mongoose = require('mongoose');

// Stores the state of a version (name + unit)
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
  // Legacy flag from the global-library era (migration 004 moved every habit
  // into user ownership); kept so old exports stay importable.
  isPredefined: { type: Boolean, default: false },
  // Soft delete: deleted habits keep their logs/plans resolvable forever and
  // land in the trash section of the manage modal, restorable at any time.
  deletedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('HabitDefinition', habitDefinitionSchema);
