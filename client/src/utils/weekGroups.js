// Helpers for splitting a date-sorted list into ISO-week groups so lists can
// show a divider when a new week starts.
import {
  parseISO, isValid, getISOWeek, getISOWeekYear, startOfISOWeek, isSameISOWeek, subWeeks, format,
} from 'date-fns';
import { de } from 'date-fns/locale';

function toDate(date) {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return isValid(d) ? d : null;
}

// A stable key for the ISO week a date falls in.
export function weekKey(date) {
  const d = toDate(date);
  if (!d) return 'unknown';
  return `${getISOWeekYear(d)}-${String(getISOWeek(d)).padStart(2, '0')}`;
}

// Human label: "Diese Woche", "Letzte Woche", or "Woche vom 5. Mai".
export function weekLabel(date) {
  const d = toDate(date);
  if (!d) return '';
  const now = new Date();
  if (isSameISOWeek(d, now)) return 'Diese Woche';
  if (isSameISOWeek(d, subWeeks(now, 1))) return 'Letzte Woche';
  return `Woche vom ${format(startOfISOWeek(d), 'd. MMMM', { locale: de })}`;
}

// Marks the items that begin a new week (used to render a divider before them).
// `items` should already be in display order; `getDate` extracts each date.
export function markWeekStarts(items, getDate) {
  let prev = null;
  return items.map(item => {
    const key = weekKey(getDate(item));
    const newWeek = key !== prev;
    prev = key;
    return { item, newWeek, weekLabel: newWeek ? weekLabel(getDate(item)) : null };
  });
}
