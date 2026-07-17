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

// Human-readable schedule label: 'nur am 20. Juli', 'Mo · Mi · Fr',
// 'alle 3 Tage', 'nach: Running' … or '' for daily.
export function formatScheduleBadge(habit) {
  if (habit.scheduleMode === 'interval' && habit.scheduleIntervalDays) {
    return `alle ${habit.scheduleIntervalDays} Tage`;
  }
  if (habit.scheduleMode === 'trigger' && habit.scheduleTrigger) {
    const t = habit.scheduleTrigger;
    const name = t.sport || t.refName || 'Ereignis';
    return t.direction === 'before' ? `vor: ${name}` : `nach: ${name}`;
  }
  if (habit.scheduleDate) {
    return `nur am ${format(parseISO(habit.scheduleDate), 'd. MMMM', { locale: de })}`;
  }
  if (habit.scheduleDays?.length) return formatScheduleDays(habit.scheduleDays);
  return '';
}

// Explains a due-reason from GET /api/habits/due — the "Warum steht das
// heute im Planer?" text.
export function formatDueReason(reason) {
  if (!reason) return '';
  if (reason.kind === 'daily') return 'Steht täglich an.';
  if (reason.kind === 'weekly') return `Geplante Wochentage: ${formatScheduleDays(reason.days)}.`;
  if (reason.kind === 'date') {
    return `Einmalig geplant für den ${format(parseISO(reason.date), 'd. MMMM', { locale: de })}.`;
  }
  if (reason.kind === 'interval') {
    return `Alle ${reason.intervalDays} Tage fällig (gezählt ab ${format(parseISO(reason.anchorDate), 'd. MMMM', { locale: de })}).`;
  }
  if (reason.kind === 'trigger') {
    const date = format(parseISO(reason.sourceDate), 'd. MMMM', { locale: de });
    if (reason.direction === 'before') {
      return reason.offsetDays === 0
        ? `Weil „${reason.sourceName}“ heute geplant ist.`
        : `Weil am ${date} „${reason.sourceName}“ geplant ist (${reason.offsetDays} ${reason.offsetDays === 1 ? 'Tag' : 'Tage'} vorher).`;
    }
    return reason.offsetDays === 0
      ? `Weil an diesem Tag „${reason.sourceName}“ gemacht wurde.`
      : `Weil am ${date} „${reason.sourceName}“ gemacht wurde (${reason.offsetDays} ${reason.offsetDays === 1 ? 'Tag' : 'Tage'} danach).`;
  }
  return '';
}
