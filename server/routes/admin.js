// Admin endpoints (/api/admin): first-time setup, bootstrap configuration and
// user management. Management routes require an admin account.
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const auth = require('../middleware/auth');
const User = require('../models/User');
const pw = require('../utils/password');
const bootstrapConfig = require('../utils/bootstrapConfig');
const serverState = require('../utils/serverState');

const adminOnly = (req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Kein Zugriff' });
  next();
};

// Public setup routes (no auth required)

router.get('/setup-status', async (req, res) => {
  // Check whether security secrets are configured (env takes priority over bootstrap file).
  const pepperConfigured = !!(
    process.env.PEPPER_FILE || process.env.PASSWORD_PEPPER ||
    bootstrapConfig.get('PEPPER_FILE') || bootstrapConfig.get('PASSWORD_PEPPER')
  );
  const jwtConfigured = !!(
    process.env.JWT_SECRET || process.env.JWT_SECRET_FILE ||
    bootstrapConfig.get('JWT_SECRET') || bootstrapConfig.get('JWT_SECRET_FILE')
  );

  if (serverState.setupMode) {
    return res.json({ setupNeeded: true, setupMode: true, pepperConfigured, jwtConfigured });
  }
  try {
    const admin = await User.findOne({ isAdmin: true }).select('+adminSecretHash +passwordHash');
    const setupNeeded = !admin || (!admin.passwordHash && !admin.adminSecretHash);
    res.json({ setupNeeded, setupMode: false, pepperConfigured, jwtConfigured });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/setup/security-config
// Saves JWT secret and/or pepper to the bootstrap file.
// Available as long as no admin password has been set (pre-admin phase), regardless
// of setup mode. This lets users configure security settings when MONGODB_URI is
// already provided via .env but JWT/pepper are not yet configured.
router.post('/setup/security-config', async (req, res) => {
  try {
    // Block once the first admin account is fully set up.
    if (!serverState.setupMode) {
      const admin = await User.findOne({ isAdmin: true }).select('+passwordHash');
      if (admin?.passwordHash) {
        return res.status(403).json({
          error: 'Setup bereits abgeschlossen. Sicherheitskonfiguration im Admin-Bereich ändern.',
        });
      }
    }

    const { jwt_secret, jwt_secret_file, pepper_file, password_pepper } = req.body;

    if (jwt_secret !== undefined) {
      const s = String(jwt_secret).trim();
      if (s) bootstrapConfig.set('JWT_SECRET', s); else bootstrapConfig.remove('JWT_SECRET');
    }
    if (jwt_secret_file !== undefined) {
      const s = String(jwt_secret_file).trim();
      if (s) bootstrapConfig.set('JWT_SECRET_FILE', s); else bootstrapConfig.remove('JWT_SECRET_FILE');
    }
    if (pepper_file !== undefined) {
      const s = String(pepper_file).trim();
      if (s) bootstrapConfig.set('PEPPER_FILE', s); else bootstrapConfig.remove('PEPPER_FILE');
    }
    if (password_pepper !== undefined) {
      const s = String(password_pepper).trim();
      if (s) bootstrapConfig.set('PASSWORD_PEPPER', s); else bootstrapConfig.remove('PASSWORD_PEPPER');
    }

    const pepperConfigured = !!(
      process.env.PEPPER_FILE || process.env.PASSWORD_PEPPER ||
      bootstrapConfig.get('PEPPER_FILE') || bootstrapConfig.get('PASSWORD_PEPPER')
    );

    res.json({ ok: true, pepperConfigured });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/setup', async (req, res) => {
  try {
    const admin = await User.findOne({ isAdmin: true }).select('+adminSecretHash +passwordHash');
    if (admin?.passwordHash || admin?.adminSecretHash) {
      return res.status(400).json({ error: 'Setup bereits abgeschlossen' });
    }
    const { username, password } = req.body;
    if (!username || username.length < 3) {
      return res.status(400).json({ error: 'Benutzername muss mindestens 3 Zeichen haben' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen haben' });
    }
    const passwordHash = await pw.hash(password);
    if (admin) {
      admin.username = username.toLowerCase();
      admin.passwordHash = passwordHash;
      await admin.save();
    } else {
      await User.create({ username: username.toLowerCase(), passwordHash, name: 'Admin', isAdmin: true });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/setup/bootstrap
// Public endpoint available only while the server is in setup mode.
// Saves bootstrap configuration (MongoDB URI, JWT secret, pepper) to
// /etc/deltis/deltis.config.json, then attempts a MongoDB reconnect.
// On success the server exits setup mode and the wizard can proceed to
// create the admin account.
router.post('/setup/bootstrap', async (req, res) => {
  if (!serverState.setupMode) {
    return res.status(403).json({
      error: 'Server nicht im Einrichtungsmodus. Konfiguration über den Admin-Bereich ändern.',
    });
  }

  const { mongodb_uri, jwt_secret, jwt_secret_file, pepper_file, password_pepper } = req.body;

  // Validate + save each field
  if (mongodb_uri !== undefined) {
    const uri = String(mongodb_uri).trim();
    if (uri && !uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
      return res.status(400).json({ error: 'Ungültige MongoDB URI. Muss mit mongodb:// oder mongodb+srv:// beginnen.' });
    }
    if (uri) bootstrapConfig.set('MONGODB_URI', uri);
    else bootstrapConfig.remove('MONGODB_URI');
  }

  if (jwt_secret !== undefined) {
    const s = String(jwt_secret).trim();
    if (s) bootstrapConfig.set('JWT_SECRET', s);
    else bootstrapConfig.remove('JWT_SECRET');
  }

  if (jwt_secret_file !== undefined) {
    const s = String(jwt_secret_file).trim();
    if (s) bootstrapConfig.set('JWT_SECRET_FILE', s);
    else bootstrapConfig.remove('JWT_SECRET_FILE');
  }

  if (pepper_file !== undefined) {
    const s = String(pepper_file).trim();
    if (s) bootstrapConfig.set('PEPPER_FILE', s);
    else bootstrapConfig.remove('PEPPER_FILE');
  }

  if (password_pepper !== undefined) {
    const s = String(password_pepper).trim();
    if (s) bootstrapConfig.set('PASSWORD_PEPPER', s);
    else bootstrapConfig.remove('PASSWORD_PEPPER');
  }

  // Attempt MongoDB reconnect
  try {
    if (serverState.reconnect) {
      await serverState.reconnect();
    }
    res.json({
      ok: true,
      setupMode: serverState.setupMode,
      note: serverState.setupMode
        ? 'Konfiguration gespeichert. MongoDB-Verbindung konnte nicht hergestellt werden.'
        : 'Konfiguration gespeichert. MongoDB verbunden.',
    });
  } catch (err) {
    res.status(502).json({
      error: `MongoDB-Verbindung fehlgeschlagen: ${err.message}`,
      note: 'Konfiguration wurde gespeichert. Überprüfe die MongoDB URI und versuche es erneut.',
    });
  }
});

// Protected admin routes

router.get('/users', auth, adminOnly, async (req, res) => {
  try {
    const users = await User.find(
      {},
      'uuid username name isAdmin mustChangePassword createdAt'
    ).sort({ createdAt: 1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new user with username + temporary password.
// Pass isAdmin: true to create an admin account.
router.post('/users', auth, adminOnly, async (req, res) => {
  try {
    const { username, password, name, isAdmin: makeAdmin } = req.body;

    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'Benutzername erforderlich.' });
    }
    const normalized = username.trim().toLowerCase();
    if (normalized.length < 3) {
      return res.status(400).json({ error: 'Benutzername muss mindestens 3 Zeichen lang sein.' });
    }
    if (normalized.length > 30) {
      return res.status(400).json({ error: 'Benutzername darf maximal 30 Zeichen lang sein.' });
    }
    if (!/^[a-z0-9_.\-]+$/.test(normalized)) {
      return res.status(400).json({ error: 'Benutzername darf nur Buchstaben, Zahlen, Punkte, Bindestriche und Unterstriche enthalten.' });
    }
    const existing = await User.findOne({ username: normalized });
    if (existing) {
      return res.status(409).json({ error: 'Benutzername bereits vergeben.' });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Temporäres Passwort muss mindestens 8 Zeichen lang sein.' });
    }

    const user = await User.create({
      uuid: crypto.randomUUID(),
      username: normalized,
      passwordHash: await pw.hash(password),
      mustChangePassword: true,
      name: name?.trim() || normalized,
      isAdmin: !!makeAdmin,
    });

    res.status(201).json({
      _id: user._id,
      username: user.username,
      name: user.name,
      isAdmin: user.isAdmin,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit a user: change username, name and/or reset password
router.put('/users/:id', auth, adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Nutzer nicht gefunden' });
    if (user.isAdmin) return res.status(400).json({ error: 'Admin-Konto kann hier nicht bearbeitet werden.' });

    const { username, password, name } = req.body;
    const update = {};

    if (username !== undefined) {
      const normalized = username.trim().toLowerCase();
      if (normalized.length < 3) {
        return res.status(400).json({ error: 'Benutzername muss mindestens 3 Zeichen lang sein.' });
      }
      if (normalized.length > 30) {
        return res.status(400).json({ error: 'Benutzername darf maximal 30 Zeichen lang sein.' });
      }
      if (!/^[a-z0-9_.\-]+$/.test(normalized)) {
        return res.status(400).json({ error: 'Benutzername darf nur Buchstaben, Zahlen, Punkte, Bindestriche und Unterstriche enthalten.' });
      }
      const existing = await User.findOne({ username: normalized });
      if (existing && !existing._id.equals(user._id)) {
        return res.status(409).json({ error: 'Benutzername bereits vergeben.' });
      }
      update.username = normalized;
    }

    if (name !== undefined) {
      update.name = name.trim() || user.name;
    }

    if (password !== undefined && password !== '') {
      if (password.length < 8) {
        return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen lang sein.' });
      }
      update.passwordHash = await pw.hash(password);
      update.mustChangePassword = true;
    }

    const updated = await User.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json({
      _id: updated._id,
      username: updated.username,
      name: updated.name,
      mustChangePassword: updated.mustChangePassword,
      createdAt: updated.createdAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', auth, adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Nutzer nicht gefunden' });
    if (user._id.equals(req.user._id)) {
      return res.status(400).json({ error: 'Du kannst dein eigenes Konto nicht löschen.' });
    }
    await User.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
