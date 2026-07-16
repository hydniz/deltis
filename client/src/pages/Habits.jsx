import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { format, subDays, parseISO, startOfDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { Plus, TrendingUp, Sparkles, Settings2, Check, CalendarOff, LayoutGrid, Undo2 } from 'lucide-react';
import { isDueOn, formatScheduleBadge } from '../utils/habitSchedule';
import { meetsTarget, formatTarget } from '../utils/habitTarget';
import HabitHeatmap from '../components/HabitHeatmap';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';
import {
  PageHeader, Button, Input, IconButton,
  EmptyState, PageLoader, Spinner, useChart, chipColorFor,
  TONE_BUBBLE, TONE_ACCENT_BORDER,
} from '../components/ui';
import ManageHabitsModal from '../components/ManageHabitsModal';

// Habit card

function HabitCard({ habit, todayLog, onLog }) {
  const CHART = useChart();
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const isToday = selectedDate === todayStr;

  // currentLog: today → provided by parent; other dates → fetched locally
  const [currentLog, setCurrentLog] = useState(todayLog ?? null);
  const [value, setValue] = useState(todayLog?.value ?? '');
  const [loadingLog, setLoadingLog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [chartData, setChartData] = useState([]);

  // Configuration lives centrally in the manage modal — the card only logs.
  const dueToday = isDueOn(habit);
  const isBoolean = habit.type === 'boolean';

  // Sync today's log from parent whenever parent reloads
  useEffect(() => {
    if (isToday) {
      setCurrentLog(todayLog ?? null);
      setValue(todayLog?.value ?? '');
    }
  }, [todayLog, isToday]);

  // When switching to a different date, fetch that day's log
  useEffect(() => {
    if (isToday) return;
    setLoadingLog(true);
    const d = new Date(selectedDate + 'T00:00:00');
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    api.get('/habits/logs', {
      params: { habitId: habit._id, startDate: d.toISOString(), endDate: end.toISOString() }
    }).then(res => {
      const log = res.data[0] ?? null;
      setCurrentLog(log);
      setValue(log?.value ?? '');
    }).catch(console.error).finally(() => setLoadingLog(false));
  }, [selectedDate, isToday, habit._id]);

  const handleDateChange = (newDate) => {
    setSelectedDate(newDate);
    setCurrentLog(null);
    setValue('');
  };

  // Refresh after a write: parent reload for today, targeted refetch otherwise.
  const refreshAfterWrite = async () => {
    if (isToday) {
      onLog();
      return;
    }
    const d = new Date(selectedDate + 'T00:00:00');
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    const res = await api.get('/habits/logs', {
      params: { habitId: habit._id, startDate: d.toISOString(), endDate: end.toISOString() }
    });
    setCurrentLog(res.data[0] ?? null);
  };

  const submitLog = async (logValue) => {
    setSaving(true);
    try {
      await api.post('/habits/logs', {
        habitId: habit._id,
        date: new Date(selectedDate + 'T12:00:00').toISOString(),
        value: logValue,
      });
      await refreshAfterWrite();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLog = () => {
    if (value === '') return;
    submitLog(+value);
  };

  // Boolean habits: un-doing removes the day's log entirely.
  const handleUnlog = async () => {
    if (!currentLog?._id) return;
    setSaving(true);
    try {
      await api.delete(`/habits/logs/${currentLog._id}`);
      await refreshAfterWrite();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const loadChart = async () => {
    if (chartData.length > 0) { setShowChart(v => !v); return; }
    const end = new Date();
    const start = subDays(end, 29);
    try {
      const res = await api.get('/habits/logs', {
        params: { habitId: habit._id, startDate: start.toISOString(), endDate: end.toISOString() }
      });
      const data = Array.from({ length: 30 }, (_, i) => {
        const d = subDays(end, 29 - i);
        const dayKey = format(d, 'yyyy-MM-dd');
        const log = res.data.find(l => format(parseISO(l.date), 'yyyy-MM-dd') === dayKey);
        const realValue = log?.value ?? null;
        const value = realValue !== null
          ? realValue
          : (habit.missingDayMode === 'default' ? +(habit.defaultValue ?? 0) : null);
        return { date: format(d, 'd. MMM', { locale: de }), value, isDefault: realValue === null && value !== null };
      }).filter(d => d.value !== null);
      setChartData(data);
      setShowChart(true);
    } catch (err) {
      console.error(err);
    }
  };

  // Every habit gets its own stable accent colour, matching the chip palette.
  const tone = chipColorFor(habit._id);

  return (
    <div className={`card p-5 border-l-4 ${TONE_ACCENT_BORDER[tone]}`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${TONE_BUBBLE[tone]}`}>
            <Sparkles size={16} />
          </div>
          <div className="min-w-0">
            <h3 className="display text-lg leading-snug truncate">{habit.name}</h3>
            <p className="text-xs text-ink-400 mt-0.5 truncate">
              {isBoolean ? 'Ja/Nein' : `in ${habit.unitSymbol}`}
              {formatTarget(habit) && (
                <span className="text-ocher-600 font-medium"> · {formatTarget(habit)}</span>
              )}
              {formatScheduleBadge(habit) && (
                <span className="text-brand-600 font-medium"> · {formatScheduleBadge(habit)}</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton
            icon={LayoutGrid}
            label="Heatmap anzeigen"
            tone="brand"
            size={15}
            active={showHeatmap}
            onClick={() => setShowHeatmap(v => !v)}
          />
          {!isBoolean && (
            <IconButton icon={TrendingUp} label="Verlauf anzeigen" tone="brand" size={16} active={showChart} onClick={loadChart} />
          )}
        </div>
      </div>

      {!dueToday && (
        <p className="-mt-2 mb-3 text-[11px] font-medium text-ink-400 flex items-center gap-1.5">
          <CalendarOff size={11} />
          Heute nicht geplant – Eintragen ist trotzdem möglich.
        </p>
      )}

      {/* Date row */}
      <div className="flex items-center gap-2 mb-3">
        <input
          type="date"
          value={selectedDate}
          max={todayStr}
          onChange={e => handleDateChange(e.target.value)}
          className={`input !w-auto !py-2 !text-sm ${
            isToday ? 'text-ink-400' : 'flex-1 !border-brand-400 text-ink-800'
          }`}
        />
        {!isToday && (
          <button
            type="button"
            onClick={() => handleDateChange(todayStr)}
            className="text-xs font-semibold text-brand-600 hover:text-brand-700 whitespace-nowrap px-2 py-2"
          >
            Heute
          </button>
        )}
      </div>

      {loadingLog ? (
        <div className="flex items-center justify-center py-3">
          <Spinner size="sm" />
        </div>
      ) : isBoolean ? (
        currentLog ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-emerald-600 font-semibold flex items-center gap-1.5">
              <Check size={15} strokeWidth={3} />
              {isToday ? 'Heute erledigt' : `Erledigt am ${format(parseISO(selectedDate), 'd. MMM', { locale: de })}`}
            </p>
            <Button variant="ghost" size="sm" icon={Undo2} loading={saving} onClick={handleUnlog}>
              Rückgängig
            </Button>
          </div>
        ) : (
          <Button className="w-full" icon={Check} loading={saving} onClick={() => submitLog(1)}>
            Als erledigt markieren
          </Button>
        )
      ) : (
        <form onSubmit={e => { e.preventDefault(); handleLog(); }} className="flex gap-2">
          <Input
            type="number"
            value={value}
            onChange={e => setValue(e.target.value)}
            className="flex-1"
            placeholder={`${isToday ? 'Heute' : 'Wert'} in ${habit.unitSymbol}`}
            min="0"
            step="0.1"
          />
          <Button type="submit" loading={saving} disabled={value === ''} className="whitespace-nowrap">
            {currentLog ? 'Aktualisieren' : 'Eintragen'}
          </Button>
        </form>
      )}

      {currentLog && !isBoolean && (() => {
        const fulfilled = meetsTarget(habit, currentLog.value);
        const unit = currentLog.historicalUnit || habit.unitSymbol;
        const suffix = currentLog.historicalUnit ? ` ${currentLog.historicalUnit} (jetzt: ${habit.unitSymbol})` : ` ${unit}`;
        const datePrefix = isToday ? 'Heute' : format(parseISO(selectedDate), 'd. MMM', { locale: de });
        return (
          <p className={`text-xs font-medium mt-2 flex items-center gap-1 ${fulfilled ? 'text-emerald-600' : 'text-ocher-600'}`}>
            {fulfilled && <Check size={12} strokeWidth={3} />}
            {`${datePrefix}: ${currentLog.value}${suffix}`}
            {!fulfilled && ` · Ziel: ${formatTarget(habit)}`}
          </p>
        );
      })()}

      {showHeatmap && <HabitHeatmap habit={habit} />}

      {showChart && chartData.length > 0 && (
        <div className="mt-4">
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
              <XAxis dataKey="date" tick={CHART.tick} tickLine={false} />
              <YAxis tick={CHART.tick} tickLine={false} axisLine={false} width={30} />
              <Tooltip
                contentStyle={CHART.tooltip}
                formatter={(v, _name, props) => [
                  `${v} ${habit.unitSymbol}${props.payload?.isDefault ? ' (Standard)' : ''}`,
                  habit.name
                ]}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={CHART.line}
                strokeWidth={2}
                dot={(props) => {
                  const { cx, cy, payload } = props;
                  return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={3} fill={payload.isDefault ? CHART.dotMuted : CHART.line} />;
                }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
          {habit.missingDayMode === 'default' && chartData.some(d => d.isDefault) && (
            <p className="text-xs text-ink-400 mt-1 flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-ink-300" />
              Grau = Standardwert (nicht eingetragen)
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Main page

export default function Habits() {
  const [definitions, setDefinitions] = useState([]);
  const [todayLogs, setTodayLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showManage, setShowManage] = useState(false);

  // Quick-log refreshes call load() directly and swap data in place —
  // only the initial mount shows the loader (loading starts true).
  const load = useCallback(async () => {
    try {
      const todayStart = startOfDay(new Date());
      const [defsRes, logsRes] = await Promise.all([
        api.get('/habits/definitions'),
        api.get('/habits/logs', {
          params: { startDate: todayStart.toISOString(), endDate: new Date().toISOString() }
        })
      ]);
      setDefinitions(defsRes.data);
      setTodayLogs(logsRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const activeHabits = definitions.filter(d => d.selected);

  const getTodayLog = (habitId) =>
    todayLogs.find(l => l.habitId?._id === habitId || l.habitId === habitId);

  if (loading) return <PageLoader />;

  // Habits due today come first; the counter only tracks today's schedule
  // and counts a day as done when the completion target is met.
  const sortedHabits = [...activeHabits].sort((a, b) => isDueOn(b) - isDueOn(a));
  const dueTodayCount = activeHabits.filter(h => isDueOn(h)).length;
  const loggedCount = activeHabits.filter(h => {
    if (!isDueOn(h)) return false;
    const log = getTodayLog(h._id);
    return log && meetsTarget(h, log.value);
  }).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gewohnheiten"
        icon={Sparkles}
        tone="sage"
        subtitle={
          <>
            {format(new Date(), 'EEEE, d. MMMM', { locale: de })}
            {activeHabits.length > 0 && (
              <span className="text-ink-400">
                {' · '}
                {dueTodayCount > 0
                  ? `${loggedCount}/${dueTodayCount} für heute erfüllt`
                  : 'für heute keine geplant'}
              </span>
            )}
          </>
        }
        action={
          <Button variant="secondary" icon={Settings2} onClick={() => setShowManage(true)}>
            <span className="hidden sm:inline">Verwalten</span>
          </Button>
        }
      />

      {activeHabits.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          tone="sage"
          title={definitions.length === 0
            ? 'Noch keine Gewohnheiten definiert'
            : 'Keine Gewohnheiten ausgewählt'}
          text={definitions.length === 0
            ? 'Lege zuerst fest, was du täglich tracken möchtest – z. B. Wasser, Schlaf oder Lesen.'
            : 'Wähle aus, welche Gewohnheiten du täglich tracken möchtest.'}
          action={
            <Button icon={definitions.length === 0 ? Plus : Settings2} onClick={() => setShowManage(true)}>
              {definitions.length === 0 ? 'Erste Gewohnheit anlegen' : 'Gewohnheiten auswählen'}
            </Button>
          }
        />
      ) : (
        <div className="grid sm:grid-cols-2 gap-4 anim-list">
          {sortedHabits.map(habit => (
            <HabitCard
              key={habit._id}
              habit={habit}
              todayLog={getTodayLog(habit._id)}
              onLog={load}
            />
          ))}
        </div>
      )}

      {showManage && (
        <ManageHabitsModal
          onSave={() => { setShowManage(false); load(); }}
          onClose={() => { setShowManage(false); load(); }}
        />
      )}
    </div>
  );
}
