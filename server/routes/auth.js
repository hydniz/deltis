// Authentication endpoints (/api/auth): login/logout via httpOnly JWT cookie,
// current-user profile, username and password changes.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const jwt = require('jsonwebtoken');
const JWT_SECRET = require('../utils/jwtSecret');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const User = require('../models/User');
const pw = require('../utils/password');
const config = require('../utils/config');
const { authCookieOptions, clearCookieOptions } = require('../utils/cookieOptions');
const { createRateLimiter } = require('../utils/rateLimit');

// Signs a session JWT bound to the user's current sessionVersion and sets the
// httpOnly cookie. Bumping sessionVersion (password change) kills the token.
// `req` drives the cookie's Secure flag (see utils/cookieOptions).
function issueSession(req, res, user) {
  const token = jwt.sign(
    { userId: user._id, sv: user.sessionVersion || 0 },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
  res.cookie('auth_token', token, authCookieOptions(req));
}

// Abuse protection: registration is strictly limited, login gets a generous
// brute-force guard. In-memory per IP — fine for a single-instance NAS setup.
const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Zu viele Registrierungsversuche. Bitte versuche es später erneut.',
});
const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Zu viele Anmeldeversuche. Bitte versuche es später erneut.',
});

// Login
// Verifies credentials once, then issues a 30-day httpOnly JWT cookie.
// Preserves all legacy auth edge cases from the old per-request flow.

// Public: whether self-registration is currently enabled (drives the
// "Konto erstellen" link on the login page). The server re-checks the
// setting on every actual registration attempt.
router.get('/registration-status', (_req, res) => {
  res.json({ enabled: config.get('REGISTRATION_ENABLED') === 'on' });
});

// Public self-registration — only active when the admin enabled it.
// Hardened: rate limited, strict input validation, bounded password length
// (hashing cost), optional total-user cap, and no way to gain admin rights.
router.post('/register', registerLimiter, async (req, res) => {
  try {
    if (config.get('REGISTRATION_ENABLED') !== 'on') {
      return res.status(403).json({ error: 'Registrierung ist deaktiviert.' });
    }

    const userLimit = parseInt(config.get('REGISTRATION_USER_LIMIT'), 10) || 0;
    if (userLimit > 0) {
      const count = await User.countDocuments();
      if (count >= userLimit) {
        return res.status(403).json({ error: 'Registrierung derzeit nicht möglich – Nutzerlimit erreicht.' });
      }
    }

    const { username, password, name } = req.body;
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

    const existing = await User.findOne({ username: normalized });
    if (existing) {
      return res.status(409).json({ error: 'Benutzername bereits vergeben.' });
    }

    const user = await User.create({
      uuid: crypto.randomUUID(),
      username: normalized,
      passwordHash: await pw.hash(password),
      name: (typeof name === 'string' && name.trim().slice(0, 60)) || normalized,
      isAdmin: false,          // never derived from request input
      onboardingPending: true, // self-registered users get the setup wizard
    });

    issueSession(req, res, user);

    const data = user.toJSON();
    data.hasPassword = true;
    res.status(201).json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { identifier, password } = req.body;
    // Strict types: objects here would become MongoDB query operators
    // (NoSQL injection) or corrupt the bcrypt comparison.
    if (!identifier || typeof identifier !== 'string') {
      return res.status(400).json({ error: 'Benutzername erforderlich.' });
    }
    if (password != null && typeof password !== 'string') {
      return res.status(400).json({ error: 'Ungültiges Passwort-Format.' });
    }

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

    issueSession(req, res, user);

    const data = user.toJSON();
    data.hasPassword = !!(user.passwordHash || user.adminSecretHash);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Logout

router.post('/logout', (req, res) => {
  res.clearCookie('auth_token', clearCookieOptions(req));
  res.json({ ok: true });
});

// Protected profile routes

router.get('/me', auth, (req, res) => {
  const data = req.user.toJSON();
  data.hasPassword = req.user._hasPassword;
  res.json(data);
});

router.put('/me', auth, async (req, res) => {
  try {
    const { name, weightUnit, weightGoal } = req.body;
    // Whitelist + validate: only these profile fields are user-editable.
    const update = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) {
        return res.status(400).json({ error: 'Name muss 1–60 Zeichen lang sein.' });
      }
      update.name = name.trim();
    }
    if (weightUnit !== undefined) {
      if (!['kg', 'lbs'].includes(weightUnit)) {
        return res.status(400).json({ error: 'Ungültige Gewichtseinheit.' });
      }
      update.weightUnit = weightUnit;
    }
    if (req.body.checkinTimes !== undefined) {
      const times = req.body.checkinTimes;
      const valid = Array.isArray(times)
        && times.length <= 6
        && times.every(t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t));
      if (!valid) {
        return res.status(400).json({ error: 'Ungültige Check-in-Zeiten (HH:MM, max. 6).' });
      }
      update.checkinTimes = [...new Set(times)].sort();
    }
    if (weightGoal !== undefined) {
      // null clears the goal; otherwise weight is required, date optional.
      if (weightGoal === null) {
        update.weightGoal = { weight: null, date: null };
      } else {
        const w = +weightGoal.weight;
        if (!Number.isFinite(w) || w <= 0 || w > 1000) {
          return res.status(400).json({ error: 'Ungültiges Zielgewicht.' });
        }
        let d = null;
        if (weightGoal.date) {
          d = new Date(weightGoal.date);
          if (isNaN(d.getTime())) {
            return res.status(400).json({ error: 'Ungültiges Zieldatum.' });
          }
        }
        update.weightGoal = { weight: w, date: d };
      }
    }
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: update },
      { new: true }
    );
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Onboarding wizard state: persist the current step so the user resumes
// exactly where they left off, or mark the whole setup as completed.
router.put('/me/onboarding', auth, async (req, res) => {
  try {
    if (!req.user.onboardingPending) {
      return res.status(400).json({ error: 'Einrichtung ist bereits abgeschlossen.' });
    }
    const { step, completed } = req.body;
    const update = {};
    if (Number.isInteger(step) && step >= 0 && step <= 10) update.onboardingStep = step;
    if (completed === true) {
      update.onboardingPending = false;
      update.onboardedAt = new Date();
    }
    const user = await User.findByIdAndUpdate(req.user._id, update, { new: true });
    const data = user.toJSON();
    data.hasPassword = req.user._hasPassword;
    res.json(data);
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
    // Kill every other session (stolen or shared cookies included) and keep
    // only this one alive with a freshly issued token.
    user.sessionVersion = (user.sessionVersion || 0) + 1;
    await user.save();
    issueSession(req, res, user);
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
    user.sessionVersion = (user.sessionVersion || 0) + 1;
    await user.save();
    issueSession(req, res, user);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
// Test hook: rate-limiter state is per-process and would bleed between tests.
module.exports.resetRateLimits = () => {
  registerLimiter.reset();
  loginLimiter.reset();
};
