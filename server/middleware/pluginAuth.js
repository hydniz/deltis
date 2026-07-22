// Authenticates a running plugin container against the Plugin Host API:
// `Authorization: Bearer <token>` + `X-Plugin-Id` are matched against the
// installed plugin's stored token hash (the raw token is never stored —
// only its sha256, see services/pluginRuntime.js). Attaches
// `req.pluginInstall` (with its granted capabilities) for the
// capability-gating middleware in routes/pluginHostApi.js.
const crypto = require('crypto');
const PluginInstall = require('../models/PluginInstall');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = async (req, res, next) => {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!match) return res.status(401).json({ error: 'Kein Plugin-Token angegeben.' });

  const pluginId = req.headers['x-plugin-id'];
  if (!pluginId) return res.status(401).json({ error: 'Keine Plugin-ID angegeben.' });

  try {
    const install = await PluginInstall.findOne({ pluginId }).select('+tokenHash');
    if (!install || !install.enabled) {
      return res.status(401).json({ error: 'Plugin nicht installiert oder deaktiviert.' });
    }

    // Constant-time comparison so response timing can't leak how much of the
    // token matched.
    const provided = Buffer.from(hashToken(match[1]));
    const expected = Buffer.from(install.tokenHash);
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      return res.status(401).json({ error: 'Ungültiges Plugin-Token.' });
    }

    req.pluginInstall = install;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
