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
const StravaActivity = require('../models/StravaActivity');
const stravaCriteria = require('../services/stravaCriteria');
const TrainingType = require('../models/TrainingType');
const trainingCriteria = require('../services/trainingCriteria');

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

// Resolves the criteria map for a Strava/training goal: a referenced training
// type wins, otherwise the goal's own stravaCriteria tree (null tree = every
// synced Strava activity). A dangling type reference matches nothing.
async function resolveGoalCriteriaMap(goal, userId) {
  if (goal.trainingTypeId) {
    const type = await TrainingType.findOne({ _id: goal.trainingTypeId, userId }).lean();
    return type ? (type.criteria || {}) : null;
  }
  return { strava: goal.stravaCriteria ?? null };
}

// Matching activities (across integrations) for a Strava/training goal —
// evaluation happens in JS: HR-stream rules cannot run as a Mongo query.
async function getStravaMatches(goal, userId, start, end) {
  const map = await resolveGoalCriteriaMap(goal, userId);
  if (!map) return [];
  return trainingCriteria.findMatches(userId, map, start, end);
}

// Progress value for Strava goals: the metric aggregates over the matches.
async function getStravaValueForMetric(metric, goal, userId, start, end, valueScope = 'total', aggregation = 'sum') {
  const matching = await getStravaMatches(goal, userId, start, end);

  if (!metric || metric === 'count') return matching.length;

  const values = matching.map(m => {
    if (metric === 'duration') return (m.movingTime || 0) / 60; // minutes
    if (metric === 'distance') return (m.distance || 0) / 1000; // km
    return 0;
  });
  if (values.length === 0) return 0;

  const round = v => Math.round(v * 100) / 100;
  if (aggregation === 'max') return round(Math.max(...values));
  const total = values.reduce((sum, v) => sum + v, 0);
  return round(valueScope === 'perActivity' ? total / values.length : total);
}

