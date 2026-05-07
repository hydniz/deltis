const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const Goal = require('../models/Goal');
const ActivityLog = require('../models/ActivityLog');
const HabitLog = require('../models/HabitLog');
const ActivityType = require('../models/ActivityType');
const HabitDefinition = require('../models/HabitDefinition');

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

// Berechnet den Zeitraum für ein Intervallziel (endet heute)
function getIntervalBounds(intervalValue = 1, intervalUnit = 'week') {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  if (intervalUnit === 'day') {
    start.setDate(start.getDate() - (intervalValue - 1));
  } else if (intervalUnit === 'week') {
    // Auf Montag der aktuellen Woche ausrichten, dann (n-1) weitere Wochen zurück
    const day = start.getDay();
    start.setDate(start.getDate() - (day === 0 ? 6 : day - 1) - (intervalValue - 1) * 7);
  } else if (intervalUnit === 'month') {
    // 1. des aktuellen Monats, dann (n-1) Monate zurück
    start.setDate(1);
    start.setMonth(start.getMonth() - (intervalValue - 1));
  }

  return { start, end };
}

// Wochengrenzen für einen bestimmten Startpunkt (für Langzeit-Chart)
function getWeekBoundsForDate(date) {
  const d = new Date(date);
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { monday, sunday };
}

// Löst targetRef zu einem Aktivitäts-Label auf – unterstützt neue (ObjectId) und alte (String) Ziele
async function resolveActivityLabel(goal) {
  const isNew = goal.targetRefModel === 'ActivityType';
  if (isNew && mongoose.Types.ObjectId.isValid(goal.targetRef)) {
    const at = await ActivityType.findById(goal.targetRef).select('label').lean();
    return at?.label ?? null;
  }
  // Legacy: targetRef ist direkt der String-Label
  return typeof goal.targetRef === 'string' ? goal.targetRef : null;
}

// Berechnet den Wert für einen beliebigen Zeitraum gemäß metric
async function getValueForMetric(metric, goal, userId, start, end) {
  const isActivity = goal.targetRefModel === 'ActivityType' || goal.targetRefModel === 'activity';

  if (isActivity) {
    if (metric === 'distance' || metric === 'duration') {
      const label = await resolveActivityLabel(goal);
      if (!label) return 0;
      const agg = await ActivityLog.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(String(userId)), activityType: label, date: { $gte: start, $lte: end } } },
        { $group: { _id: null, total: { $sum: `$${metric}` } } }
      ]);
      return Math.round((agg[0]?.total ?? 0) * 100) / 100;
    }
    if (metric && metric.startsWith('custom_')) {
      const fieldKey = metric.slice(7);
      const label = await resolveActivityLabel(goal);
      if (!label) return 0;
      const agg = await ActivityLog.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(String(userId)), activityType: label, date: { $gte: start, $lte: end } } },
        { $group: { _id: null, total: { $sum: `$customValues.${fieldKey}` } } }
      ]);
      return Math.round((agg[0]?.total ?? 0) * 100) / 100;
    }
    // 'select_fieldKey:optionValue' → Einträge zählen wo customValues.fieldKey === optionValue
    if (metric && metric.startsWith('select_')) {
      const rest = metric.slice(7);
      const colonIdx = rest.indexOf(':');
      if (colonIdx === -1) return 0;
      const fieldKey = rest.slice(0, colonIdx);
      const fieldValue = rest.slice(colonIdx + 1);
      const label = await resolveActivityLabel(goal);
      if (!label) return 0;
      return ActivityLog.countDocuments({
        userId,
        activityType: label,
        [`customValues.${fieldKey}`]: fieldValue,
        date: { $gte: start, $lte: end }
      });
    }
    // 'count' or falsy → count documents
    const label = await resolveActivityLabel(goal);
    if (!label) return 0;
    return ActivityLog.countDocuments({ userId, activityType: label, date: { $gte: start, $lte: end } });
  } else {
    // Habit goal
    if (metric === 'count') {
      return HabitLog.countDocuments({ userId, habitId: goal.targetRef, date: { $gte: start, $lte: end } });
    }
    // 'value' or falsy → sum HabitLog.value
    const logs = await HabitLog.find({ userId, habitId: goal.targetRef, date: { $gte: start, $lte: end } }).select('value');
    return logs.reduce((sum, l) => sum + l.value, 0);
  }
}

// Prüft ob eine Bedingung erfüllt ist
function checkConditionMet(condition, currentValue, targetValue) {
  if (condition === 'min') return currentValue >= targetValue;
  if (condition === 'max') return currentValue <= targetValue;
  if (condition === 'exact') return currentValue === targetValue;
  return false;
}

