// Plugin management (/api/plugins): admin-facing install/enable/uninstall of
// instance-wide plugins, plus the per-user grant/revoke a user makes before a
// plugin can touch their own data (see models/PluginInstall.js,
// models/PluginUserGrant.js and docs/plugins/MANIFEST.md).
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const config = require('../utils/config');
const serverState = require('../utils/serverState');
const pluginManifest = require('../services/pluginManifest');
const pluginCapabilities = require('../services/pluginCapabilities');
const pluginRuntime = require('../services/pluginRuntime');
const pluginCompatibility = require('../services/pluginCompatibility');
const logger = require('../utils/logger');
const PluginInstall = require('../models/PluginInstall');
const PluginUserGrant = require('../models/PluginUserGrant');

const adminOnly = (req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Kein Zugriff' });
  next();
};

const STORES = ['verified', 'community'];

function storeBaseUrl() {
  return config.get('PLUGIN_STORE_BASE_URL').replace(/\/+$/, '');
}

async function proxyStoreGet(path) {
  const res = await fetch(`${storeBaseUrl()}${path}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(body?.error || `Store antwortete mit ${res.status}`);
    err.status = res.status >= 400 && res.status < 500 ? res.status : 502;
    throw err;
  }
  return body;
}

// ── Catalog browsing (admin only — installing is an admin action) ─────────

router.get('/catalog/:store', auth, adminOnly, async (req, res) => {
  if (!STORES.includes(req.params.store)) return res.status(404).json({ error: 'Unbekannter Store' });
  try {
    const body = await proxyStoreGet(`/api/${req.params.store}/plugins`);
    res.json(body);
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

router.get('/catalog/:store/:id', auth, adminOnly, async (req, res) => {
  if (!STORES.includes(req.params.store)) return res.status(404).json({ error: 'Unbekannter Store' });
  try {
    const body = await proxyStoreGet(`/api/${req.params.store}/plugins/${encodeURIComponent(req.params.id)}`);
    res.json({ ...body, capabilityDescriptions: pluginCapabilities.describeAll(body?.manifest?.capabilities) });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// ── Instance-wide install lifecycle (admin only) ───────────────────────────

router.get('/installed', auth, adminOnly, async (req, res) => {
  try {
    const installs = await PluginInstall.find({}).sort({ createdAt: -1 });
    // Computed live against the currently running core version/Host API on
    // every call — never cached — so a warning always reflects reality even
    // if the core was updated after the plugin was installed.
    res.json(installs.map((install) => ({
      ...install.toObject(),
      compatibilityWarnings: pluginCompatibility.checkCompatibility(install.manifest),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Body: { source: 'verified'|'community', manifest, sourceRef }. The
// frontend must have already shown the admin the full capability list from
// GET /catalog/:store/:id and gotten an explicit "accept all" — this
// endpoint re-validates the manifest itself regardless (defense in depth,
// never trust a client-supplied manifest at face value).
router.post('/install', auth, adminOnly, async (req, res) => {
  const { source, manifest, sourceRef } = req.body;
  if (!STORES.includes(source)) return res.status(400).json({ error: 'Ungültige source.' });

  const { valid, errors } = pluginManifest.validateManifest(manifest);
  if (!valid) return res.status(400).json({ error: 'Ungültiges Manifest.', details: errors });

  try {
    const existing = await PluginInstall.findOne({ pluginId: manifest.id });
    if (existing) return res.status(409).json({ error: 'Plugin ist bereits installiert.' });

    const { tokenHash, containerId, containerName } = await pluginRuntime.provision({
      pluginId: manifest.id,
      manifest,
      hostApiPort: serverState.actualPort,
    });

    const install = await PluginInstall.create({
      pluginId: manifest.id,
      source,
      sourceRef: sourceRef || '',
      manifest,
      capabilities: manifest.capabilities,
      consentedAt: new Date(),
      consentedBy: req.user._id,
      status: 'running',
      containerId,
      containerName,
      tokenHash,
    });

    for (const warning of pluginCompatibility.checkCompatibility(manifest)) {
      logger.warn('plugins', `Kompatibilitätswarnung bei Installation von "${manifest.id}": ${warning}`);
    }

    res.status(201).json(install);
  } catch (err) {
    res.status(502).json({ error: `Installation fehlgeschlagen: ${err.message}` });
  }
});

router.put('/:pluginId/enabled', auth, adminOnly, async (req, res) => {
  const enabled = !!req.body?.enabled;
  try {
    const install = await PluginInstall.findOne({ pluginId: req.params.pluginId });
    if (!install) return res.status(404).json({ error: 'Nicht gefunden' });

    if (enabled && !install.enabled) await pluginRuntime.start(install.containerId);
    if (!enabled && install.enabled) await pluginRuntime.stop(install.containerId);

    install.enabled = enabled;
    install.status = enabled ? 'running' : 'stopped';
    install.updatedAt = new Date();
    await install.save();
    res.json(install);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.delete('/:pluginId', auth, adminOnly, async (req, res) => {
  try {
    const install = await PluginInstall.findOne({ pluginId: req.params.pluginId });
    if (!install) return res.status(404).json({ error: 'Nicht gefunden' });

    if (install.containerId) await pluginRuntime.remove(install.containerId);
    await PluginUserGrant.deleteMany({ pluginId: req.params.pluginId });
    await install.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── Per-user grant (any authenticated user, scoped to themselves) ──────────

// Installed + enabled plugins, with capability descriptions and whether the
// current user has already granted this plugin access to their own data.
router.get('/available', auth, async (req, res) => {
  try {
    const installs = await PluginInstall.find({ enabled: true, status: 'running' });
    const grants = await PluginUserGrant.find({ userId: req.user._id });
    const grantedIds = new Set(grants.filter(g => g.enabled).map(g => g.pluginId));

    res.json(installs.map(install => ({
      pluginId: install.pluginId,
      name: install.manifest?.name,
      description: install.manifest?.description,
      author: install.manifest?.author,
      capabilities: pluginCapabilities.describeAll(install.capabilities),
      granted: grantedIds.has(install.pluginId),
      compatibilityWarnings: pluginCompatibility.checkCompatibility(install.manifest),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:pluginId/grant', auth, async (req, res) => {
  try {
    const install = await PluginInstall.findOne({ pluginId: req.params.pluginId, enabled: true });
    if (!install) return res.status(404).json({ error: 'Plugin nicht installiert oder deaktiviert.' });

    const grant = await PluginUserGrant.findOneAndUpdate(
      { pluginId: req.params.pluginId, userId: req.user._id },
      { capabilities: install.capabilities, enabled: true, grantedAt: new Date() },
      { upsert: true, new: true }
    );
    res.status(201).json(grant);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:pluginId/grant', auth, async (req, res) => {
  try {
    await PluginUserGrant.findOneAndUpdate(
      { pluginId: req.params.pluginId, userId: req.user._id },
      { enabled: false }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
