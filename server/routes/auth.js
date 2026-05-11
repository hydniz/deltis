const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const pw = require('../utils/password');

router.get('/me', auth, (req, res) => {
  res.json(req.user);
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
// For non-admin users without passwordHash: password is required.
// For admin users or users already having a passwordHash: password is optional.
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

    const currentUser = await User.findById(req.user._id).select('+passwordHash');
    const update = { username: normalized };

    if (!currentUser.isAdmin) {
      const needsPassword = !currentUser.passwordHash;
      if (needsPassword) {
        if (!password || typeof password !== 'string') {
          return res.status(400).json({ error: 'Passwort erforderlich.' });
        }
        if (password.length < 8) {
          return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen lang sein.' });
        }
        update.passwordHash = await pw.hash(password);
      }
    }

    const user = await User.findByIdAndUpdate(req.user._id, update, { new: true });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Change password for regular (non-admin) users
router.put('/me/password', auth, async (req, res) => {
  try {
    if (req.user.isAdmin) {
      return res.status(400).json({ error: 'Admins nutzen /admin/password zum Ändern des Passworts.' });
    }
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Aktuelles und neues Passwort erforderlich.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Neues Passwort muss mindestens 8 Zeichen lang sein.' });
    }

    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!user.passwordHash) {
      return res.status(400).json({ error: 'Noch kein Passwort gesetzt. Bitte erst Benutzernamen und Passwort einrichten.' });
    }

    const valid = await pw.verify(currentPassword, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Aktuelles Passwort ist falsch.' });
    }

    user.passwordHash = await pw.hash(newPassword);
    user.mustChangePassword = false;
    await user.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Forced password change: allowed only when mustChangePassword is true.
// Does not require the current password (user is already authenticated).
router.put('/me/password/forced', auth, async (req, res) => {
  try {
    if (!req.user.mustChangePassword) {
      return res.status(400).json({ error: 'Kein erzwungener Passwortwechsel ausstehend.' });
    }
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen lang sein.' });
    }
    const user = await User.findById(req.user._id).select('+adminSecretHash +passwordHash');
    // Admin accounts use adminSecretHash (no pepper); regular accounts use passwordHash (pepper)
    if (user.isAdmin) {
      const bcrypt = require('bcryptjs');
      user.adminSecretHash = await bcrypt.hash(newPassword, 12);
    } else {
      user.passwordHash = await pw.hash(newPassword);
    }
    user.mustChangePassword = false;
    await user.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
