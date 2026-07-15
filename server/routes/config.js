// Runtime configuration endpoints (/api/admin/config): list all settings with
// their effective values, write or remove overrides. Env always wins.
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const config = require('../utils/config');
const bootstrapConfig = require('../utils/bootstrapConfig');

const adminOnly = (req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Kein Zugriff' });
  next();
};

// GET /api/admin/config
// Returns all config definitions together with current effective values and
// their sources. What may be shown is decided per key by its `expose` policy
// (see utils/config.js) – NOT by the source. An env-provided port is just as
// harmless to display as a default one, while a secret stays hidden wherever
// it comes from; for those only `hasValue` reports presence.
router.get('/', auth, adminOnly, (req, res) => {
  const entries = Object.entries(config.DEFINITIONS).map(([key, def]) => {
    const source = config.getSource(key);
    const effective = config.get(key);
    const display = def.type === 'status'
      ? { value: null, masked: false }
      : config.getDisplayValue(key);

    return {
      key,
      label: def.label,
      group: def.group,
      description: def.description,
      type: def.type,
      editable: def.editable,
      ...(def.bootstrap ? { bootstrap: true } : {}),
      ...(def.options ? { options: def.options } : {}),
      ...(def.default ? { default: def.default } : {}),
      ...(def.restartRequired ? { restartRequired: true } : {}),
      ...(def.context ? { context: def.context } : {}),
      source,
      hasValue: Boolean(effective),
      value: display.value,
      // true → `value` is a redacted preview, never a usable edit draft.
      ...(display.masked ? { masked: true } : {}),
    };
  });

  res.json(entries);
});

// PUT /api/admin/config/bootstrap/:key
// Writes a bootstrap-file override for keys that cannot use MongoDB storage
// (chicken-and-egg problem – e.g. MONGODB_URI). These keys have
// `editable: false` in DEFINITIONS so the standard PUT route rejects them,
// but they are writable through this dedicated route.
router.put('/bootstrap/:key', auth, adminOnly, (req, res) => {
  const { key } = req.params;
  const def = config.DEFINITIONS[key];

  if (!def || !def.bootstrap) {
    return res.status(400).json({ error: 'Schlüssel unterstützt keine Bootstrap-Konfiguration.' });
  }

  const envVal = process.env[key];
  if (envVal !== undefined && envVal !== '') {
    return res.status(400).json({
      error: 'Wert ist in der Umgebungsvariable (.env) festgelegt und hat Vorrang. Bitte dort ändern.',
    });
  }

  const value = String(req.body.value ?? '').trim();
  if (!value) {
    return res.status(400).json({ error: 'Wert darf nicht leer sein.' });
  }

  bootstrapConfig.set(key, value);
  res.json({ ok: true, source: 'file', note: 'Neustart des Servers erforderlich.' });
});

// DELETE /api/admin/config/bootstrap/:key
// Removes the bootstrap-file override, falling back to env or the default.
router.delete('/bootstrap/:key', auth, adminOnly, (req, res) => {
  const { key } = req.params;
  const def = config.DEFINITIONS[key];

  if (!def || !def.bootstrap) {
    return res.status(400).json({ error: 'Schlüssel unterstützt keine Bootstrap-Konfiguration.' });
  }

  bootstrapConfig.remove(key);
  res.json({ ok: true, source: config.getSource(key) });
});

// PUT /api/admin/config/:key
// Saves a DB override for an editable key. The .env always wins at runtime.
router.put('/:key', auth, adminOnly, async (req, res) => {
  const { key } = req.params;
  const def = config.DEFINITIONS[key];

  if (!def) {
    return res.status(400).json({ error: 'Unbekannter Konfigurationsschlüssel.' });
  }
  if (!def.editable) {
    return res.status(400).json({ error: 'Dieser Wert kann nicht über die UI gesetzt werden.' });
  }

  const value = String(req.body.value ?? '').trim();
  if (!value) {
    return res.status(400).json({ error: 'Wert darf nicht leer sein.' });
  }

  await config.set(key, value);
  res.json({ ok: true, source: 'db' });
});

// DELETE /api/admin/config/:key
// Removes the DB override so the key falls back to .env or the default.
router.delete('/:key', auth, adminOnly, async (req, res) => {
  const { key } = req.params;
  const def = config.DEFINITIONS[key];

  if (!def) {
    return res.status(400).json({ error: 'Unbekannter Konfigurationsschlüssel.' });
  }
  if (!def.editable) {
    return res.status(400).json({ error: 'Dieser Wert kann nicht über die UI gesetzt werden.' });
  }

  await config.remove(key);
  res.json({ ok: true, source: config.getSource(key) });
});

module.exports = router;
