const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  uuid: { type: String, required: true, unique: true },
  name: { type: String, default: 'Nutzer' },
  isAdmin: { type: Boolean, default: false },
  adminSecretHash: { type: String, select: false },
  weightUnit: { type: String, default: 'kg' },
  selectedHabitIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'HabitDefinition' }],
  habitSettings: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now }
});

// Never include adminSecretHash in API responses
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.adminSecretHash;
    return ret;
  }
});

module.exports = mongoose.model('User', userSchema);