// Reichert ein Ziel-Objekt mit lesbarem targetName, customFields und ggf. unitSymbol an
async function enrichGoal(goal) {
  const obj = goal.toObject ? goal.toObject() : { ...goal };
  const isActivity = obj.targetRefModel === 'ActivityType' || obj.targetRefModel === 'activity';

  if (isActivity && mongoose.Types.ObjectId.isValid(obj.targetRef)) {
    const at = await ActivityType.findById(obj.targetRef).select('label customFields').lean();
    obj.targetName = at?.label ?? 'Unbekannt';
    obj.customFields = at?.customFields || [];
  } else if (isActivity) {
    obj.targetName = typeof obj.targetRef === 'string' ? obj.targetRef : 'Unbekannt';
    obj.customFields = [];
  } else {
    // habit
    const hd = await HabitDefinition.findById(obj.targetRef).select('name unitSymbol').lean();
    obj.targetName = hd?.name ?? 'Unbekannt';
    obj.customFields = [];
    if (!obj.unitSymbol && hd?.unitSymbol) obj.unitSymbol = hd.unitSymbol;
  }
  return obj;
}

// ─── Routen ───────────────────────────────────────────────────────────────────

// GET /api/goals – alle aktiven Ziele mit aufgelöstem targetName
router.get('/', auth, async (req, res) => {
  try {
    const goals = await Goal.find({ userId: req.user._id, isActive: true }).sort({ createdAt: -1 });
    const enriched = await Promise.all(goals.map(enrichGoal));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/goals/:id/progress – Fortschrittsberechnung für ein Ziel
router.get('/:id/progress', auth, async (req, res) => {
  try {
    const goal = await Goal.findOne({ _id: req.params.id, userId: req.user._id });
    if (!goal) return res.status(404).json({ error: 'Nicht gefunden' });

    const isLongTerm = goal.type.startsWith('long-term');

    // Determine time bounds
    let start, end;
    if (isLongTerm) {
      start = goal.startDate ? new Date(goal.startDate) : new Date(0);
      end = new Date(); end.setHours(23, 59, 59, 999);
    } else {
      const iv = goal.intervalValue || 1;
      const iu = goal.intervalUnit || 'week';
      ({ start, end } = getIntervalBounds(iv, iu));
    }

    // Build conditions list (use goal.conditions if present, else legacy single condition)
    let condDefs;
    if (goal.conditions && goal.conditions.length > 0) {
      condDefs = goal.conditions;
    } else {
      condDefs = [{
        metric: goal.metric,
        condition: goal.condition,
        targetValue: goal.targetValue,
        unitSymbol: goal.unitSymbol,
      }];
    }

    // Evaluate each condition
    const condResults = await Promise.all(condDefs.map(async (cond) => {
      const currentValue = await getValueForMetric(cond.metric, goal, req.user._id, start, end);
      const met = checkConditionMet(cond.condition, currentValue, cond.targetValue);
      return {
        metric: cond.metric,
        condition: cond.condition,
        targetValue: cond.targetValue,
        unitSymbol: cond.unitSymbol,
        currentValue,
        met,
      };
    }));

    const conditionOperator = goal.conditionOperator || 'AND';
    let met;
    if (conditionOperator === 'OR') {
      met = condResults.some(c => c.met);
    } else {
      met = condResults.every(c => c.met);
    }

    // Wöchentlicher Verlauf (nur für langfristige Ziele → Chart)
    // Uses the first condition's metric
    let weeklyData = [];
    if (isLongTerm && goal.startDate && goal.endDate) {
      const firstMetric = condDefs[0]?.metric;
      let weekStart = new Date(goal.startDate);
      const dow = weekStart.getDay();
      weekStart.setDate(weekStart.getDate() - (dow === 0 ? 6 : dow - 1));
      weekStart.setHours(0, 0, 0, 0);

      const now = new Date();
      while (weekStart <= goal.endDate && weekStart <= now) {
        const { monday, sunday } = getWeekBoundsForDate(weekStart);
        const value = await getValueForMetric(firstMetric, goal, req.user._id, monday, sunday);
        weeklyData.push({ weekStart: monday.toISOString(), value });
        weekStart.setDate(weekStart.getDate() + 7);
      }
    }

    res.json({ conditions: condResults, conditionOperator, met, weeklyData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/goals – neues Ziel erstellen
router.post('/', auth, async (req, res) => {
  try {
    const goal = await Goal.create({ userId: req.user._id, ...req.body });
    res.status(201).json(await enrichGoal(goal));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/goals/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const goal = await Goal.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      req.body,
      { new: true }
    );
    if (!goal) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(await enrichGoal(goal));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/goals/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    await Goal.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