async function getValueForMetric(metric, goal, userId, start, end, valueScope = 'total', aggregation = 'sum', activityFilters = []) {
  if (goal.targetRefModel === 'StravaActivity') {
    return getStravaValueForMetric(metric, goal, userId, start, end, valueScope, aggregation);
  }

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

  // Child goals carry their parent's name so the hierarchy is visible.
  if (obj.parentGoalId) {
    const parent = await Goal.findOne({ _id: obj.parentGoalId, userId }).select('name').lean();
    if (parent) obj.parentGoal = { _id: parent._id, name: parent.name };
  }

  // Meta goals list their children instead of a referenced document.
  if (obj.type === 'meta') {
    const children = await Goal.find({ userId, parentGoalId: obj._id, isActive: true })
      .select('name').sort({ createdAt: 1 }).lean();
    obj.targetName = 'Gesamtziel';
    obj.customFields = [];
    obj.childGoals = children.map(c => ({ _id: c._id, name: c.name }));
    return obj;
  }

  // Strava goals reference no document — the criteria tree defines the target.
  if (obj.targetRefModel === 'StravaActivity') {
    obj.targetName = 'Strava';
    obj.customFields = [];
    if (obj.trainingTypeId) {
      const type = await TrainingType.findOne({ _id: obj.trainingTypeId, userId }).select('name').lean();
      obj.trainingTypeName = type?.name ?? null; // null = type was deleted
      if (type) obj.targetName = type.name;
    }
    return obj;
  }

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

// Current evaluation window of a goal (long-term: since start; periodic:
// the running interval).
function getGoalBounds(goal) {
  if (goal.type.startsWith('long-term')) {
    const start = goal.startDate ? new Date(goal.startDate) : new Date(0);
    const end = new Date(); end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  return getIntervalBounds(goal.intervalValue || 1, goal.intervalUnit || 'week');
}

// Meta goals: met when >= targetValue of the child goals are met. Children
// are evaluated with their own intervals/criteria; they can never be meta
// themselves (enforced on write), so the recursion is bounded.
async function computeMetaProgress(goal, userId) {
  const children = await Goal.find({ userId, parentGoalId: goal._id, isActive: true })
    .sort({ createdAt: 1 });

  const childResults = [];
  for (const child of children) {
    const progress = await computeProgress(child, userId);
    // First condition as a compact preview so the meta card can show child
    // progress without loading every child's full progress payload.
    const first = progress.conditions?.[0] || {};
    childResults.push({
      _id: child._id,
      name: child.name,
      type: child.type,
      targetRefModel: child.targetRefModel,
      met: progress.met,
      currentValue: first.currentValue ?? null,
      targetValue: first.targetValue ?? null,
      unitSymbol: first.unitSymbol || '',
      condition: first.condition || 'min',
      conditionCount: progress.conditions?.length ?? 0,
    });
  }

  const currentValue = childResults.filter(c => c.met).length;
  const met = checkConditionMet(goal.condition || 'min', currentValue, goal.targetValue);

  return {
    conditions: [{
      metric: 'subgoals',
      condition: goal.condition || 'min',
      targetValue: goal.targetValue,
      unitSymbol: 'Ziele',
      currentValue,
      met,
    }],
    conditionOperator: 'AND',
    met,
    weeklyData: [],
    stepResults: [],
    childResults,
  };
}

// Full progress payload for one goal — shared by the progress route and the
// meta evaluation of parent goals.
async function computeProgress(goal, userId) {
  if (goal.type === 'meta') return computeMetaProgress(goal, userId);

  const isLongTerm = goal.type.startsWith('long-term');
  const { start, end } = getGoalBounds(goal);

  let condDefs;
    if (goal.conditions && goal.conditions.length > 0) {
      condDefs = goal.conditions;
    } else {
      condDefs = [{ metric: goal.metric, condition: goal.condition, targetValue: goal.targetValue, unitSymbol: goal.unitSymbol }];
    }

    const condResults = await Promise.all(condDefs.map(async (cond) => {
      const currentValue = await getValueForMetric(cond.metric, goal, userId, start, end, cond.valueScope, cond.aggregation, cond.activityFilters);
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
        const value = await getValueForMetric(firstMetric, goal, userId, monday, sunday, undefined, firstAggregation, firstActivityFilters);
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
                firstCond.metric, goal, userId, goalStart, stepEnd, firstCond.valueScope, firstCond.aggregation, firstCond.activityFilters
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

  return { conditions: condResults, conditionOperator, met, weeklyData, stepResults };
}

router.get('/:id/progress', auth, async (req, res) => {
  try {
    const goal = await Goal.findOne({ _id: req.params.id, userId: req.user._id });
    if (!goal) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(await computeProgress(goal, req.user._id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/goals/:id/items
// The entries contributing to the goal's CURRENT interval — makes progress
// explainable ("which Strava activities / logs / sub-goals count?").
router.get('/:id/items', auth, async (req, res) => {
  try {
    const goal = await Goal.findOne({ _id: req.params.id, userId: req.user._id });
    if (!goal) return res.status(404).json({ error: 'Nicht gefunden' });
    const { start, end } = getGoalBounds(goal);

    if (goal.type === 'meta') {
      const progress = await computeMetaProgress(goal, req.user._id);
      return res.json({ kind: 'meta', start, end, entries: progress.childResults });
    }

    if (goal.targetRefModel === 'StravaActivity') {
      const matches = await getStravaMatches(goal, req.user._id, start, end);
      return res.json({ kind: 'strava', start, end, entries: matches });
    }

    const isActivity = goal.targetRefModel === 'ActivityType' || goal.targetRefModel === 'activity';
    if (isActivity) {
      const typeFilter = await buildActivityMatchQuery(goal);
      if (!typeFilter) return res.json({ kind: 'activity', start, end, entries: [] });
      const logs = await ActivityLog.find({
        userId: req.user._id, ...typeFilter, date: { $gte: start, $lte: end },
      }).sort({ date: -1 }).limit(100).lean();
      return res.json({
        kind: 'activity',
        start,
        end,
        entries: logs.map(l => ({
          id: String(l._id), date: l.date, name: l.activityType,
          duration: l.duration, distance: l.distance,
        })),
      });
    }

    // Habit goal
    const logs = await HabitLog.find({
      userId: req.user._id, habitId: goal.targetRef, date: { $gte: start, $lte: end },
    }).sort({ date: -1 }).limit(100).lean();
    return res.json({
      kind: 'habit',
      start,
      end,
      entries: logs.map(l => ({ id: String(l._id), date: l.date, value: l.value })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/goals/:id/heatmap?weeks=16
// Per-day contribution towards the goal's first condition metric over the
// last N weeks (aligned to full Mon–Sun weeks) — feeds the goal heatmap on
// the goals page and the shareable heatmap view. Meta goals have no daily
// contribution and return an empty map.
router.get('/:id/heatmap', auth, async (req, res) => {
  try {
    const goal = await Goal.findOne({ _id: req.params.id, userId: req.user._id });
    if (!goal) return res.status(404).json({ error: 'Nicht gefunden' });

    const weeks = Math.min(Math.max(parseInt(req.query.weeks, 10) || 16, 1), 26);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const dow = start.getDay();
    start.setDate(start.getDate() - (dow === 0 ? 6 : dow - 1) - (weeks - 1) * 7);

    const firstCond = goal.conditions?.length ? goal.conditions[0] : {
      metric: goal.metric, condition: goal.condition,
      targetValue: goal.targetValue, unitSymbol: goal.unitSymbol,
    };
    const metric = firstCond.metric || (goal.targetRefModel === 'HabitDefinition' || goal.targetRefModel === 'habit' ? 'value' : 'count');
    const dayOf = (date) => new Date(date).toISOString().slice(0, 10);
    const days = {};
    const add = (date, value) => {
      if (!Number.isFinite(value)) return;
      const key = dayOf(date);
      days[key] = Math.round(((days[key] || 0) + value) * 100) / 100;
    };

    if (goal.type === 'meta') {
      return res.json({ start, end, weeks, metric: 'subgoals', unitSymbol: 'Ziele', days });
    }

    // Periodic goals: one tile per INTERVAL — did the goal succeed in that
    // interval (with gradations for near misses)? Long-term goals keep the
    // daily contribution grid below.
    if (!goal.type.startsWith('long-term')) {
      const iv = goal.intervalValue || 1;
      const iu = goal.intervalUnit || 'week';
      const count = Math.min(Math.max(parseInt(req.query.intervals, 10) || 16, 1), 26);

      // Start of the k-th interval before the current one.
      const startOfIntervalAgo = (k) => {
        const { start: cur } = getIntervalBounds(iv, iu);
        const s = new Date(cur);
        if (iu === 'day') s.setDate(s.getDate() - k * iv);
        else if (iu === 'week') s.setDate(s.getDate() - k * iv * 7);
        else s.setMonth(s.getMonth() - k * iv);
        return s;
      };

      const intervals = [];
      for (let k = count - 1; k >= 0; k--) {
        const s = startOfIntervalAgo(k);
        const e = k === 0 ? end : new Date(startOfIntervalAgo(k - 1).getTime() - 1);
        const value = await getValueForMetric(
          metric, goal, req.user._id, s, e,
          firstCond.valueScope, firstCond.aggregation, firstCond.activityFilters
        );
        intervals.push({
          start: s,
          end: e,
          value,
          targetValue: firstCond.targetValue ?? 0,
          condition: firstCond.condition || 'min',
          met: checkConditionMet(firstCond.condition || 'min', value, firstCond.targetValue),
          current: k === 0,
        });
      }
      return res.json({
        kind: 'intervals',
        intervalValue: iv,
        intervalUnit: iu,
        metric,
        unitSymbol: firstCond.unitSymbol,
        intervals,
      });
    }

    if (goal.targetRefModel === 'StravaActivity') {
      const matches = await getStravaMatches(goal, req.user._id, start, end);
      for (const m of matches) {
        if (metric === 'duration') add(m.date, (m.movingTime || 0) / 60);
        else if (metric === 'distance') add(m.date, (m.distance || 0) / 1000);
        else add(m.date, 1);
      }
      return res.json({ start, end, weeks, metric, unitSymbol: firstCond.unitSymbol, days });
    }

    const isActivity = goal.targetRefModel === 'ActivityType' || goal.targetRefModel === 'activity';
    if (isActivity) {
      const typeFilter = await buildActivityMatchQuery(goal);
      if (!typeFilter) return res.json({ start, end, weeks, metric, unitSymbol: firstCond.unitSymbol, days });
      const logs = await ActivityLog.find({
        userId: req.user._id, ...typeFilter, date: { $gte: start, $lte: end },
      }).select('date duration distance customValues').lean();
      for (const log of logs) {
        if (metric === 'duration' || metric === 'distance') add(log.date, log.value = log[metric] || 0);
        else if (metric?.startsWith('custom_')) add(log.date, Number(log.customValues?.[metric.slice(7)]) || 0);
        else if (metric?.startsWith('select_')) {
          const rest = metric.slice(7);
          const colonIdx = rest.indexOf(':');
          const fieldKey = rest.slice(0, colonIdx);
          const fieldValue = rest.slice(colonIdx + 1);
          const raw = log.customValues?.[fieldKey];
          const hit = Array.isArray(raw) ? raw.includes(fieldValue) : raw === fieldValue;
          if (colonIdx !== -1 && hit) add(log.date, 1);
        } else add(log.date, 1);
      }
      return res.json({ start, end, weeks, metric, unitSymbol: firstCond.unitSymbol, days });
    }

    const logs = await HabitLog.find({
      userId: req.user._id, habitId: goal.targetRef, date: { $gte: start, $lte: end },
    }).select('date value').lean();
    for (const log of logs) {
      add(log.date, metric === 'count' ? 1 : (log.value || 0));
    }
    return res.json({ start, end, weeks, metric, unitSymbol: firstCond.unitSymbol, days });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Strips server-owned fields from a goal payload. parentGoalId is managed
// exclusively through the parent's childGoalIds (single-parent invariant).
// Everything else is validated by the Mongoose schema (strict mode drops
// unknown keys).
function safeGoalBody(body) {
  const { userId: _u, _id: _i, __v: _v, createdAt: _c, parentGoalId: _p, childGoalIds: _cg, ...safe } = body;
  return safe;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Validates the requested children of a meta goal: they must be the user's
// own active goals, not meta themselves (one level only), and either free or
// already attached to this meta goal (single-parent invariant).
async function validateMetaChildren(childGoalIds, userId, metaGoalId = null) {
  const ids = [...new Set((childGoalIds || []).map(String))];
  if (ids.some(id => !mongoose.Types.ObjectId.isValid(id))) {
    throw httpError(400, 'Ungültige Unterziel-Referenz.');
  }
  const children = await Goal.find({ _id: { $in: ids }, userId, isActive: true });
  if (children.length !== ids.length) throw httpError(404, 'Unterziel nicht gefunden');
  for (const child of children) {
    if (child.type === 'meta') {
      throw httpError(400, `"${child.name}" ist selbst ein Gesamtziel und kann kein Unterziel sein.`);
    }
    if (child.parentGoalId && String(child.parentGoalId) !== String(metaGoalId)) {
      throw httpError(400, `"${child.name}" ist bereits Unterziel eines anderen Gesamtziels.`);
    }
  }
  return ids;
}

// Applies the child set of a meta goal: detaches removed children, attaches
// the requested ones.
async function applyMetaChildren(metaGoalId, ids, userId) {
  await Goal.updateMany(
    { userId, parentGoalId: metaGoalId, _id: { $nin: ids } },
    { $set: { parentGoalId: null } }
  );
  await Goal.updateMany(
    { _id: { $in: ids }, userId },
    { $set: { parentGoalId: metaGoalId } }
  );
}

// A goal may only reference the user's own training types.
async function assertOwnTrainingType(body, userId) {
  if (!body.trainingTypeId) return;
  if (!mongoose.Types.ObjectId.isValid(body.trainingTypeId)) {
    throw httpError(400, 'Ungültige Trainingstyp-Referenz.');
  }
  const exists = await TrainingType.exists({ _id: body.trainingTypeId, userId });
  if (!exists) throw httpError(404, 'Trainingstyp nicht gefunden');
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

// Criteria trees for Strava goals are Mixed in the schema — the criteria
// engine validates their shape before anything reaches the database.
function assertValidStravaCriteria(body) {
  if (body.stravaCriteria == null) return;
  const { valid, errors } = stravaCriteria.validateCriteria(body.stravaCriteria);
  if (!valid) {
    const err = new Error(`Ungültige Strava-Kriterien: ${errors.join('; ')}`);
    err.status = 400;
    throw err;
  }
}

router.post('/', auth, async (req, res) => {
  try {
    const body = safeGoalBody(req.body);

    // Meta goals: server-owned target fields; children are validated before
    // the goal exists and attached right after.
    if (body.type === 'meta') {
      const targetValue = +body.targetValue;
      if (!Number.isInteger(targetValue) || targetValue < 1) {
        throw httpError(400, 'Zielwert muss eine ganze Zahl ≥ 1 sein.');
      }
      const childIds = await validateMetaChildren(req.body.childGoalIds, req.user._id);
      if (childIds.length === 0) throw httpError(400, 'Ein Gesamtziel braucht mindestens ein Unterziel.');
      if (targetValue > childIds.length) {
        throw httpError(400, `Zielwert (${targetValue}) kann nicht größer sein als die Anzahl der Unterziele (${childIds.length}).`);
      }

      const goal = await Goal.create({
        name: body.name,
        description: body.description,
        type: 'meta',
        targetRef: 'meta',
        targetRefModel: 'Goal',
        condition: 'min',
        metric: 'count',
        targetValue,
        unitSymbol: 'Ziele',
        userId: req.user._id,
      });
      await applyMetaChildren(goal._id, childIds, req.user._id);
      return res.status(201).json(await enrichGoal(goal, req.user._id));
    }

    await assertOwnTargetRef(body, req.user._id);
    await assertOwnTrainingType(body, req.user._id);
    assertValidStravaCriteria(body);
    const goal = await Goal.create({ ...body, userId: req.user._id });
    res.status(201).json(await enrichGoal(goal, req.user._id));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const existing = await Goal.findOne({ _id: req.params.id, userId: req.user._id });
    if (!existing) return res.status(404).json({ error: 'Nicht gefunden' });

    const body = safeGoalBody(req.body);

    // A goal never changes its nature between meta and regular.
    if (body.type !== undefined && (body.type === 'meta') !== (existing.type === 'meta')) {
      throw httpError(400, 'Der Zieltyp kann nicht zwischen Gesamtziel und normalem Ziel wechseln.');
    }

    if (existing.type === 'meta') {
      let childIds = null;
      if (req.body.childGoalIds !== undefined) {
        childIds = await validateMetaChildren(req.body.childGoalIds, req.user._id, existing._id);
        if (childIds.length === 0) throw httpError(400, 'Ein Gesamtziel braucht mindestens ein Unterziel.');
      }
      const childCount = childIds !== null
        ? childIds.length
        : await Goal.countDocuments({ userId: req.user._id, parentGoalId: existing._id, isActive: true });
      const targetValue = body.targetValue !== undefined ? +body.targetValue : existing.targetValue;
      if (!Number.isInteger(targetValue) || targetValue < 1 || targetValue > childCount) {
        throw httpError(400, `Zielwert muss zwischen 1 und ${childCount} (Anzahl der Unterziele) liegen.`);
      }

      const update = {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        targetValue,
      };
      const goal = await Goal.findOneAndUpdate(
        { _id: existing._id, userId: req.user._id },
        { $set: update },
        { new: true }
      );
      if (childIds !== null) await applyMetaChildren(goal._id, childIds, req.user._id);
      return res.json(await enrichGoal(goal, req.user._id));
    }

    await assertOwnTargetRef(body, req.user._id);
    await assertOwnTrainingType(body, req.user._id);
    assertValidStravaCriteria(body);
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
    const deleted = await Goal.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    // Children of a deleted meta goal become free-standing goals again.
    if (deleted?.type === 'meta') {
      await Goal.updateMany(
        { userId: req.user._id, parentGoalId: deleted._id },
        { $set: { parentGoalId: null } }
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
