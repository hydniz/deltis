const bcrypt = require('bcryptjs');
const pw = require('../utils/password');
const User = require('../models/User');

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Nicht autorisiert' });
  }

  const token = authHeader.slice(7).trim();
  // Token format: "identifier" (UUID migration) or "identifier:secret"
  // identifier = username or uuid; secret = password (regular) or adminSecret (admin)
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

    if (user.isAdmin) {
      // Admin: authenticate via adminSecretHash
      if (!providedSecret || !user.adminSecretHash) {
        return res.status(401).json({ error: 'Admin-Secret erforderlich' });
      }
      const valid = await bcrypt.compare(providedSecret, user.adminSecretHash);
      if (!valid) {
        return res.status(401).json({ error: 'Falsches Admin-Secret' });
      }
    } else {
      if (user.passwordHash) {
        // Migration complete: password required for all logins
        if (!providedSecret) {
          return res.status(401).json({ error: 'Passwort erforderlich', code: 'PASSWORD_REQUIRED' });
        }
        const valid = await pw.verify(providedSecret, user.passwordHash);
        if (!valid) {
          return res.status(401).json({ error: 'Falsches Passwort' });
        }
      }
      // No passwordHash yet: migration mode, allow UUID login without password
    }

    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Serverfehler' });
  }
};
