import { useState, useEffect } from 'react';
import { format, parseISO, startOfWeek, addDays, subWeeks, isAfter } from 'date-fns';
import { de } from 'date-fns/locale';
import api from '../utils/api';
import { Skeleton, chipColorFor } from './ui';
import { levelFor, EMPTY_CELL } from '../utils/heatmap';

// GitHub-style heatmap for one goal: columns = weeks (oldest left), rows =
// Mo–So. Each cell shows the day's contribution towards the goal's first
// condition metric (server-computed), scaled against the best day in range —
// the same visual language as the habit heatmaps, so goals and habits can sit
// side by side in the share view.

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

const METRIC_LABELS = {
  count: 'Einträge',
  duration: 'min',
  distance: 'km',
  value: '',
};

export default function GoalHeatmap({ goal, showLegend = true }) {
  const [data, setData] = useState(null);

  const today = new Date();
  const gridStart = startOfWeek(subWeeks(today, WEEKS - 1), { weekStartsOn: 1 });

  useEffect(() => {
    api.get(`/goals/${goal._id}/heatmap`, { params: { weeks: WEEKS } })
      .then(res => setData(res.data))
      .catch(() => setData({ days: {} }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal._id]);

  if (data === null) {
    return <Skeleton className="h-24 mt-4" />;
  }

  // Periodic goals: one tile per interval — achieved, nearly missed or
  // missed, with the running interval marked.
  if (data.kind === 'intervals') {
    const levels = TONE_LEVELS[chipColorFor(goal._id)] ?? TONE_LEVELS.amber;
    const unit = data.unitSymbol || METRIC_LABELS[data.metric] || '';
    const intervalLabel = data.intervalValue === 1
      ? { day: 'Tag', week: 'Woche', month: 'Monat' }[data.intervalUnit] || 'Intervall'
      : `${data.intervalValue} ${{ day: 'Tage', week: 'Wochen', month: 'Monate' }[data.intervalUnit] || 'Intervalle'}`;

    return (
      <div className="mt-4">
        <div className="flex gap-1" aria-label="Zielerreichung pro Intervall">
          {(data.intervals || []).map((iv, i) => {
            // Nearness to the target: met = full colour, near miss = strong,
            // half way = medium, some progress = dim, nothing = empty.
            const target = iv.targetValue || 0;
            const ratio = iv.met ? 1
              : iv.condition === 'max'
                ? (iv.value > 0 && target >= 0 ? Math.min(target / iv.value, 0.99) : 0)
                : (target > 0 ? Math.min(iv.value / target, 0.99) : 0);
            const cls = iv.met ? levels[3]
              : ratio >= 0.9 ? levels[2]
              : ratio >= 0.5 ? levels[1]
              : iv.value > 0 ? levels[0]
              : EMPTY_CELL;
            const range = `${format(parseISO(iv.start), 'd. MMM', { locale: de })} – ${format(parseISO(iv.end), 'd. MMM', { locale: de })}`;
            const status = iv.met ? 'erreicht' : ratio >= 0.9 ? 'knapp verfehlt' : 'nicht erreicht';
            return (
              <div
                key={i}
                title={`${range}: ${iv.value} / ${iv.targetValue}${unit ? ` ${unit}` : ''} – ${status}${iv.current ? ' (läuft noch)' : ''}`}
                className={`h-6 flex-1 max-w-8 rounded-[4px] ${cls} ${iv.current ? 'ring-1 ring-inset ring-ink-900/25' : ''}`}
              />
            );
          })}
        </div>
        {showLegend && (
          <div className="flex items-center justify-between mt-2">
            <p className="text-[11px] text-ink-400">Ein Feld = {intervalLabel}</p>
            <div className="flex items-center gap-1" aria-hidden="true">
              <span className="text-[10px] text-ink-400 mr-0.5">Verfehlt</span>
              <span className={`w-2.5 h-2.5 rounded-[3px] ${EMPTY_CELL}`} />
              {levels.map(l => <span key={l} className={`w-2.5 h-2.5 rounded-[3px] ${l}`} />)}
              <span className="text-[10px] text-ink-400 ml-0.5">Erreicht</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  const days = data.days || {};
  const max = Math.max(0, ...Object.values(days));
  const levels = TONE_LEVELS[chipColorFor(goal._id)] ?? TONE_LEVELS.amber;
  const unit = data.unitSymbol || METRIC_LABELS[data.metric] || '';

  const weeksArr = Array.from({ length: WEEKS }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(gridStart, w * 7 + d))
  );

  return (
    <div className="mt-4">
      <div className="flex gap-1 justify-between" aria-label={`Verlauf der letzten ${WEEKS} Wochen`}>
        {weeksArr.map((weekDays, wi) => (
          <div key={wi} className="flex flex-col gap-1 flex-1 anim-item" style={{ animationDelay: `${wi * 20}ms` }}>
            {weekDays.map(day => {
              const future = isAfter(day, today);
              const key = format(day, 'yyyy-MM-dd');
              const value = days[key];

              let cls = 'opacity-0'; // future days keep the grid shape invisibly
              if (!future) {
                cls = value == null || max === 0
                  ? EMPTY_CELL
                  : levels[levelFor(value / max)];
              }

              const label = future ? '' : `${format(day, 'd. MMM', { locale: de })}: ${
                value == null ? 'kein Beitrag' : `${value}${unit ? ` ${unit}` : ''}`
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

      {showLegend && (
        <div className="flex items-center justify-between mt-2">
          <p className="text-[11px] text-ink-400">Letzte {WEEKS} Wochen</p>
          <div className="flex items-center gap-1" aria-hidden="true">
            <span className="text-[10px] text-ink-400 mr-0.5">Weniger</span>
            <span className={`w-2.5 h-2.5 rounded-[3px] ${EMPTY_CELL}`} />
            {levels.map(l => <span key={l} className={`w-2.5 h-2.5 rounded-[3px] ${l}`} />)}
            <span className="text-[10px] text-ink-400 ml-0.5">Mehr</span>
          </div>
        </div>
      )}
    </div>
  );
}
