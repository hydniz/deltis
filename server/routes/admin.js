const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const auth = require('../middleware/auth');
const User = require('../models/User');
const pw = require('../utils/password');

const adminOnly = (req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Kein Zugriff' });
  next();
};

// ── Public setup routes (no auth required) ────────────────────────────────────

router.get('/setup-status', async (req, res) => {
  try {
    const admin = await User.findOne({ isAdmin: true }).select('+adminSecretHash +passwordHash');
    const setupNeeded = !admin || (!admin.passwordHash && !admin.adminSecretHash);
    res.json({ setupNeeded });
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

// ── Protected admin routes ────────────────────────────────────────────────────

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
