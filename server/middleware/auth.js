const bcrypt = require('bcryptjs');
const User = require('../models/User');

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Nicht autorisiert' });
  }

  const token = authHeader.slice(7).trim();
  // Token format: "uuid" for regular users, "uuid:adminPassword" for admin
  const colonIdx = token.indexOf(':');
  const uuid = colonIdx !== -1 ? token.slice(0, colonIdx) : token;
  const providedSecret = colonIdx !== -1 ? token.slice(colonIdx + 1) : null;

  try {
    // Explicitly include adminSecretHash (select: false in schema)
    const user = await User.findOne({ uuid }).select('+adminSecretHash');
    if (!user) {
      return res.status(401).json({ error: 'Ungültige UUID' });
    }

    if (user.isAdmin) {
      if (!providedSecret || !user.adminSecretHash) {
        return res.status(401).json({ error: 'Admin-Secret erforderlich' });
      }
      const valid = await bcrypt.compare(providedSecret, user.adminSecretHash);
      if (!valid) {
        return res.status(401).json({ error: 'Falsches Admin-Secret' });
      }
    }

    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Serverfehler' });
  }
};
