const bcrypt = require('bcryptjs');
const pw = require('../utils/password');
const User = require('../models/User');

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Nicht autorisiert' });
  }

  const token = authHeader.slice(7).trim();
  // Token format: "identifier" (UUID migration) or "identifier:password"
  const colonIdx = token.indexOf(':');
  const identifier = colonIdx !== -1 ? token.slice(0, colonIdx) : token;
  const providedSecret = colonIdx !== -1 ? token.slice(colonIdx + 1) : null;

  try {
    const user = await User.findOne({
      $or: [{ uuid: identifier }, { username: identifier }]
    }).select('+adminSecretHash +passwordHash');

    if (!user) {
      return res.status(401).json({ error: 'Unbekannter Benutzername' });
    }

    const loginViaUuid = user.uuid === identifier;

    // UUID login is permanently blocked once username is set (migration complete)
    if (loginViaUuid && user.username) {
      return res.status(401).json({
        error: 'Bitte melde dich mit deinem Benutzernamen an.',
        code: 'UUID_BLOCKED'
      });
    }

    if (user.passwordHash) {
      // Standard path: all users authenticate with pepper-based password
      if (!providedSecret) {
        return res.status(401).json({ error: 'Passwort erforderlich', code: 'PASSWORD_REQUIRED' });
      }
      const valid = await pw.verify(providedSecret, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: 'Falsches Passwort' });
      }
    } else if (user.adminSecretHash) {
      // Backward compat: admin with old secret (bcrypt without pepper)
      if (!providedSecret) {
        return res.status(401).json({ error: 'Passwort erforderlich', code: 'PASSWORD_REQUIRED' });
      }
      const valid = await bcrypt.compare(providedSecret, user.adminSecretHash);
      if (!valid) {
        return res.status(401).json({ error: 'Falsches Passwort' });
      }
    }
    // else: migration mode — no credentials set yet, UUID-only login allowed

    req.user = user;
    req.user._hasPassword = !!(user.passwordHash || user.adminSecretHash);
    next();
  } catch (err) {
    res.status(500).json({ error: 'Serverfehler' });
  }
};
