const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Goal = require('../models/Goal');
const ActivityLog = require('../models/ActivityLog');
const HabitLog = require('../models/HabitLog');

function getWeekBounds(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { monday, sunday };
}

async function getWeekValue(goal, userId, monday, sunday) {
  if (goal.targetRefModel === 'activity') {
    return ActivityLog.countDocuments({
      userId,
      activityType: goal.targetRef,
      date: { $gte: monday, $lte: sunday }
    });
  } else {
    const logs = await HabitLog.find({
      userId,
      habitId: goal.targetRef,
      date: { $gte: monday, $lte: sunday }
    });
    return logs.reduce((sum, l) => sum + l.value, 0);
  }
}

router.get('/', auth, async (req, res) => {
  try {
    const goals = await Goal.find({ userId: req.user._id, isActive: true }).sort({ createdAt: -1 });
    res.json(goals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/progress', auth, async (req, res) => {
  try {
    const goal = await Goal.findOne({ _id: req.params.id, userId: req.user._id });
    if (!goal) return res.status(404).json({ error: 'Nicht gefunden' });

    const { monday, sunday } = getWeekBounds();
    const currentValue = await getWeekValue(goal, req.user._id, monday, sunday);

    let weeklyData = [];
    if (goal.type.startsWith('long-term') && goal.startDate && goal.endDate) {
      let weekStart = new Date(goal.startDate);
      const dayOfWeek = weekStart.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      weekStart.setDate(weekStart.getDate() + diff);
      weekStart.setHours(0, 0, 0, 0);

      const now = new Date();
      while (weekStart <= goal.endDate && weekStart <= now) {
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);

        const value = await getWeekValue(goal, req.user._id, weekStart, weekEnd);
        weeklyData.push({ weekStart: weekStart.toISOString(), value });

        weekStart = new Date(weekStart);
        weekStart.setDate(weekStart.getDate() + 7);
      }
    }

    res.json({ currentValue, weeklyData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const goal = await Goal.create({ userId: req.user._id, ...req.body });
    res.status(201).json(goal);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const goal = await Goal.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      req.body,
      { new: true }
    );
    if (!goal) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(goal);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await Goal.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
