// Mongoose model: user account with credentials, admin flag and preferences.
// passwordHash/adminSecretHash use select:false and never leave the server.
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  uuid: { type: String, unique: true, sparse: true },
  username: { type: String, unique: true, sparse: true, minlength: 3, maxlength: 30 },
  passwordHash: { type: String, select: false },
  mustChangePassword: { type: Boolean, default: false },
  name: { type: String, default: 'Nutzer' },
  isAdmin: { type: Boolean, default: false },
  adminSecretHash: { type: String, select: false },
  weightUnit: { type: String, default: 'kg' },
  // Optional weight goal: target value + date, shown on the weight page
  // (reference line + remaining delta). Null = no goal set.
  weightGoal: {
    weight: { type: Number, default: null },
    date: { type: Date, default: null },
  },
  // Incremented on every password change/reset. The JWT carries the value it
  // was issued with (`sv` claim); a mismatch invalidates the session, so a
  // stolen cookie dies the moment the password is changed.
  sessionVersion: { type: Number, default: 0 },
  // First-login setup wizard. Only users created after this feature get
  // `onboardingPending: true`; existing accounts (field absent → false)
  // never see the wizard. `onboardingStep` lets the client resume exactly
  // where the user left off; `onboardedAt` marks completion.
  onboardingPending: { type: Boolean, default: false },
  onboardingStep: { type: Number, default: 0 },
  onboardedAt: { type: Date, default: null },
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
