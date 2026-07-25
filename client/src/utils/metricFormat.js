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

// The special "duration as HH:MM" unit for habits. The value is a DURATION in
// HOURS (fractional) — the same unit the health metrics and goals use, so a
// sleep habit auto-filled with 8.2667 h and a goal of "8" line up — and it is
// entered/shown as elapsed hours:minutes (8.2667 → "8:16"), never a clock time.
export const HM_UNIT = 'HH:MM';
export function isHmUnit(unit) { return unit === HM_UNIT; }

// Hours → elapsed "8:16" (or "0:05"). Null-safe.
export function formatHM(hours) {
  if (hours == null || !Number.isFinite(hours)) return '–';
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

// "HH:MM" (from a time input) → hours (fractional). Invalid → null.
export function parseHM(value) {
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) / 60;
}

// Hours → "HH:MM" for a native time input's value.
export function hoursToTimeInput(hours) {
  if (hours == null || !Number.isFinite(hours)) return '';
  const totalMin = Math.round(hours * 60);
  return `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
}
