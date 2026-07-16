// Goal endpoints (/api/goals): CRUD plus progress computed from activity and
// habit logs.
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const Goal = require('../models/Goal');
const ActivityLog = require('../models/ActivityLog');
const HabitLog = require('../models/HabitLog');
const ActivityType = require('../models/ActivityType');
const HabitDefinition = require('../models/HabitDefinition');

// ─Hilfsfunktionen

function getIntervalBounds(intervalValue = 1, intervalUnit = 'week') {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  if (intervalUnit === 'day') {
    start.setDate(start.getDate() - (intervalValue - 1));
  } else if (intervalUnit === 'week') {
    const day = start.getDay();
    start.setDate(start.getDate() - (day === 0 ? 6 : day - 1) - (intervalValue - 1) * 7);
  } else if (intervalUnit === 'month') {
    start.setDate(1);
    start.setMonth(start.getMonth() - (intervalValue - 1));
  }

  return { start, end };
}

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

// Returns the MongoDB filter expression for activity logs.
// New goals use activityTypeRef (ObjectId); legacy goals use a string label.
async function buildActivityMatchQuery(goal) {
  const isNewStyle = goal.targetRefModel === 'ActivityType' &&
    mongoose.Types.ObjectId.isValid(goal.targetRef);

  if (isNewStyle) {
    return { activityTypeRef: new mongoose.Types.ObjectId(String(goal.targetRef)) };
  }

  // Legacy: targetRef ist der String-Label
  const label = typeof goal.targetRef === 'string' ? goal.targetRef : null;
  return label ? { activityType: label } : null;
}

function buildActivityFilterMatch(activityFilters, isMax) {
  if (!isMax || !activityFilters?.length) return {};
  const match = {};
  for (const f of activityFilters) {
    if (f.fieldType === 'number') {
      if (f.numValue != null) {
        const path = ['duration', 'distance'].includes(f.fieldKey)
          ? f.fieldKey
          : `customValues.${f.fieldKey}`;
        const op = f.numOperator === 'max' ? '$lte' : f.numOperator === 'exact' ? '$eq' : '$gte';
        match[path] = { [op]: f.numValue };
      }
    } else {
      if (f.values?.length) {
        const path = `customValues.${f.fieldKey}`;
        match[path] = f.operator === 'allOf' ? { $all: f.values } : { $in: f.values };
      }
    }
  }
  return match;
}

async function getValueForMetric(metric, goal, userId, start, end, valueScope = 'total', aggregation = 'sum', activityFilters = []) {
  const isActivity = goal.targetRefModel === 'ActivityType' || goal.targetRefModel === 'activity';
  const uid = new mongoose.Types.ObjectId(String(userId));
  const isMax = aggregation === 'max';
  const perActivity = !isMax && valueScope === 'perActivity';
  const filterMatch = buildActivityFilterMatch(activityFilters, isMax);

  if (isActivity) {
    const typeFilter = await buildActivityMatchQuery(goal);
    if (!typeFilter) return 0;

    const dateFilter = { date: { $gte: start, $lte: end } };
    const baseMatch = { userId: uid, ...typeFilter, ...dateFilter, ...filterMatch };

    if (metric === 'distance' || metric === 'duration') {
      const aggOp = isMax ? '$max' : '$sum';
      const agg = await ActivityLog.aggregate([
        { $match: baseMatch },
        { $group: { _id: null, total: { [aggOp]: `$${metric}` }, count: { $sum: 1 } } }
      ]);
      const total = agg[0]?.total ?? 0;
      const count = agg[0]?.count ?? 0;
      const raw = perActivity && count > 0 ? total / count : total;
      return Math.round(raw * 100) / 100;
    }

    if (metric?.startsWith('custom_')) {
      const fieldKey = metric.slice(7);
      const aggOp = isMax ? '$max' : '$sum';
      const agg = await ActivityLog.aggregate([
        { $match: baseMatch },
        { $group: { _id: null, total: { [aggOp]: `$customValues.${fieldKey}` }, count: { $sum: 1 } } }
      ]);
      const total = agg[0]?.total ?? 0;
      const count = agg[0]?.count ?? 0;
      const raw = perActivity && count > 0 ? total / count : total;
      return Math.round(raw * 100) / 100;
    }

    if (metric?.startsWith('select_')) {
      const rest = metric.slice(7);
      const colonIdx = rest.indexOf(':');
      if (colonIdx === -1) return 0;
      const fieldKey = rest.slice(0, colonIdx);
      const fieldValue = rest.slice(colonIdx + 1);
      return ActivityLog.countDocuments({
        userId,
        ...typeFilter,
        [`customValues.${fieldKey}`]: fieldValue,
        ...dateFilter,
      });
    }

    // 'count' oder kein metric
    return ActivityLog.countDocuments({ userId, ...typeFilter, ...dateFilter });
  } else {
    // Habit-Ziel
    if (metric === 'count') {
      return HabitLog.countDocuments({ userId, habitId: goal.targetRef, date: { $gte: start, $lte: end } });
    }
    const logs = await HabitLog.find({ userId, habitId: goal.targetRef, date: { $gte: start, $lte: end } }).select('value');
    if (perActivity && logs.length > 0) {
      return Math.round((logs.reduce((sum, l) => sum + l.value, 0) / logs.length) * 100) / 100;
    }
    return logs.reduce((sum, l) => sum + l.value, 0);
  }
}

