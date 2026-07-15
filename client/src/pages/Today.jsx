import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { format, startOfDay, endOfDay } from 'date-fns';
import { de } from 'date-fns/locale';
import api from '../utils/api';
import {
  Sun, Sparkles, Dumbbell, CalendarDays, Check, ArrowRight, Circle,
} from 'lucide-react';
import {
  PageHeader, Stat, Chip, chipColorFor, Input, Button, PageLoader,
  TONE_BUBBLE,
} from '../components/ui';
import { isDueOn, formatScheduleBadge } from '../utils/habitSchedule';

// Compact quick-log row for a habit that is due today.
function TodayHabitRow({ habit, log, onLog }) {
  const [value, setValue] = useState(log?.value ?? '');
  const [saving, setSaving] = useState(false);
  const tone = chipColorFor(habit._id);

  useEffect(() => { setValue(log?.value ?? ''); }, [log]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (value === '') return;
    setSaving(true);
    try {
      await api.post('/habits/logs', {
        habitId: habit._id,
        date: new Date().toISOString(),
        value: +value,
      });
      onLog();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${TONE_BUBBLE[tone]}`}>
        {log ? <Check size={15} strokeWidth={3} /> : <Sparkles size={14} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink-800 truncate">{habit.name}</p>
        <p className="text-xs text-ink-400 truncate">
          {log ? (
            <span className="text-emerald-600 font-medium">{log.value} {habit.unitSymbol} eingetragen</span>
          ) : (
            <>
              in {habit.unitSymbol}
              {formatScheduleBadge(habit) && ` · ${formatScheduleBadge(habit)}`}
            </>
          )}
        </p>
      </div>
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
    </div>
  );
}

// One planned item (activity or habit plan) with completion state.
function PlanRow({ label, meta, completed, color }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={completed ? 'text-emerald-500' : 'text-ink-300'}>
        {completed ? <Check size={16} strokeWidth={3} /> : <Circle size={14} />}
      </span>
      <Chip color={color}>{label}</Chip>
      <span className="text-xs text-ink-400 truncate flex-1">{meta}</span>
      {completed && <span className="text-xs font-medium text-emerald-600 flex-shrink-0">Erledigt</span>}
    </div>
  );
}

function SectionCard({ icon: Icon, tone, title, linkTo, linkLabel, children }) {
  return (
    <div className="card">
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
            className="text-xs font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1 transition-colors"
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

export default function Today() {
  const [definitions, setDefinitions] = useState([]);
  const [logs, setLogs] = useState([]);
  const [activities, setActivities] = useState([]);
  const [activityPlans, setActivityPlans] = useState([]);
  const [habitPlans, setHabitPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const startDate = startOfDay(new Date()).toISOString();
    const endDate = endOfDay(new Date()).toISOString();
    try {
      const [defsRes, logsRes, actsRes, planRes, habitPlanRes] = await Promise.all([
        api.get('/habits/definitions'),
        api.get('/habits/logs', { params: { startDate, endDate } }),
        api.get('/activities', { params: { startDate, endDate, limit: 50 } }),
        api.get('/planner', { params: { startDate, endDate } }),
        api.get('/planner/habits', { params: { startDate, endDate } }),
      ]);
      setDefinitions(defsRes.data);
      setLogs(logsRes.data);
      setActivities(actsRes.data.activities);
      setActivityPlans(planRes.data);
      setHabitPlans(habitPlanRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <PageLoader />;

  const getLog = (habitId) =>
    logs.find(l => l.habitId?._id === habitId || l.habitId === habitId);

  const dueHabits = definitions.filter(d => d.selected && isDueOn(d));
  const loggedCount = dueHabits.filter(h => getLog(h._id)).length;
  const openPlans = [...activityPlans, ...habitPlans].filter(p => !p.completed).length;
  const totalPlans = activityPlans.length + habitPlans.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Heute"
        icon={Sun}
        tone="amber"
        subtitle={format(new Date(), 'EEEE, d. MMMM yyyy', { locale: de })}
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <Stat
          icon={Sparkles}
          tone="sage"
          label="Gewohnheiten"
          value={dueHabits.length > 0 ? `${loggedCount}/${dueHabits.length}` : '–'}
          sub={dueHabits.length > 0 ? 'für heute eingetragen' : 'heute keine geplant'}
          to="/habits"
        />
        <Stat
          icon={Dumbbell}
          tone="clay"
          label="Aktivitäten"
          value={activities.length}
          sub="heute eingetragen"
          to="/activities"
        />
        <Stat
          icon={CalendarDays}
          tone="amber"
          label="Geplant"
          value={totalPlans > 0 ? `${totalPlans - openPlans}/${totalPlans}` : '–'}
          sub={totalPlans > 0 ? 'erledigt' : 'nichts geplant'}
          to="/planner"
        />
      </div>

      {/* Habits due today */}
      <SectionCard icon={Sparkles} tone="sage" title="Gewohnheiten für heute" linkTo="/habits" linkLabel="Alle">
        {dueHabits.length === 0 ? (
          <EmptyHint>Für heute sind keine Gewohnheiten geplant. Lehn dich zurück!</EmptyHint>
        ) : (
          <div className="divide-hairline">
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

      {/* Planned for today */}
      <SectionCard icon={CalendarDays} tone="amber" title="Geplant für heute" linkTo="/planner" linkLabel="Zum Planer">
        {totalPlans === 0 ? (
          <EmptyHint>Heute steht nichts im Planer.</EmptyHint>
        ) : (
          <div className="divide-hairline">
            {activityPlans.map(plan => (
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
            {habitPlans.map(plan => (
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
          </div>
        )}
      </SectionCard>

      {/* Logged today */}
      <SectionCard icon={Dumbbell} tone="clay" title="Heute eingetragen" linkTo="/activities" linkLabel="Alle">
        {activities.length === 0 ? (
          <EmptyHint>Noch keine Aktivität für heute – auf geht's!</EmptyHint>
        ) : (
          <div className="divide-hairline">
            {activities.map(a => (
              <div key={a._id} className="flex items-center gap-3 px-4 py-3">
                <Chip color={chipColorFor(a.activityTypeRef?._id || a.activityType)}>
                  {a.activityTypeRef?.label || a.historicalLabel || a.activityType}
                </Chip>
                <span className="text-xs text-ink-400 truncate flex-1">
                  {[
                    a.duration && `${a.duration} min`,
                    a.distance && `${a.distance} km`,
                    a.notes,
                  ].filter(Boolean).join(' · ')}
                </span>
                <Check size={14} className="text-emerald-500 flex-shrink-0" strokeWidth={3} />
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
