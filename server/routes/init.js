// First-installation endpoints (/api/init): drive the /init setup wizard.
// GET  /api/init/status – is the wizard needed + which settings are configurable
// POST /api/init        – create the admin account and apply the initial
//                         settings in one call, then log the admin in.
//
// Both endpoints are public but only useful until the first admin account
// with credentials exists; afterwards they reveal nothing and reject writes.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const jwt = require('jsonwebtoken');
const JWT_SECRET = require('../utils/jwtSecret');
const User = require('../models/User');
const pw = require('../utils/password');
const config = require('../utils/config');
const bootstrapConfig = require('../utils/bootstrapConfig');
const serverState = require('../utils/serverState');

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

// First installation = no admin account with credentials exists yet.
// Same semantics as /api/admin/setup-status.
async function initNeeded() {
  const admin = await User.findOne({ isAdmin: true }).select('+adminSecretHash +passwordHash');
  return !admin || (!admin.passwordHash && !admin.adminSecretHash);
}

function securityStatus() {
  const pepperConfigured = !!(
    process.env.PEPPER_FILE || process.env.PASSWORD_PEPPER ||
    bootstrapConfig.get('PEPPER_FILE') || bootstrapConfig.get('PASSWORD_PEPPER')
  );
  const jwtConfigured = !!(
    process.env.JWT_SECRET || process.env.JWT_SECRET_FILE ||
    bootstrapConfig.get('JWT_SECRET') || bootstrapConfig.get('JWT_SECRET_FILE')
  );
  return { pepperConfigured, jwtConfigured };
}

// A setting is locked for the wizard when it cannot be written through the
// standard config route: either it is system-managed (editable: false) or a
// .env value overrides everything ("env" source always wins at runtime).
function isLocked(key, def) {
  if (!def.editable) return true;
  return config.getSource(key) === 'env';
}

// Settings the wizard offers: every non-bootstrap definition. Bootstrap keys
// (MongoDB URI, JWT secret, pepper) have dedicated wizard steps backed by the
// existing /api/admin/setup/* endpoints, so they are excluded here.
function wizardSettings() {
  return Object.entries(config.DEFINITIONS)
    .filter(([, def]) => !def.bootstrap)
    .map(([key, def]) => {
      const source = config.getSource(key);
      const locked = isLocked(key, def);

      // This endpoint is public (pre-admin): honour the per-key expose policy
      // and additionally hide env-sourced values – only their presence shows.
      let value = null;
      if (source !== 'env') {
        const display = config.getDisplayValue(key);
        if (!display.masked) value = display.value;
      }

      return {
        key,
        label: def.label,
        group: def.group,
        description: def.description,
        type: def.type,
        ...(def.options ? { options: def.options } : {}),
        ...(def.default ? { default: def.default } : {}),
        ...(def.restartRequired ? { restartRequired: true } : {}),
        ...(def.context ? { context: def.context } : {}),
        locked,
        ...(locked ? { lockedReason: def.editable ? 'env' : 'system' } : {}),
        value,
      };
    });
}

// GET /api/init/status
// Public. Reports whether the first-installation wizard is needed and, only
// while it is, the list of configurable settings with their lock state.
router.get('/status', async (_req, res) => {
  try {
    const security = securityStatus();

    // Setup mode = MongoDB not reachable yet → the wizard is needed by
    // definition, but the DB cannot be queried.
    if (serverState.setupMode) {
      return res.json({ initNeeded: true, setupMode: true, ...security, settings: wizardSettings() });
    }

    const needed = await initNeeded();
    if (!needed) return res.json({ initNeeded: false, setupMode: false });

    res.json({ initNeeded: true, setupMode: false, ...security, settings: wizardSettings() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/init
// Public while no credentialed admin exists. Creates the admin account,
// applies the submitted settings (locked keys are skipped, never applied)
// and logs the new admin in via the httpOnly JWT cookie.
router.post('/', async (req, res) => {
  try {
    if (serverState.setupMode) {
      return res.status(503).json({
        error: 'Server im Einrichtungsmodus. Bitte zuerst die MongoDB-Verbindung konfigurieren.',
        setupMode: true,
      });
    }

    if (!(await initNeeded())) {
      return res.status(403).json({ error: 'Initialisierung bereits abgeschlossen.' });
    }

    const { username, password, name, settings } = req.body;

    // Admin account validation (same rules as the other account routes)
    const normalized = String(username || '').trim().toLowerCase();
    if (normalized.length < 3 || normalized.length > 30) {
      return res.status(400).json({ error: 'Benutzername muss 3–30 Zeichen lang sein.' });
    }
    if (!/^[a-z0-9_.\-]+$/.test(normalized)) {
      return res.status(400).json({ error: 'Benutzername darf nur Buchstaben, Zahlen, Punkte, Bindestriche und Unterstriche enthalten.' });
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen lang sein.' });
    }
    if (password.length > 128) {
      return res.status(400).json({ error: 'Passwort darf höchstens 128 Zeichen lang sein.' });
    }

    // Settings validation – reject unknown keys and invalid values up front,
    // so either everything is applied or nothing is.
    const toApply = [];
    const skipped = [];
    if (settings !== undefined && (typeof settings !== 'object' || Array.isArray(settings) || settings === null)) {
      return res.status(400).json({ error: 'Einstellungen müssen als Objekt übergeben werden.' });
    }
    for (const [key, raw] of Object.entries(settings || {})) {
      const def = config.DEFINITIONS[key];
      if (!def || def.bootstrap) {
        return res.status(400).json({ error: `Unbekannter Konfigurationsschlüssel: ${key}` });
      }
      if (isLocked(key, def)) {
        skipped.push(key); // locked values are silently kept, never overwritten
        continue;
      }
      const value = String(raw ?? '').trim();
      if (!value) continue; // empty = keep default
      if (def.options && !def.options.includes(value)) {
        return res.status(400).json({ error: `Ungültiger Wert für ${def.label}.` });
      }
      if (def.type === 'number' && !/^\d+$/.test(value)) {
        return res.status(400).json({ error: `${def.label} muss eine Zahl sein.` });
      }
      toApply.push({ key, value, restartRequired: !!def.restartRequired });
    }

    const existing = await User.findOne({ username: normalized });
    if (existing) {
      return res.status(409).json({ error: 'Benutzername bereits vergeben.' });
    }

    for (const { key, value } of toApply) {
      await config.set(key, value);
    }

    // Upgrade a credential-less admin left over from a UUID migration, or
    // create a fresh admin account.
    const displayName = (typeof name === 'string' && name.trim().slice(0, 60)) || 'Admin';
    let admin = await User.findOne({ isAdmin: true });
    if (admin) {
      admin.username = normalized;
      admin.passwordHash = await pw.hash(password);
      admin.name = displayName;
      await admin.save();
    } else {
      admin = await User.create({
        uuid: crypto.randomUUID(),
        username: normalized,
        passwordHash: await pw.hash(password),
        name: displayName,
        isAdmin: true,
        onboardingPending: true, // first login continues with the habit wizard
      });
    }

    const token = jwt.sign({ userId: admin._id }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie('auth_token', token, COOKIE_OPTIONS);

    const data = admin.toJSON();
    data.hasPassword = true;
    res.status(201).json({
      ok: true,
      user: data,
      applied: toApply.map(s => s.key),
      skipped,
      restartRequired: toApply.some(s => s.restartRequired),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
