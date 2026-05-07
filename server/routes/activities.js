const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ActivityLog = require('../models/ActivityLog');

router.get('/', auth, async (req, res) => {
  try {
    const { startDate, endDate, type, limit = 50, skip = 0 } = req.query;
    const query = { userId: req.user._id };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }
    if (type) query.activityType = type;

    const [activities, total] = await Promise.all([
      ActivityLog.find(query).sort({ date: -1 }).limit(+limit).skip(+skip),
      ActivityLog.countDocuments(query)
    ]);

    res.json({ activities, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { activityType, date, duration, distance, notes } = req.body;
    const activity = await ActivityLog.create({
      userId: req.user._id,
      activityType,
      date: new Date(date),
      duration,
      distance,
      notes
    });
    res.status(201).json(activity);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const activity = await ActivityLog.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      req.body,
      { new: true }
    );
    if (!activity) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(activity);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await ActivityLog.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!result) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
