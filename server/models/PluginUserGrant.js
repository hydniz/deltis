// Mongoose model: one user's individual consent for an installed plugin.
// An admin installing a plugin only provisions it instance-wide — a plugin
// can act on a specific user's data only once that user has separately
// granted it, via the same "alle akzeptieren oder abbrechen" consent screen
// scoped to their own account.
const mongoose = require('mongoose');

const pluginUserGrantSchema = new mongoose.Schema({
  pluginId: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  capabilities: { type: [String], default: [] }, // snapshot of what this user consented to
  enabled: { type: Boolean, default: true },
  grantedAt: { type: Date, default: Date.now },
});

pluginUserGrantSchema.index({ pluginId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('PluginUserGrant', pluginUserGrantSchema);
