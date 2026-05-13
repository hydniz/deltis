const jwt = require('jsonwebtoken');
const JWT_SECRET = require('../utils/jwtSecret');
const User = require('../models/User');

module.exports = async (req, res, next) => {
  const token = req.cookies?.auth_token;
  if (!token) return res.status(401).json({ error: 'Nicht autorisiert' });

  try {
    const { userId } = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(userId).select('+passwordHash +adminSecretHash');
    if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });
    req.user = user;
    req.user._hasPassword = !!(user.passwordHash || user.adminSecretHash);
    next();
  } catch {
    res.clearCookie('auth_token');
    return res.status(401).json({ error: 'Nicht autorisiert' });
  }
};
