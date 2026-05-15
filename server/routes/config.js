const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const config = require('../utils/config');

const adminOnly = (req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Kein Zugriff' });
  next();
};

// ── GET /api/admin/config ─────────────────────────────────────────────────
// Returns all config definitions together with current effective values and
// their sources. Sensitive env values are never exposed – only their
// presence is indicated via `hasValue`.
router.get('/', auth, adminOnly, (req, res) => {
  const entries = Object.entries(config.DEFINITIONS).map(([key, def]) => {
    const source = config.getSource(key);
    const effective = config.get(key);

    // Never expose the raw value for 'status' keys or env-sourced values.
    // For 'password' fields the caller must decide whether to show/mask.
    let value = null;
    if (def.type !== 'status' && source !== 'env') {
      value = effective || null;
    }

    return {
      key,
      label: def.label,
      group: def.group,
      description: def.description,
      type: def.type,
      editable: def.editable,
      ...(def.restartRequired ? { restartRequired: true } : {}),
      source,
      hasValue: Boolean(effective),
      value,
    };
  });

  res.json(entries);
});

// ── PUT /api/admin/config/:key ────────────────────────────────────────────
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

// ── DELETE /api/admin/config/:key ─────────────────────────────────────────
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