function checkConditionMet(condition, currentValue, targetValue) {
  if (condition === 'min') return currentValue >= targetValue;
  if (condition === 'max') return currentValue <= targetValue;
  if (condition === 'exact') return currentValue === targetValue;
  return false;
}

// Checks whether a metric condition is still valid given the current field definitions.
function checkMetricValid(metric, customFields = []) {
  if (!metric || metric === 'count' || metric === 'distance' || metric === 'duration' || metric === 'value') {
    return { valid: true };
  }
  if (metric.startsWith('custom_')) {
    const key = metric.slice(7);
    const exists = customFields.some(f => f.key === key && f.type === 'number');
    return exists
      ? { valid: true }
      : { valid: false, reason: `Zahlenfeld "${key}" wurde entfernt oder umbenannt` };
  }
  if (metric.startsWith('select_')) {
    const rest = metric.slice(7);
    const colonIdx = rest.indexOf(':');
    if (colonIdx === -1) return { valid: false, reason: 'Ungültige Metrik-Syntax' };
    const fieldKey = rest.slice(0, colonIdx);
    const optionValue = rest.slice(colonIdx + 1);
    const field = customFields.find(f => f.key === fieldKey && (f.type === 'select' || f.type === 'multiselect'));
    if (!field) return { valid: false, reason: `Auswahlfeld "${fieldKey}" wurde entfernt oder umbenannt` };
    if (!field.options.includes(optionValue)) {
      return { valid: false, reason: `Option "${optionValue}" nicht mehr vorhanden in "${field.label}"` };
    }
    return { valid: true };
  }
  return { valid: true };
}

async function enrichGoal(goal, userId) {
  const obj = goal.toObject ? goal.toObject() : { ...goal };
  const isActivity = obj.targetRefModel === 'ActivityType' || obj.targetRefModel === 'activity';

  if (isActivity && mongoose.Types.ObjectId.isValid(obj.targetRef)) {
    // Scoped to the owner: a foreign targetRef must not leak labels/fields.
    const at = await ActivityType.findOne({ _id: obj.targetRef, userId }).select('label customFields').lean();
    obj.targetName = at?.label ?? 'Unbekannt';
    obj.customFields = at?.customFields || [];

    // Metric warnings: check whether all metrics still point to existing fields
    const allConditions = obj.conditions?.length ? obj.conditions : [{ metric: obj.metric }];
    const warnings = allConditions
      .map(c => checkMetricValid(c.metric, obj.customFields))
      .filter(r => !r.valid)
      .map(r => r.reason)
      .filter(Boolean);
    if (warnings.length > 0) obj.metricWarnings = warnings;
  } else if (isActivity) {
    obj.targetName = typeof obj.targetRef === 'string' ? obj.targetRef : 'Unbekannt';
    obj.customFields = [];
  } else {
    // Habit-Ziel — own or global habits only
    const hd = mongoose.Types.ObjectId.isValid(obj.targetRef)
      ? await HabitDefinition.findOne({
          _id: obj.targetRef,
          $or: [{ userId }, { userId: null }],
        }).select('name unitSymbol').lean()
      : null;
    obj.targetName = hd?.name ?? 'Unbekannt';
    obj.customFields = [];
    if (!obj.unitSymbol && hd?.unitSymbol) obj.unitSymbol = hd.unitSymbol;
  }
  return obj;
}

// ─Routen

