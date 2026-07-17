import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import {
  format, startOfWeek, endOfWeek, startOfDay, endOfDay, isToday, parseISO,
} from 'date-fns';
import { de } from 'date-fns/locale';
import {
  Dumbbell, Scale, Target, Calendar, CalendarDays, Sparkles, ArrowRight,
  Check, Circle,
} from 'lucide-react';
import {
  Stat, Chip, chipColorFor, Input, Button, Skeleton, TONE_BUBBLE,
} from '../components/ui';
import { isDueOn, formatScheduleBadge } from '../utils/habitSchedule';
import { meetsTarget, formatTarget } from '../utils/habitTarget';
import { getSessionGreeting, splitGreeting } from '../utils/greetings';

// Feed-style start page: greeting, key stats, then everything that matters
// today — due habits (with quick logging), the day's plan, this week's
// activities, goals and quick access.

const ACTIVITY_LABELS = {
  gym: 'Gym', jogging: 'Joggen', cycling: 'Radfahren', swimming: 'Schwimmen',
  yoga: 'Yoga', hiking: 'Wandern', sports: 'Sport', other: 'Sonstiges'
};

function SectionCard({ icon: Icon, tone = 'clay', title, linkTo, linkLabel = 'Alle', children }) {
  return (
    // min-w-0: as a grid/flex child the card must be allowed to shrink below
    // its content width, otherwise long entries push the page past the phone
    // screen edge.
    <div className="card min-w-0">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="display text-lg flex items-center gap-2.5">
          <span className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${TONE_BUBBLE[tone]}`}>
            <Icon size={14} />
          </span>
          {title}
        </h2>
        {linkTo && (
          <Link
            to={linkTo}
            className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors"
          >
            {linkLabel} <ArrowRight size={12} />
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

function EmptyHint({ children }) {
  return <p className="px-4 pb-4 pt-1 text-sm text-ink-400">{children}</p>;
}

// Compact quick-log row for a habit that is due today. Fulfilment follows
// the habit's completion target (min/max/exact) — a logged value that misses
// the target shows in amber instead of green.
function TodayHabitRow({ habit, log, onLog }) {
  const [value, setValue] = useState(log?.value ?? '');
  const [saving, setSaving] = useState(false);
  const tone = chipColorFor(habit._id);
  const isBoolean = habit.type === 'boolean';
  const fulfilled = log != null && meetsTarget(habit, log.value);

  useEffect(() => { setValue(log?.value ?? ''); }, [log]);

  const submit = async (logValue) => {
    setSaving(true);
    try {
      await api.post('/habits/logs', {
        habitId: habit._id,
        date: new Date().toISOString(),
        value: logValue,
      });
      onLog();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (value === '') return;
    submit(+value);
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${TONE_BUBBLE[tone]}`}>
        {fulfilled ? <Check size={15} strokeWidth={3} className="anim-check" /> : <Sparkles size={14} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink-800 truncate">{habit.name}</p>
        <p className="text-xs text-ink-400 truncate">
          {log ? (
            fulfilled ? (
              <span className="text-emerald-600 font-medium">
                {isBoolean ? 'Erledigt' : `${log.value} ${habit.unitSymbol} – erfüllt`}
              </span>
            ) : (
              <span className="text-ocher-600 font-medium">
                {log.value} {habit.unitSymbol} · Ziel: {formatTarget(habit)}
              </span>
            )
          ) : (
            <>
              {isBoolean ? 'Ja/Nein' : `in ${habit.unitSymbol}`}
              {formatTarget(habit) && ` · ${formatTarget(habit)}`}
              {formatScheduleBadge(habit) && ` · ${formatScheduleBadge(habit)}`}
            </>
          )}
        </p>
      </div>
      {isBoolean ? (
        !log && (
          <Button size="sm" icon={Check} loading={saving} onClick={() => submit(1)} className="flex-shrink-0">
            Erledigt
          </Button>
        )
      ) : (
        <form onSubmit={handleSubmit} className="flex items-center gap-1.5 flex-shrink-0">
          <Input
            type="number"
            value={value}
            onChange={e => setValue(e.target.value)}
            className="!w-20 !py-1.5 !text-sm"
            placeholder={habit.unitSymbol}
            min="0"
            step="0.1"
          />
          <Button type="submit" size="sm" loading={saving} disabled={value === ''}>
            {log ? <Check size={14} /> : 'OK'}
          </Button>
        </form>
      )}
    </div>
  );
}

