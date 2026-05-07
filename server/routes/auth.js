const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');

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

module.exports = router;