router.get('/', auth, async (req, res) => {
  try {
    const goals = await Goal.find({ userId: req.user._id, isActive: true }).sort({ createdAt: -1 });
    const enriched = await Promise.all(goals.map(g => enrichGoal(g, req.user._id)));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/progress', auth, async (req, res) => {
  try {
    const goal = await Goal.findOne({ _id: req.params.id, userId: req.user._id });
    if (!goal) return res.status(404).json({ error: 'Nicht gefunden' });

    const isLongTerm = goal.type.startsWith('long-term');

    let start, end;
    if (isLongTerm) {
      start = goal.startDate ? new Date(goal.startDate) : new Date(0);
      end = new Date(); end.setHours(23, 59, 59, 999);
    } else {
      const iv = goal.intervalValue || 1;
      const iu = goal.intervalUnit || 'week';
      ({ start, end } = getIntervalBounds(iv, iu));
    }

    let condDefs;
    if (goal.conditions && goal.conditions.length > 0) {
      condDefs = goal.conditions;
    } else {
      condDefs = [{ metric: goal.metric, condition: goal.condition, targetValue: goal.targetValue, unitSymbol: goal.unitSymbol }];
    }

    const condResults = await Promise.all(condDefs.map(async (cond) => {
      const currentValue = await getValueForMetric(cond.metric, goal, req.user._id, start, end, cond.valueScope, cond.aggregation, cond.activityFilters);
      const met = checkConditionMet(cond.condition, currentValue, cond.targetValue);
      return { metric: cond.metric, condition: cond.condition, targetValue: cond.targetValue, unitSymbol: cond.unitSymbol, valueScope: cond.valueScope, aggregation: cond.aggregation, activityFilters: cond.activityFilters, currentValue, met };
    }));

    const conditionOperator = goal.conditionOperator || 'AND';
    const met = conditionOperator === 'OR' ? condResults.some(c => c.met) : condResults.every(c => c.met);

    let weeklyData = [];
    if (isLongTerm && goal.startDate && goal.endDate) {
      const firstMetric = condDefs[0]?.metric;
      const firstAggregation = condDefs[0]?.aggregation;
      const firstActivityFilters = condDefs[0]?.activityFilters;
      let weekStart = new Date(goal.startDate);
      const dow = weekStart.getDay();
      weekStart.setDate(weekStart.getDate() - (dow === 0 ? 6 : dow - 1));
      weekStart.setHours(0, 0, 0, 0);
      const now = new Date();
      while (weekStart <= goal.endDate && weekStart <= now) {
        const { monday, sunday } = getWeekBoundsForDate(weekStart);
        const value = await getValueForMetric(firstMetric, goal, req.user._id, monday, sunday, undefined, firstAggregation, firstActivityFilters);
        weeklyData.push({ weekStart: monday.toISOString(), value });
        weekStart.setDate(weekStart.getDate() + 7);
      }
    }

    let stepResults = [];
    if (isLongTerm && goal.intermediateSteps?.length > 0) {
      const goalStart = goal.startDate ? new Date(goal.startDate) : new Date(0);
      const now = new Date(); now.setHours(23, 59, 59, 999);
      const firstCond = condDefs[0];
      stepResults = await Promise.all(
        [...goal.intermediateSteps]
          .sort((a, b) => new Date(a.date) - new Date(b.date))
          .map(async (step) => {
            const stepEnd = new Date(step.date); stepEnd.setHours(23, 59, 59, 999);
            const isPast = stepEnd < now;
            let actualValue = null;
            if (isPast && firstCond) {
              actualValue = await getValueForMetric(
                firstCond.metric, goal, req.user._id, goalStart, stepEnd, firstCond.valueScope, firstCond.aggregation, firstCond.activityFilters
              );
            }
            return {
              date: step.date,
              targetValue: step.targetValue,
              description: step.description,
              isPast,
              actualValue,
              met: isPast && actualValue !== null
                ? checkConditionMet(firstCond?.condition || 'min', actualValue, step.targetValue)
                : null,
            };
          })
      );
    }

    res.json({ conditions: condResults, conditionOperator, met, weeklyData, stepResults });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Strips server-owned fields from a goal payload. Everything else is
// validated by the Mongoose schema (strict mode drops unknown keys).
function safeGoalBody(body) {
  const { userId: _u, _id: _i, __v: _v, createdAt: _c, ...safe } = body;
  return safe;
}

// A goal may only reference the user's own activity types, or the user's own
// / global habit definitions — never another user's documents.
async function assertOwnTargetRef(body, userId) {
  const { targetRef, targetRefModel } = body;
  if (targetRef === undefined) return;
  if (!mongoose.Types.ObjectId.isValid(targetRef)) return; // legacy string label

  const ownActivityType = () => ActivityType.exists({ _id: targetRef, userId });
  const visibleHabit = () => HabitDefinition.exists({
    _id: targetRef,
    $or: [{ userId }, { userId: null }],
  });

  let ok;
  if (targetRefModel === 'ActivityType') ok = await ownActivityType();
  else if (targetRefModel === 'HabitDefinition') ok = await visibleHabit();
  else ok = (await ownActivityType()) || (await visibleHabit());

  if (!ok) {
    const err = new Error('Zielobjekt nicht gefunden');
    err.status = 404;
    throw err;
  }
}

router.post('/', auth, async (req, res) => {
  try {
    const body = safeGoalBody(req.body);
    await assertOwnTargetRef(body, req.user._id);
    const goal = await Goal.create({ ...body, userId: req.user._id });
    res.status(201).json(await enrichGoal(goal, req.user._id));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const body = safeGoalBody(req.body);
    await assertOwnTargetRef(body, req.user._id);
    const goal = await Goal.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: body },
      { new: true }
    );
    if (!goal) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(await enrichGoal(goal, req.user._id));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
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
