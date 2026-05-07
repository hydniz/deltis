const User = require('../models/User');

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Nicht autorisiert' });
  }

  const uuid = authHeader.slice(7).trim();
  const validUuids = (process.env.VALID_UUIDS || '')
    .split(',')
    .map(u => u.trim())
    .filter(Boolean);

  if (!validUuids.includes(uuid)) {
    return res.status(401).json({ error: 'Ungültige UUID' });
  }

  try {
    let user = await User.findOne({ uuid });
    if (!user) {
      user = await User.create({ uuid, name: 'Nutzer ' + uuid.slice(0, 8) });
    }
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Serverfehler' });
  }
};
