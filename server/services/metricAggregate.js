// Pure aggregation helpers for metric readings.
//
// A metric carries two aggregation modes: `dayAggregation` collapses several
// readings within one calendar day, `aggregation` combines across a period.
// Both use the same reducer here so "resting HR: minimum of the day, averaged
// over the week" is expressible with two independent settings.

// Combines numeric values by mode. `last` needs the values in chronological
// order (oldest → newest); the caller guarantees that.
function reduce(values, mode) {
  const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  switch (mode) {
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min': return Math.min(...nums);
    case 'max': return Math.max(...nums);
    case 'last':
    default: return nums[nums.length - 1];
  }
}

// Local calendar day (YYYY-MM-DD) of a reading, honouring an optional minutes
// offset from UTC so an evening reading in a non-UTC zone lands on its real day.
function dayKey(date, tzOffsetMinutes = 0) {
  const shifted = new Date(new Date(date).getTime() + tzOffsetMinutes * 60000);
  return shifted.toISOString().slice(0, 10);
}

// One value per day from raw {date, value} logs, applying the metric's
// day-aggregation. Returns a Map dayKey → value, values already reduced.
function dailySeries(logs, dayMode, tzOffsetMinutes = 0) {
  const byDay = new Map();
  const ordered = [...logs].sort((a, b) => new Date(a.date) - new Date(b.date));
  for (const log of ordered) {
    const key = dayKey(log.date, tzOffsetMinutes);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(log.value);
  }
  const out = new Map();
  for (const [key, values] of byDay) out.set(key, reduce(values, dayMode));
  return out;
}

// A single period value from raw logs: first collapse to daily values (day
// mode), then combine those across the period (period mode). This is what a
// goal like "average resting HR <= 55 over the week" evaluates.
function periodValue(logs, dayMode, periodMode, tzOffsetMinutes = 0) {
  const daily = [...dailySeries(logs, dayMode, tzOffsetMinutes).values()];
  return reduce(daily, periodMode);
}

// The most recent reading's value (newest by date), or null.
function latestValue(logs) {
  if (!Array.isArray(logs) || logs.length === 0) return null;
  const newest = logs.reduce((a, b) => (new Date(a.date) >= new Date(b.date) ? a : b));
  return newest.value;
}

module.exports = { reduce, dayKey, dailySeries, periodValue, latestValue };
