// Root API info (GET /api/): version, release stage, commit, apiVersion and
// server state flags (setup mode, emergency mode, failed update).
const { version, stage, apiVersion: API_VERSION } = require('../../package.json');

// GIT_COMMIT is injected at image build time via --build-arg.
// Falls back to 'unknown' when running outside Docker (e.g. local dev).
const commitHash = process.env.GIT_COMMIT || (() => {
  try {
    return require('child_process')
      .execSync('git rev-parse --short HEAD', { cwd: __dirname })
      .toString().trim();
  } catch {
    return 'unknown';
  }
})();

const base = stage ? `${version}-${stage}` : version;
const displayVersion = process.env.NODE_ENV === 'production' ? base : `${base}+${commitHash}`;

const express = require('express');
const router = express.Router();

router.get('/', (_req, res) => {
  const serverState = require('../utils/serverState');
  const updateState = require('../utils/updateState');
  const { PLUGIN_HOST_API_VERSION } = require('../services/pluginCompatibility');
  const phase = updateState.read().phase || 'idle';
  res.json({
    version: displayVersion,
    apiVersion: API_VERSION,
    // Discoverable the same way apiVersion is — a plugin can check this
    // against its manifest's compatibility.minHostApiVersion before relying
    // on Plugin Host API behaviour (see docs/plugins/MANIFEST.md).
    pluginHostApiVersion: PLUGIN_HOST_API_VERSION,
    setupMode: serverState.setupMode,
    // Booleans only – details are admin-authenticated (/api/admin/update/status).
    emergencyMode: !!serverState.emergencyMode,
    updateFailed: phase === 'failed',
    port: serverState.actualPort,
  });
});

module.exports = { router, API_VERSION };
