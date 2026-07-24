// Shared value formatting for metrics and hour-based habits.
//
// Hour values read badly as decimals ("7,5 h"), so anything measured in hours
// is rendered as "7 h 30 min". Everything else keeps its numeric formatting.

// True for a value the user thinks of in hours (a duration metric in 'h', or a
// habit whose unit is 'h'/'Stunden').
export function isHoursUnit(unit) {
  return unit === 'h' || unit === 'Std' || unit === 'Std.' || unit === 'Stunden';
}

// A plain number with German grouping at the given precision.
export function formatNumber(value, decimals = 1) {
  if (value == null || !Number.isFinite(value)) return '–';
  return value.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// "7 h 30 min" from a value in hours. Whole hours drop the minutes, sub-hour
// values drop the hours.
export function formatHoursMinutes(value) {
  if (value == null || !Number.isFinite(value)) return '–';
  const sign = value < 0 ? '-' : '';
  const totalMin = Math.round(Math.abs(value) * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${sign}${m} min`;
  if (m === 0) return `${sign}${h} h`;
  return `${sign}${h} h ${m} min`;
}

// Formats a value + unit for display. Hour units become "h min" and carry no
// trailing unit; everything else returns { text, unit } to render separately.
export function formatValueUnit(value, { unit = '', decimals = 1 } = {}) {
  if (isHoursUnit(unit)) return { text: formatHoursMinutes(value), unit: '' };
  return { text: formatNumber(value, decimals), unit };
}
