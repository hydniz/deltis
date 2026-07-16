import { useState, useEffect } from 'react';
import { format, parseISO, startOfWeek, addDays, subWeeks, isAfter } from 'date-fns';
import { de } from 'date-fns/locale';
import api from '../utils/api';
import { Skeleton, chipColorFor } from './ui';
import { progressRatio, formatTarget } from '../utils/habitTarget';
import { levelFor, EMPTY_CELL } from '../utils/heatmap';

// GitHub-style dot heatmap for one habit: columns = weeks (oldest left),
// rows = Mo–So. Saturation encodes progress towards the daily target —
// full colour = fulfilled, lighter shades = partial, dim = missed max-target.

const WEEKS = 16;

// Complete class literals per tone so Tailwind's JIT picks them up.
const TONE_LEVELS = {
  clay:  ['bg-brand-500/25', 'bg-brand-500/45', 'bg-brand-500/70', 'bg-brand-500'],
  sage:  ['bg-sage-500/25', 'bg-sage-500/45', 'bg-sage-500/70', 'bg-sage-500'],
  amber: ['bg-ocher-400/25', 'bg-ocher-400/45', 'bg-ocher-400/70', 'bg-ocher-400'],
  rose:  ['bg-rose-500/25', 'bg-rose-500/45', 'bg-rose-500/70', 'bg-rose-500'],
  olive: ['bg-lime-600/25', 'bg-lime-600/45', 'bg-lime-600/70', 'bg-lime-600'],
  stone: ['bg-ink-500/25', 'bg-ink-500/45', 'bg-ink-500/70', 'bg-ink-500'],
};
export default function HabitHeatmap({ habit }) {
  const [logsByDay, setLogsByDay] = useState(null);

  const today = new Date();
  const gridStart = startOfWeek(subWeeks(today, WEEKS - 1), { weekStartsOn: 1 });

  useEffect(() => {
    api.get('/habits/logs', {
      params: {
        habitId: habit._id,
        startDate: gridStart.toISOString(),
        endDate: today.toISOString(),
      },
    }).then(res => {
      const map = {};
      for (const log of res.data) {
        map[format(parseISO(log.date), 'yyyy-MM-dd')] = log.value;
      }
      setLogsByDay(map);
    }).catch(() => setLogsByDay({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habit._id]);

  if (logsByDay === null) {
    return <Skeleton className="h-24 mt-4" />;
  }

  const levels = TONE_LEVELS[chipColorFor(habit._id)] ?? TONE_LEVELS.clay;
  const isBoolean = habit.type === 'boolean';

  const weeks = Array.from({ length: WEEKS }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(gridStart, w * 7 + d))
  );

  return (
    <div className="mt-4">
      <div className="flex gap-1 justify-between" aria-label={`Verlauf der letzten ${WEEKS} Wochen`}>
        {weeks.map((days, wi) => (
          <div key={wi} className="flex flex-col gap-1 flex-1">
            {days.map(day => {
              const future = isAfter(day, today);
              const key = format(day, 'yyyy-MM-dd');
              const value = logsByDay[key] ?? null;
              const ratio = future ? null : progressRatio(habit, value);

              let cls = 'opacity-0'; // future days keep the grid shape invisibly
              if (!future) cls = ratio === null ? EMPTY_CELL : levels[levelFor(ratio)];

              const label = future ? '' : `${format(day, 'd. MMM', { locale: de })}: ${
                value === null ? 'kein Eintrag'
                  : isBoolean ? 'erledigt'
                  : `${value} ${habit.unitSymbol}`
              }`;

              return (
                <div
                  key={key}
                  title={label}
                  className={`aspect-square w-full rounded-[3px] ${cls}`}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mt-2">
        <p className="text-[11px] text-ink-400">
          {formatTarget(habit) ? `Ziel: ${formatTarget(habit)}` : `Letzte ${WEEKS} Wochen`}
        </p>
        <div className="flex items-center gap-1" aria-hidden="true">
          <span className="text-[10px] text-ink-400 mr-0.5">Weniger</span>
          <span className={`w-2.5 h-2.5 rounded-[3px] ${EMPTY_CELL}`} />
          {levels.map(l => <span key={l} className={`w-2.5 h-2.5 rounded-[3px] ${l}`} />)}
          <span className="text-[10px] text-ink-400 ml-0.5">Mehr</span>
        </div>
      </div>
    </div>
  );
}
