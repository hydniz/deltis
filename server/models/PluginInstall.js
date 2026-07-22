// Mongoose model: one plugin installed on this instance (admin-provisioned,
// instance-wide). Installing a plugin does NOT by itself expose any user's
// personal data — each user must separately grant it via PluginUserGrant,
// mirroring how each user connects their own Strava account today.
//
// The manifest is snapshotted at install time (not re-fetched live) so a
// running plugin's granted capabilities never silently drift — any manifest
// change on update requires a fresh admin consent (see routes/plugins.js).
const mongoose = require('mongoose');

const pluginInstallSchema = new mongoose.Schema({
  pluginId: { type: String, required: true }, // manifest.id
  source: { type: String, enum: ['verified', 'community'], required: true },
  sourceRef: { type: String, default: '' }, // store version id (verified) or "owner/repo@tag" (community)
  manifest: { type: mongoose.Schema.Types.Mixed, required: true },
  capabilities: { type: [String], default: [] }, // snapshot of manifest.capabilities at consent time
  consentedAt: { type: Date, required: true },
  consentedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['installing', 'running', 'stopped', 'error'], default: 'installing' },
  statusMessage: { type: String, default: '' },
  containerId: { type: String, default: null },
  containerName: { type: String, default: null },
  // sha256 of the Plugin Host API bearer token — the raw token is shown to
  // the container exactly once (as an env var at creation) and never stored.
  tokenHash: { type: String, required: true, select: false },
  enabled: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

pluginInstallSchema.index({ pluginId: 1 }, { unique: true });

module.exports = mongoose.model('PluginInstall', pluginInstallSchema);
