import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

// Shared helpers for habit schedules. Two mechanisms, `scheduleDate` wins:
// - `scheduleDate` ('YYYY-MM-DD'): one-off habit, only due on that local date.
// - `scheduleDays` (JS getDay() values, 0 = Sunday … 6 = Saturday): weekly
//   rhythm; an empty array means the habit is tracked every day (default).

export const WEEKDAYS = [
  { value: 1, label: 'Mo' },
  { value: 2, label: 'Di' },
  { value: 3, label: 'Mi' },
  { value: 4, label: 'Do' },
  { value: 5, label: 'Fr' },
  { value: 6, label: 'Sa' },
  { value: 0, label: 'So' },
];

const toLocalDateString = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function isDueOn(habit, date = new Date()) {
  if (habit.scheduleDate) return habit.scheduleDate === toLocalDateString(date);
  if (!habit.scheduleDays?.length) return true;
  return habit.scheduleDays.includes(date.getDay());
}

// 'Mo · Mi · Fr' in Monday-first display order; '' when unscheduled (daily).
export function formatScheduleDays(days = []) {
  return WEEKDAYS.filter(w => days.includes(w.value)).map(w => w.label).join(' · ');
}

// Human-readable schedule label: 'nur am 20. Juli', 'Mo · Mi · Fr' or ''.
export function formatScheduleBadge(habit) {
  if (habit.scheduleDate) {
    return `nur am ${format(parseISO(habit.scheduleDate), 'd. MMMM', { locale: de })}`;
  }
  if (habit.scheduleDays?.length) return formatScheduleDays(habit.scheduleDays);
  return '';
}
