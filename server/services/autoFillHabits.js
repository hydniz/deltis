// Materializes auto-filled habit values into real HabitLogs.
//
// A habit can be bound (UserHabitSettings.habitSettings[id].autoSource) to a
// metric or to matching Strava/Health activities. The due engine computes those
// values at read time, but that only surfaces on the dashboard/planner — the
// Habits page reads HabitLog. So we also WRITE the value as an `auto` HabitLog,
// which makes it visible everywhere and countable in stats.
//
// A manual log ALWAYS wins: a day already logged by hand is never overwritten,
// and typing a value converts the day to `manual` (see routes/habits POST).
const UserHabitSettings = require('../models/UserHabitSettings');
const HabitLog = require('../models/HabitLog');
const MetricDefinition = require('../models/MetricDefinition');
const MetricLog = require('../models/MetricLog');
const { includeLog } = require('./metricSources');
const metricAggregate = require('./metricAggregate');
const trainingCriteria = require('./trainingCriteria');

const dayKey = (date) => new Date(date).toISOString().slice(0, 10);

// The user's habits that have an auto-fill binding.
async function autoBoundHabits(userId) {
  const settings = await UserHabitSettings.findOne({ userId }).lean();
  if (!settings) return [];
  const selected = new Set((settings.selectedHabitIds || []).map(String));
  const out = [];
  for (const [habitId, s] of Object.entries(settings.habitSettings || {})) {
    if (!selected.has(habitId)) continue;
    const src = s?.autoSource;
    if (src?.kind === 'metric' && src.metricId) {
      out.push({ habitId, kind: 'metric', metricId: String(src.metricId) });
    } else if (src?.kind === 'activity' && src.criteria) {
      const metric = ['count', 'distance', 'duration'].includes(src.metric) ? src.metric : 'count';
      out.push({ habitId, kind: 'activity', criteria: src.criteria, metric });
    }
  }
  return out;
}

// Computes the auto value for each (habit, day) across the given day strings.
async function computeValues(userId, habits, days) {
  const values = new Map(); // `habitId|day` -> number
  if (habits.length === 0 || days.length === 0) return values;
  const sorted = [...days].sort();
  const start = new Date(`${sorted[0]}T00:00:00.000Z`);
  const end = new Date(`${sorted[sorted.length - 1]}T23:59:59.999Z`);

  const metricHabits = habits.filter(h => h.kind === 'metric');
  if (metricHabits.length) {
    const metricIds = [...new Set(metricHabits.map(h => h.metricId))];
    const [defs, logs] = await Promise.all([
      MetricDefinition.find({ userId, _id: { $in: metricIds } }).select('dayAggregation sourcePolicy').lean(),
      MetricLog.find({ userId, metricId: { $in: metricIds }, date: { $gte: start, $lte: end } })
        .select('metricId date value source origin deviceId').lean(),
    ]);
    const aggById = new Map(defs.map(d => [String(d._id), d.dayAggregation || 'last']));
    const policyById = new Map(defs.map(d => [String(d._id), d.sourcePolicy]));
    const byMetricDay = new Map();
    for (const l of logs) {
      if (!includeLog(l, policyById.get(String(l.metricId)))) continue; // honour source policy
      const k = `${l.metricId}|${dayKey(l.date)}`;
      if (!byMetricDay.has(k)) byMetricDay.set(k, []);
      byMetricDay.get(k).push(l.value);
    }
    for (const h of metricHabits) {
      const mode = aggById.get(h.metricId) || 'last';
      for (const day of days) {
        const vals = byMetricDay.get(`${h.metricId}|${day}`);
        if (vals) values.set(`${h.habitId}|${day}`, metricAggregate.reduce(vals, mode));
      }
    }
  }

  for (const h of habits.filter(x => x.kind === 'activity')) {
    const matches = await trainingCriteria.findMatches(userId, h.criteria, start, end).catch(() => []);
    const perDay = new Map();
    for (const m of matches) {
      const day = dayKey(m.date);
      if (!perDay.has(day)) perDay.set(day, { count: 0, distance: 0, duration: 0 });
      const acc = perDay.get(day);
      acc.count += 1;
      acc.distance += (m.distance || 0) / 1000;
      acc.duration += (m.movingTime || 0) / 60;
    }
    for (const [day, acc] of perDay) {
      if (days.includes(day)) values.set(`${h.habitId}|${day}`, Math.round(acc[h.metric] * 100) / 100);
    }
  }

  return values;
}

// Writes auto values as HabitLogs for the given local day strings, never
// touching a day the user logged manually. Returns { written }.
async function materialize(userId, days) {
  const dayList = [...new Set((days || []).filter(Boolean))];
  if (dayList.length === 0) return { written: 0 };
  const habits = await autoBoundHabits(userId);
  if (habits.length === 0) return { written: 0 };

  const values = await computeValues(userId, habits, dayList);
  let written = 0;
  for (const [key, value] of values) {
    const [habitId, day] = key.split('|');
    const startOfDay = new Date(`${day}T00:00:00.000Z`);
    const endOfDay = new Date(`${day}T23:59:59.999Z`);
    const existing = await HabitLog.findOne({ userId, habitId, date: { $gte: startOfDay, $lte: endOfDay } })
      .select('source').lean();
    if (existing && existing.source === 'manual') continue; // manual wins
    await HabitLog.findOneAndUpdate(
      { userId, habitId, date: { $gte: startOfDay, $lte: endOfDay } },
      { $set: { value, source: 'auto' }, $setOnInsert: { userId, habitId, date: startOfDay } },
      { upsert: true }
    );
    written++;
  }
  return { written };
}

// The last `n` local days (inclusive of today), for backfilling on setup.
function recentDays(n = 30) {
  const days = [];
  for (let i = 0; i < n; i++) {
    days.push(new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  return days;
}

module.exports = { materialize, recentDays, autoBoundHabits, computeValues };