// One planned item (activity or habit plan) with completion state.
function PlanRow({ label, meta, completed, color }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 min-w-0">
      <span className={`flex-shrink-0 ${completed ? 'text-emerald-500' : 'text-ink-300'}`}>
        {completed ? <Check size={16} strokeWidth={3} className="anim-check" /> : <Circle size={14} />}
      </span>
      {/* Long plan names must shrink inside the pill instead of pushing the row wide */}
      <Chip color={color} className="max-w-[55%] overflow-hidden">
        <span className="truncate">{label}</span>
      </Chip>
      <span className="text-xs text-ink-400 truncate flex-1">{meta}</span>
      {completed && <span className="text-xs font-medium text-emerald-600 flex-shrink-0">Erledigt</span>}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState({
    definitions: [], habitLogs: [], activities: [], activityTotal: 0, stravaTotal: 0,
    activityPlans: [], habitPlans: [], trainingPlans: [], dueToday: null, weight: null, goals: [],
  });
  const [loading, setLoading] = useState(true);
  // Stable for the whole browser-tab session; rotates in a new tab,
  // after logout, or when the time of day moves into the next slot.
  const [greeting] = useState(() => splitGreeting(getSessionGreeting(new Date())));

  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

  const load = useCallback(async () => {
    const dayStart = startOfDay(new Date()).toISOString();
    const dayEnd = endOfDay(new Date()).toISOString();
    try {
      const dayParam = format(new Date(), 'yyyy-MM-dd');
      const [defsRes, logsRes, actRes, stravaRes, planRes, habitPlanRes, trainingPlanRes, dueRes, weightRes, goalRes] = await Promise.all([
        api.get('/habits/definitions'),
        api.get('/habits/logs', { params: { startDate: dayStart, endDate: dayEnd } }),
        api.get('/activities', {
          params: { startDate: weekStart.toISOString(), endDate: weekEnd.toISOString(), limit: 10 }
        }),
        // Integration activities count towards "this week" too — a missing
        // integration simply yields zero.
        api.get('/strava/activities', {
          params: { startDate: format(weekStart, 'yyyy-MM-dd'), endDate: format(weekEnd, 'yyyy-MM-dd'), limit: 1 },
        }).catch(() => ({ data: { activities: [], total: 0 } })),
        api.get('/planner', { params: { startDate: dayStart, endDate: dayEnd } }),
        api.get('/planner/habits', { params: { startDate: dayStart, endDate: dayEnd } }),
        // Planned trainings are keyed by calendar day, not timestamps —
        // missing integration simply yields an empty list.
        api.get('/planner/trainings', { params: { startDate: dayParam, endDate: dayParam } })
          .catch(() => ({ data: [] })),
        // Due habits incl. extended schedules (interval, event triggers) —
        // the server knows why something is due; fall back to the local
        // schedule check when the endpoint is unavailable.
        api.get('/habits/due', { params: { startDate: dayParam, endDate: dayParam } })
          .catch(() => ({ data: null })),
        api.get('/weight', { params: { limit: 1 } }),
        api.get('/goals'),
      ]);
      setData({
        definitions: defsRes.data,
        habitLogs: logsRes.data,
        activities: actRes.data.activities || [],
        activityTotal: actRes.data.total ?? (actRes.data.activities || []).length,
        stravaTotal: stravaRes.data.total ?? 0,
        activityPlans: planRes.data,
        habitPlans: habitPlanRes.data,
        trainingPlans: trainingPlanRes.data,
        dueToday: dueRes.data,
        weight: weightRes.data[0] || null,
        goals: goalRes.data || [],
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const { before, after } = greeting;

  // Skeleton mirroring the page layout — calmer than a spinner and the
  // greeting header can already render while the data loads.
  if (loading) {
    return (
      <div className="space-y-6">
        <header>
          <p className="text-[11px] text-ink-400 uppercase tracking-[0.14em] font-semibold mb-1.5">
            {format(now, 'EEEE, d. MMMM yyyy', { locale: de })}
          </p>
          <h1 className="display text-3xl sm:text-[2.5rem] sm:leading-tight">
            {before}
            <span className="italic font-normal text-brand-600">
              {user?.name?.split(' ')[0]}
            </span>
            {after}
          </h1>
        </header>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-28 sm:h-32 rounded-2xl" />)}
        </div>
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }

  const getLog = (habitId) =>
    data.habitLogs.find(l => l.habitId?._id === habitId || l.habitId === habitId);

  // Due habits: server-computed when available (knows interval + trigger
  // schedules), otherwise the local check for the basic modes.
  const dueIds = data.dueToday === null ? null : new Set(data.dueToday.map(d => d.habitId));
  const dueHabits = data.definitions.filter(d => d.selected
    && (dueIds ? dueIds.has(d._id) : isDueOn(d)));
  const loggedCount = dueHabits.filter(h => {
    const log = getLog(h._id);
    return log && meetsTarget(h, log.value);
  }).length;
  const totalPlans = data.activityPlans.length + data.habitPlans.length + data.trainingPlans.length;
  const donePlans = [...data.activityPlans, ...data.habitPlans, ...data.trainingPlans]
    .filter(p => p.completed).length;

  return (
    <div className="space-y-6 anim-list">
      {/* Time-aware greeting — phrases rotate daily per time slot */}
      <header>
        <p className="text-[11px] text-ink-400 uppercase tracking-[0.14em] font-semibold mb-1.5">
          {format(now, 'EEEE, d. MMMM yyyy', { locale: de })}
        </p>
        <h1 className="display text-3xl sm:text-[2.5rem] sm:leading-tight">
          {before}
          <span className="italic font-normal text-brand-600">
            {user?.name?.split(' ')[0]}
          </span>
          {after}
        </h1>
      </header>

      {/* Stats — the grid opts out of the page cascade; its tiles stagger themselves */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 anim-skip">
        <div className="anim-fade-up h-full">
          <Stat
            icon={Sparkles}
            label="Gewohnheiten"
            value={dueHabits.length > 0 ? `${loggedCount}/${dueHabits.length}` : '–'}
            sub={dueHabits.length > 0 ? 'für heute erfüllt' : 'heute keine geplant'}
            tone="sage"
            to="/habits"
          />
        </div>
        <div className="anim-fade-up h-full" style={{ animationDelay: '60ms' }}>
          <Stat
            icon={Dumbbell}
            label="Diese Woche"
            value={data.activityTotal + data.stravaTotal}
            sub={data.stravaTotal > 0 ? `Aktivitäten · ${data.stravaTotal} aus Strava` : 'Aktivitäten'}
            tone="clay"
            to="/activities"
          />
        </div>
        <div className="anim-fade-up h-full" style={{ animationDelay: '120ms' }}>
          <Stat
            icon={CalendarDays}
            label="Geplant heute"
            value={totalPlans > 0 ? `${donePlans}/${totalPlans}` : '–'}
            sub={totalPlans > 0 ? 'erledigt' : 'nichts geplant'}
            tone="amber"
            to="/planner"
          />
        </div>
        <div className="anim-fade-up h-full" style={{ animationDelay: '180ms' }}>
          <Stat
            icon={Scale}
            label="Gewicht"
            value={data.weight ? `${data.weight.weight} ${data.weight.unit}` : '–'}
            sub={data.weight ? format(parseISO(data.weight.date), 'd. MMM', { locale: de }) : 'Nicht eingetragen'}
            tone="rose"
            to="/weight"
          />
        </div>
      </div>

      {/* Feed: habits due today, with quick logging */}
      <SectionCard icon={Sparkles} tone="sage" title="Gewohnheiten für heute" linkTo="/habits">
        {dueHabits.length === 0 ? (
          <EmptyHint>Für heute sind keine Gewohnheiten geplant. Lehn dich zurück!</EmptyHint>
        ) : (
          <div className="divide-hairline anim-list">
            {dueHabits.map(habit => (
              <TodayHabitRow
                key={habit._id}
                habit={habit}
                log={getLog(habit._id)}
                onLog={load}
              />
            ))}
          </div>
        )}
      </SectionCard>

      {/* Feed: today's plan */}
      <SectionCard icon={CalendarDays} tone="amber" title="Geplant für heute" linkTo="/planner" linkLabel="Zum Planer">
        {totalPlans === 0 ? (
          <EmptyHint>Heute steht nichts im Planer.</EmptyHint>
        ) : (
          <div className="divide-hairline anim-list">
            {data.activityPlans.map(plan => (
              <PlanRow
                key={plan._id}
                label={plan.activityTypeRef?.label || plan.historicalLabel || plan.activityType}
                color={chipColorFor(plan.activityTypeRef?._id || plan.activityType)}
                completed={plan.completed}
                meta={[
                  plan.duration && `${plan.duration} min`,
                  plan.distance && `${plan.distance} km`,
                  plan.notes,
                ].filter(Boolean).join(' · ')}
              />
            ))}
            {data.habitPlans.map(plan => (
              <PlanRow
                key={plan._id}
                label={plan.habitId?.name || plan.habitName}
                color={chipColorFor(plan.habitId?._id || plan.habitId)}
                completed={plan.completed}
                meta={plan.completed && plan.loggedValue != null
                  ? `${plan.loggedValue} ${plan.unitSymbol || ''}`.trim()
                  : plan.notes || 'Gewohnheit'}
              />
            ))}
            {data.trainingPlans.map(plan => (
              <PlanRow
                key={plan._id}
                label={plan.name || plan.trainingTypeName || 'Training'}
                color="amber"
                completed={plan.completed}
                meta={plan.fulfilledBy
                  ? `Erfüllt durch: ${plan.fulfilledBy.name}`
                  : plan.completed
                    ? 'Manuell absolviert'
                    : plan.notes || 'Training – wird durch eine passende Aktivität erfüllt'}
              />
            ))}
          </div>
        )}
      </SectionCard>

      {/* Feed: this week's activities + goals */}
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <SectionCard icon={Dumbbell} tone="clay" title="Aktivitäten" linkTo="/activities">
          {data.activities.length === 0 ? (
            <EmptyHint>Keine Aktivitäten diese Woche – auf geht's!</EmptyHint>
          ) : (
            <div className="divide-hairline anim-list">
              {data.activities.slice(0, 5).map(a => (
                <div key={a._id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-800 truncate">
                      {a.activityTypeRef?.label || a.historicalLabel || ACTIVITY_LABELS[a.activityType] || a.activityType}
                    </p>
                    <p className="text-xs text-ink-400 mt-0.5">
                      {isToday(parseISO(a.date))
                        ? 'Heute'
                        : format(parseISO(a.date), 'E, d. MMM', { locale: de })}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {a.duration && <p className="text-sm text-ink-600">{a.duration} min</p>}
                    {a.distance && <p className="text-xs text-ink-400">{a.distance} km</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard icon={Target} tone="amber" title="Ziele" linkTo="/goals">
          {data.goals.length === 0 ? (
            <div className="text-center px-4 pb-5 pt-2">
              <p className="text-ink-400 text-sm mb-4">Noch keine Ziele definiert</p>
              <Link to="/goals">
                <Button size="sm">Ziel erstellen</Button>
              </Link>
            </div>
          ) : (
            <div className="divide-hairline anim-list">
              {data.goals.slice(0, 4).map(g => (
                <div key={g._id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-ink-800 truncate min-w-0">{g.name}</p>
                    <Chip variant="soft" color={g.type.startsWith('long-term') ? 'amber' : 'olive'} className="flex-shrink-0">
                      {g.type.startsWith('long-term') ? 'Langfristig' : 'Periodisch'}
                    </Chip>
                  </div>
                  <p className="text-xs text-ink-400 mt-0.5">
                    {g.condition === 'min' ? 'Min.' : g.condition === 'max' ? 'Max.' : 'Genau'} {g.targetValue} {g.unitSymbol || ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Quick access */}
      <div className="card p-5">
        <h2 className="display text-lg mb-4">Schnellzugriff</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {[
            { to: '/activities', label: 'Aktivität loggen',   icon: Dumbbell, tone: 'bg-brand-50 text-brand-600' },
            { to: '/planner',    label: 'Woche planen',       icon: Calendar, tone: 'bg-ocher-100 text-ocher-600' },
            { to: '/habits',     label: 'Gewohnheit tracken', icon: Sparkles, tone: 'bg-sage-100 text-sage-600' },
            { to: '/weight',     label: 'Gewicht eintragen',  icon: Scale,    tone: 'bg-rose-50 text-rose-600' },
          ].map(({ to, label, icon: Icon, tone }) => (
            <Link
              key={to}
              to={to}
              className="panel card-hover flex flex-col items-center gap-2.5 p-4 text-center"
            >
              <span className={`w-9 h-9 rounded-full flex items-center justify-center ${tone}`}>
                <Icon size={16} />
              </span>
              <span className="text-xs text-ink-600 font-medium leading-tight">{label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
