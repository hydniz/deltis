const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  uuid: { type: String, required: true, unique: true },
  username: { type: String, unique: true, sparse: true, minlength: 3, maxlength: 30 },
  passwordHash: { type: String, select: false },
  mustChangePassword: { type: Boolean, default: false },
  name: { type: String, default: 'Nutzer' },
  isAdmin: { type: Boolean, default: false },
  adminSecretHash: { type: String, select: false },
  weightUnit: { type: String, default: 'kg' },
  selectedHabitIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'HabitDefinition' }],
  habitSettings: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now }
});

userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.adminSecretHash;
    delete ret.passwordHash;
    return ret;
  }
});

module.exports = mongoose.model('User', userSchema);
