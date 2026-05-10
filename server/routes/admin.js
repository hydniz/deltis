const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const User = require('../models/User');

const adminOnly = (req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Kein Zugriff' });
  next();
};

// ── Public setup routes (no auth required) ────────────────────────────────────

// Returns whether first-time setup is still pending; exposes the admin UUID only during setup
router.get('/setup-status', async (req, res) => {
  try {
    const admin = await User.findOne({ isAdmin: true }).select('+adminSecretHash');
    if (!admin) return res.json({ setupNeeded: false });
    const setupNeeded = !admin.adminSecretHash;
    res.json({ setupNeeded, adminUuid: setupNeeded ? admin.uuid : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set the admin password – only works once while no password is set
router.post('/setup', async (req, res) => {
  try {
    const admin = await User.findOne({ isAdmin: true }).select('+adminSecretHash');
    if (!admin || admin.adminSecretHash) {
      return res.status(400).json({ error: 'Setup bereits abgeschlossen' });
    }
    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen haben' });
    }
    admin.adminSecretHash = await bcrypt.hash(password, 12);
    await admin.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Change the admin password (requires current password for verification)
router.put('/password', auth, adminOnly, async (req, res) => {
  try {
    const admin = await User.findById(req.user._id).select('+adminSecretHash');
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Aktuelles und neues Passwort erforderlich' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Neues Passwort muss mindestens 8 Zeichen haben' });
    }
    const valid = await bcrypt.compare(currentPassword, admin.adminSecretHash);
    if (!valid) {
      return res.status(401).json({ error: 'Aktuelles Passwort ist falsch' });
    }
    admin.adminSecretHash = await bcrypt.hash(newPassword, 12);
    await admin.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Protected admin routes ────────────────────────────────────────────────────

// List all users
router.get('/users', auth, adminOnly, async (req, res) => {
  try {
    const users = await User.find({}, 'uuid name isAdmin createdAt').sort({ createdAt: 1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new user (UUID is auto-generated)
router.post('/users', auth, adminOnly, async (req, res) => {
  try {
    const { name } = req.body;
    const uuid = crypto.randomUUID();
    const user = await User.create({
      uuid,
      name: name?.trim() || 'Nutzer ' + uuid.slice(0, 8)
    });
    res.status(201).json({ _id: user._id, uuid: user.uuid, name: user.name, createdAt: user.createdAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a user (admin account cannot be deleted)
router.delete('/users/:id', auth, adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Nutzer nicht gefunden' });
    if (user.isAdmin) return res.status(400).json({ error: 'Admin-Konto kann nicht gelöscht werden' });
    await User.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
