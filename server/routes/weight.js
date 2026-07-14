// Weight log endpoints (/api/weight): list, upsert and delete daily entries.
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const WeightLog = require('../models/WeightLog');

router.get('/', auth, async (req, res) => {
  try {
    const { startDate, endDate, limit = 200 } = req.query;
    const query = { userId: req.user._id };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const logs = await WeightLog.find(query).sort({ date: 1 }).limit(+limit);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { date, weight, unit } = req.body;
    const log = await WeightLog.create({
      userId: req.user._id,
      date: new Date(date),
      weight,
      unit: unit || req.user.weightUnit || 'kg'
    });
    res.status(201).json(log);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await WeightLog.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
