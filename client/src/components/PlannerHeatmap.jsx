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
//
// The Strava view shows the synced activities instead: intensity = number of
// activities that day. Days where none of the activities fulfilled a planned
// training render as circles instead of squares, so spontaneous sessions stay
// visible but clearly distinguishable from planned ones.

const WEEKS = 12;

// Complete class literals so Tailwind's JIT picks them up.
const LEVELS = ['bg-brand-500/25', 'bg-brand-500/45', 'bg-brand-500/70', 'bg-brand-500'];
const STRAVA_LEVELS = ['bg-[#FC4C02]/30', 'bg-[#FC4C02]/50', 'bg-[#FC4C02]/75', 'bg-[#FC4C02]'];

const FILTERS = [
  { value: 'all', label: 'Alle' },
  { value: 'activities', label: 'Aktivitäten' },
  { value: 'habits', label: 'Gewohnheiten' },
  { value: 'trainings', label: 'Trainings' },
  { value: 'strava', label: 'Strava' },
];

export default function PlannerHeatmap() {
  // { activities: [...], habits: [...], trainings: [...], strava: [...] }
  const [plans, setPlans] = useState(null);
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
      api.get('/planner/trainings', { params }).catch(() => ({ data: [] })),
      // Buffer both ends: the server filters on UTC start time, the local
      // date decides which cell an activity belongs to.
      api.get('/strava/activities', {
        params: {
          startDate: format(addDays(gridStart, -1), 'yyyy-MM-dd'),
          endDate: format(addDays(today, 2), 'yyyy-MM-dd'),
          limit: 200,
        },
      }).catch(() => ({ data: { activities: [] } })),
    ]).then(([actRes, habRes, trainRes, stravaRes]) => {
      setPlans({
        activities: actRes.data,
        habits: habRes.data,
        trainings: trainRes.data,
        strava: stravaRes.data.activities || [],
      });
    }).catch(() => setPlans({ activities: [], habits: [], trainings: [], strava: [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isStravaView = filter === 'strava';

  // Per-day completion tally { 'yyyy-MM-dd': { total, done } } for plan views.
  const byDay = useMemo(() => {
    if (plans === null || isStravaView) return {};
    const included = [
      ...(filter === 'all' || filter === 'activities' ? plans.activities : []),
      ...(filter === 'all' || filter === 'habits' ? plans.habits : []),
      ...(filter === 'all' || filter === 'trainings' ? plans.trainings : []),
    ];
    const map = {};
    for (const plan of included) {
      const key = (plan.scheduledDate || '').slice(0, 10);
      map[key] ??= { total: 0, done: 0 };
      map[key].total += 1;
      if (plan.completed) map[key].done += 1;
    }
    return map;
  }, [plans, filter, isStravaView]);

  // Per-day Strava tally { 'yyyy-MM-dd': { count, claimed } } — claimed =
  // how many of the day's activities fulfilled a planned training.
  const stravaByDay = useMemo(() => {
    if (plans === null) return {};
    const claimedIds = new Set(
      plans.trainings.flatMap(p => (p.matchedActivities || []).map(m => m.id))
    );
    const map = {};
    for (const activity of plans.strava) {
      const key = ((activity.startDateLocal || activity.startDate) || '').slice(0, 10);
      map[key] ??= { count: 0, claimed: 0 };
      map[key].count += 1;
      if (claimedIds.has(activity._id)) map[key].claimed += 1;
    }
    return map;
  }, [plans]);

  const levels = isStravaView ? STRAVA_LEVELS : LEVELS;

  return (
    <div className="card p-4 anim-item" style={{ animationDelay: '160ms' }}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-ink-400">
            Planungsverlauf
          </p>
          <p className="text-xs text-ink-400 mt-0.5">
            {isStravaView
              ? `Synchronisierte Aktivitäten der letzten ${WEEKS} Wochen`
              : `Erledigte Pläne der letzten ${WEEKS} Wochen`}
          </p>
        </div>
        <Segmented options={FILTERS} value={filter} onChange={setFilter} className="self-start sm:self-auto" />
      </div>

      {plans === null ? (
        <Skeleton className="h-28 w-60" />
      ) : (
        // The grid stretches across the card (like the habit heatmaps) so
        // the cells stay comfortably readable instead of tiny fixed squares.
        <div className="flex flex-col">
          <div className="flex gap-[3px] sm:gap-1 justify-between" aria-label={`Planungsverlauf der letzten ${WEEKS} Wochen`}>
            {Array.from({ length: WEEKS }, (_, w) => (
              <div key={w} className="flex flex-col gap-[3px] sm:gap-1 flex-1">
                {Array.from({ length: 7 }, (_, d) => {
                  const day = addDays(gridStart, w * 7 + d);
                  const key = format(day, 'yyyy-MM-dd');
                  const future = isAfter(day, today);

                  let cls = 'opacity-0'; // future days keep the grid shape invisibly
                  let shape = 'rounded-[3px]';
                  let label = '';

                  if (!future && isStravaView) {
                    const tally = stravaByDay[key];
                    cls = tally ? STRAVA_LEVELS[Math.min(tally.count - 1, 3)] : EMPTY_CELL;
                    // A day whose activities were all unplanned reads as a
                    // circle — done, but not part of the plan.
                    if (tally && tally.claimed === 0) shape = 'rounded-full';
                    label = `${format(day, 'd. MMM', { locale: de })}: ${
                      tally
                        ? `${tally.count} ${tally.count === 1 ? 'Aktivität' : 'Aktivitäten'}${
                            tally.claimed > 0
                              ? ` · ${tally.claimed} geplant erfüllt`
                              : ' · nicht geplant'
                          }`
                        : 'keine Aktivitäten'
                    }`;
                  } else if (!future) {
                    const tally = byDay[key];
                    cls = tally ? LEVELS[levelFor(tally.done / tally.total)] : EMPTY_CELL;
                    label = `${format(day, 'd. MMM', { locale: de })}: ${
                      tally ? `${tally.done} von ${tally.total} erledigt` : 'keine Pläne'
                    }`;
                  }

                  return (
                    <div
                      key={key}
                      title={label}
                      className={`aspect-square w-full ${shape} ${cls}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mt-2 gap-3">
            {isStravaView ? (
              <p className="text-[10px] text-ink-400 flex items-center gap-1.5" aria-hidden="true">
                <span className="w-2.5 h-2.5 rounded-[3px] bg-[#FC4C02]/75" /> geplant
                <span className="w-2.5 h-2.5 rounded-full bg-[#FC4C02]/75 ml-1" /> spontan
              </p>
            ) : <span />}
            <div className="flex items-center gap-1" aria-hidden="true">
              <span className="text-[10px] text-ink-400 mr-0.5">Weniger</span>
              <span className={`w-2.5 h-2.5 rounded-[3px] ${EMPTY_CELL}`} />
              {levels.map(l => <span key={l} className={`w-2.5 h-2.5 rounded-[3px] ${l}`} />)}
              <span className="text-[10px] text-ink-400 ml-0.5">Mehr</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
