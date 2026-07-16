const jwt = require('jsonwebtoken');
const JWT_SECRET = require('../utils/jwtSecret');
const User = require('../models/User');
const { clearCookieOptions } = require('../utils/cookieOptions');

module.exports = async (req, res, next) => {
  const token = req.cookies?.auth_token;
  if (!token) return res.status(401).json({ error: 'Nicht autorisiert' });

  // Verify signature and expiry first. Any JWT error (invalid/expired/tampered)
  // means the cookie is stale → clear it and return 401.
  let userId, sv;
  try {
    ({ userId, sv } = jwt.verify(token, JWT_SECRET));
  } catch {
    res.clearCookie('auth_token', clearCookieOptions(req));
    return res.status(401).json({ error: 'Nicht autorisiert' });
  }

  // Load the user from the database. A DB failure is a 500 — do not clear the
  // cookie, because the token itself is valid and the user should be able to
  // retry once the database recovers.
  try {
    const user = await User.findById(userId).select('+passwordHash +adminSecretHash');
    if (!user) {
      res.clearCookie('auth_token', clearCookieOptions(req));
      return res.status(401).json({ error: 'Nicht autorisiert' });
    }
    // Session versioning: a password change bumps user.sessionVersion, which
    // invalidates every token issued before it (tokens without an sv claim
    // predate the feature and count as version 0).
    if ((sv || 0) !== (user.sessionVersion || 0)) {
      res.clearCookie('auth_token', clearCookieOptions(req));
      return res.status(401).json({ error: 'Nicht autorisiert' });
    }
    req.user = user;
    req.user._hasPassword = !!(user.passwordHash || user.adminSecretHash);
    next();
  } catch {
    return res.status(500).json({ error: 'Serverfehler' });
  }
};
