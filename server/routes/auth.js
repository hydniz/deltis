const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const JWT_SECRET = require('../utils/jwtSecret');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const User = require('../models/User');
const pw = require('../utils/password');

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

// ── Login ─────────────────────────────────────────────────────────────────────
// Verifies credentials once, then issues a 30-day httpOnly JWT cookie.
// Preserves all legacy auth edge cases from the old per-request flow.

router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier) return res.status(400).json({ error: 'Benutzername erforderlich.' });

    const user = await User.findOne({
      $or: [{ uuid: identifier }, { username: identifier }]
    }).select('+passwordHash +adminSecretHash');

    if (!user) return res.status(401).json({ error: 'Unbekannter Benutzername' });

    const loginViaUuid = user.uuid === identifier;

    // UUID login is permanently blocked once username is set
    if (loginViaUuid && user.username) {
      return res.status(401).json({
        error: 'Bitte melde dich mit deinem Benutzernamen an.',
        code: 'UUID_BLOCKED',
      });
    }

    if (user.passwordHash) {
      if (!password) {
        return res.status(401).json({ error: 'Passwort erforderlich', code: 'PASSWORD_REQUIRED' });
      }
      const valid = await pw.verify(password, user.passwordHash);
      if (!valid) return res.status(401).json({ error: 'Falsches Passwort' });
    } else if (user.adminSecretHash) {
      // Backward compat: admin with old bcrypt secret (no pepper)
      if (!password) {
        return res.status(401).json({ error: 'Passwort erforderlich', code: 'PASSWORD_REQUIRED' });
      }
      const valid = await bcrypt.compare(password, user.adminSecretHash);
      if (!valid) return res.status(401).json({ error: 'Falsches Passwort' });
    }
    // else: UUID-only migration mode — no credentials set yet, allow through

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie('auth_token', token, COOKIE_OPTIONS);

    const data = user.toJSON();
    data.hasPassword = !!(user.passwordHash || user.adminSecretHash);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Logout ────────────────────────────────────────────────────────────────────

router.post('/logout', (_req, res) => {
  res.clearCookie('auth_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  res.json({ ok: true });
});

// ── Protected profile routes ──────────────────────────────────────────────────

router.get('/me', auth, (req, res) => {
  const data = req.user.toJSON();
  data.hasPassword = req.user._hasPassword;
  res.json(data);
});

router.put('/me', auth, async (req, res) => {
  try {
    const { name, weightUnit } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { name, weightUnit },
      { new: true }
    );
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Initial migration setup OR username change.
// Password required when user has neither passwordHash nor adminSecretHash.
router.put('/me/username', auth, async (req, res) => {
  try {
    const { username, password } = req.body;

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
    if (existing && !existing._id.equals(req.user._id)) {
      return res.status(409).json({ error: 'Benutzername bereits vergeben.' });
    }

    const currentUser = await User.findById(req.user._id).select('+passwordHash +adminSecretHash');
    const update = { username: normalized };

    // Password required only when user has no credentials at all (first-time setup)
    const needsPassword = !currentUser.passwordHash && !currentUser.adminSecretHash;
    if (needsPassword) {
      if (!password || typeof password !== 'string') {
        return res.status(400).json({ error: 'Passwort erforderlich.' });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen lang sein.' });
      }
      update.passwordHash = await pw.hash(password);
    }

    const user = await User.findByIdAndUpdate(req.user._id, update, { new: true });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Change password for all users (admin and regular).
router.put('/me/password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Aktuelles und neues Passwort erforderlich.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Neues Passwort muss mindestens 8 Zeichen lang sein.' });
    }

    const user = await User.findById(req.user._id).select('+passwordHash +adminSecretHash');
    if (!user.passwordHash && !user.adminSecretHash) {
      return res.status(400).json({ error: 'Noch kein Passwort gesetzt. Bitte erst Benutzernamen und Passwort einrichten.' });
    }

    const valid = user.passwordHash
      ? await pw.verify(currentPassword, user.passwordHash)
      : await bcrypt.compare(currentPassword, user.adminSecretHash);
    if (!valid) return res.status(401).json({ error: 'Aktuelles Passwort ist falsch.' });

    user.passwordHash = await pw.hash(newPassword);
    user.mustChangePassword = false;
    await user.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Forced password change: allowed only when mustChangePassword is true.
router.put('/me/password/forced', auth, async (req, res) => {
  try {
    if (!req.user.mustChangePassword) {
      return res.status(400).json({ error: 'Kein erzwungener Passwortwechsel ausstehend.' });
    }
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen lang sein.' });
    }
    const user = await User.findById(req.user._id);
    user.passwordHash = await pw.hash(newPassword);
    user.mustChangePassword = false;
    await user.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
