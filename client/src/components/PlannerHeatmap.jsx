import { useState, useEffect, useMemo } from 'react';
import { format, startOfWeek, addDays, subWeeks, isAfter } from 'date-fns';
import { de } from 'date-fns/locale';
import api from '../utils/api';
import { Skeleton, Segmented } from './ui';
import { levelFor, EMPTY_CELL } from '../utils/heatmap';

// GitHub-style heatmap of the weekly-plan completion: columns = weeks (oldest
// left), rows = Mo–So. Each cell encodes how much of that day's planned items
// were completed — full colour = everything done, lighter shades = partial,
// dim = nothing done, neutral = nothing planned.

const WEEKS = 12;

// Complete class literals so Tailwind's JIT picks them up.
const LEVELS = ['bg-brand-500/25', 'bg-brand-500/45', 'bg-brand-500/70', 'bg-brand-500'];

const FILTERS = [
  { value: 'all', label: 'Alle' },
  { value: 'activities', label: 'Aktivitäten' },
  { value: 'habits', label: 'Gewohnheiten' },
];

export default function PlannerHeatmap() {
  const [plans, setPlans] = useState(null); // { activities: [...], habits: [...] }
  const [filter, setFilter] = useState('all');

  const today = new Date();
  const gridStart = startOfWeek(subWeeks(today, WEEKS - 1), { weekStartsOn: 1 });

  useEffect(() => {
    const params = {
      startDate: format(gridStart, 'yyyy-MM-dd'),
      endDate: format(today, 'yyyy-MM-dd'),
    };
    Promise.all([
      api.get('/planner', { params }),
      api.get('/planner/habits', { params }),
    ]).then(([actRes, habRes]) => {
      setPlans({ activities: actRes.data, habits: habRes.data });
    }).catch(() => setPlans({ activities: [], habits: [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Per-day completion tally { 'yyyy-MM-dd': { total, done } } for the active filter.
  const byDay = useMemo(() => {
    if (plans === null) return {};
    const included = [
      ...(filter !== 'habits' ? plans.activities : []),
      ...(filter !== 'activities' ? plans.habits : []),
    ];
    const map = {};
    for (const plan of included) {
      const key = (plan.scheduledDate || '').slice(0, 10);
      map[key] ??= { total: 0, done: 0 };
      map[key].total += 1;
      if (plan.completed) map[key].done += 1;
    }
    return map;
  }, [plans, filter]);

  return (
    <div className="card p-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-ink-400">
            Planungsverlauf
          </p>
          <p className="text-xs text-ink-400 mt-0.5">
            Erledigte Pläne der letzten {WEEKS} Wochen
          </p>
        </div>
        <Segmented options={FILTERS} value={filter} onChange={setFilter} className="self-start sm:self-auto" />
      </div>

      {plans === null ? (
        <Skeleton className="h-32 max-w-lg" />
      ) : (
        <div className="max-w-lg">
          <div className="flex gap-1 justify-between" aria-label={`Planungsverlauf der letzten ${WEEKS} Wochen`}>
            {Array.from({ length: WEEKS }, (_, w) => (
              <div key={w} className="flex flex-col gap-1 flex-1">
                {Array.from({ length: 7 }, (_, d) => {
                  const day = addDays(gridStart, w * 7 + d);
                  const key = format(day, 'yyyy-MM-dd');
                  const future = isAfter(day, today);
                  const tally = byDay[key];

                  let cls = 'opacity-0'; // future days keep the grid shape invisibly
                  if (!future) cls = tally ? LEVELS[levelFor(tally.done / tally.total)] : EMPTY_CELL;

                  const label = future ? '' : `${format(day, 'd. MMM', { locale: de })}: ${
                    tally ? `${tally.done} von ${tally.total} erledigt` : 'keine Pläne'
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

          <div className="flex items-center justify-end mt-2">
            <div className="flex items-center gap-1" aria-hidden="true">
              <span className="text-[10px] text-ink-400 mr-0.5">Weniger</span>
              <span className={`w-2.5 h-2.5 rounded-[3px] ${EMPTY_CELL}`} />
              {LEVELS.map(l => <span key={l} className={`w-2.5 h-2.5 rounded-[3px] ${l}`} />)}
              <span className="text-[10px] text-ink-400 ml-0.5">Mehr</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
