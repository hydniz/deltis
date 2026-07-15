import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { format, subDays, parseISO, startOfDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { Plus, Trash2, TrendingUp, Sparkles, Settings2, Check, Pencil, ChevronUp } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';
import {
  PageHeader, Button, Field, Input, Select, Checkbox, Modal, IconButton,
  EmptyState, PageLoader, Spinner, CHART, chipColorFor,
  TONE_BUBBLE, TONE_ACCENT_BORDER,
} from '../components/ui';

// Editable row for custom habits

function CustomHabitRow({ def, selected, onToggle, onDelete, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: def.name, unitSymbol: def.unitSymbol, type: def.type });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.put(`/habits/definitions/${def._id}`, form);
      onUpdate(res.data);
      setEditing(false);
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setForm({ name: def.name, unitSymbol: def.unitSymbol, type: def.type });
    setEditing(false);
  };

  return (
    <div className="rounded-xl hover:bg-paper-50 transition-colors">
      <div className="flex items-center gap-1 p-2.5">
        <Checkbox
          checked={selected}
          onChange={onToggle}
          label={def.name}
          description={def.unitSymbol}
          className="flex-1"
        />
        <IconButton
          icon={editing ? ChevronUp : Pencil}
          label="Bearbeiten"
          tone="brand"
          size={14}
          active={editing}
          onClick={() => setEditing(v => !v)}
        />
        <IconButton icon={Trash2} label="Löschen" tone="danger" size={14} onClick={onDelete} />
      </div>

      {editing && (
        <form
          onSubmit={e => { e.preventDefault(); handleSave(); }}
          className="px-3 pb-3 pt-3 space-y-3 border-t hairline mx-1"
        >
          <Field label="Name">
            <Input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Einheit">
              <Input
                value={form.unitSymbol}
                onChange={e => setForm(f => ({ ...f, unitSymbol: e.target.value }))}
                placeholder="z.B. min, ml"
              />
            </Field>
            <Field label="Typ">
              <Select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                <option value="amount">Menge</option>
                <option value="duration">Dauer</option>
              </Select>
            </Field>
          </div>
          <div className="flex gap-2 pt-0.5">
            <Button variant="secondary" size="sm" className="flex-1" onClick={handleCancel}>Abbrechen</Button>
            <Button type="submit" size="sm" className="flex-1" loading={saving}>Speichern</Button>
          </div>
        </form>
      )}
    </div>
  );
}

// Management modal

function ManageHabitsModal({ definitions, onSave, onClose }) {
  const [selected, setSelected] = useState(
    new Set(definitions.filter(d => d.selected).map(d => d._id))
  );
  const [newHabit, setNewHabit] = useState({ name: '', unitSymbol: '', type: 'amount' });
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingSaving, setAddingSaving] = useState(false);
  const [localDefs, setLocalDefs] = useState(definitions);

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/habits/selection', { selectedIds: [...selected] });
      onSave();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddHabit = async (e) => {
    e.preventDefault();
    if (!newHabit.name.trim() || !newHabit.unitSymbol.trim()) return;
    setAddingSaving(true);
    try {
      const res = await api.post('/habits/definitions', newHabit);
      const created = { ...res.data, selected: true };
      setLocalDefs(d => [...d, created]);
      setSelected(prev => new Set([...prev, created._id]));
      setNewHabit({ name: '', unitSymbol: '', type: 'amount' });
      setShowAddForm(false);
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setAddingSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Gewohnheit löschen? Bestehende Einträge bleiben erhalten.')) return;
    try {
      await api.delete(`/habits/definitions/${id}`);
      setLocalDefs(d => d.filter(def => def._id !== id));
      setSelected(prev => { const next = new Set(prev); next.delete(id); return next; });
    } catch {
      alert('Vordefinierte Gewohnheiten können nicht gelöscht werden.');
    }
  };

  const handleUpdate = (updated) => {
    setLocalDefs(d => d.map(def => def._id === updated._id ? { ...def, ...updated } : def));
  };

  const predefined = localDefs.filter(d => d.isPredefined);
  const custom = localDefs.filter(d => !d.isPredefined);

  return (
    <Modal
      onClose={onClose}
      title="Gewohnheiten verwalten"
      subtitle="Was möchtest du täglich tracken?"
      icon={Sparkles}
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>Abbrechen</Button>
          <Button className="flex-1" loading={saving} icon={Check} onClick={handleSave}>
            {selected.size} aktiv – Speichern
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {/* Predefined */}
        <div>
          <p className="label mb-2">Voreingestellt</p>
          <div className="space-y-0.5">
            {predefined.map(d => (
              <div key={d._id} className="rounded-xl hover:bg-paper-50 transition-colors p-2.5">
                <Checkbox
                  checked={selected.has(d._id)}
                  onChange={() => toggle(d._id)}
                  label={d.name}
                  description={d.unitSymbol}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Custom */}
        {(custom.length > 0 || showAddForm) && (
          <div>
            <p className="label mb-2">Eigene</p>
            <div className="space-y-0.5">
              {custom.map(d => (
                <CustomHabitRow
                  key={d._id}
                  def={d}
                  selected={selected.has(d._id)}
                  onToggle={() => toggle(d._id)}
                  onDelete={() => handleDelete(d._id)}
                  onUpdate={handleUpdate}
                />
              ))}
            </div>
          </div>
        )}

        {/* Add new habit */}
        {showAddForm ? (
          <form onSubmit={handleAddHabit} className="panel p-4 space-y-3">
            <p className="display text-base">Neue Gewohnheit</p>
            <Field label="Name">
              <Input
                value={newHabit.name}
                onChange={e => setNewHabit(h => ({ ...h, name: e.target.value }))}
                placeholder="z.B. Vitamine, Stretching …"
                autoFocus
                required
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Einheit">
                <Input
                  value={newHabit.unitSymbol}
                  onChange={e => setNewHabit(h => ({ ...h, unitSymbol: e.target.value }))}
                  placeholder="z.B. min, ml, Stück"
                  required
                />
              </Field>
              <Field label="Typ">
                <Select value={newHabit.type} onChange={e => setNewHabit(h => ({ ...h, type: e.target.value }))}>
                  <option value="amount">Menge</option>
                  <option value="duration">Dauer</option>
                </Select>
              </Field>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" className="flex-1" onClick={() => setShowAddForm(false)}>Abbrechen</Button>
              <Button type="submit" size="sm" className="flex-1" loading={addingSaving}>Hinzufügen</Button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 text-sm font-semibold text-brand-600 hover:text-brand-700 transition-colors py-1"
          >
            <Plus size={16} />
            Eigene Gewohnheit hinzufügen
          </button>
        )}
      </div>
    </Modal>
  );
}

// Habit card

function HabitCard({ habit, todayLog, onLog }) {
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const isToday = selectedDate === todayStr;

  // currentLog: today → provided by parent; other dates → fetched locally
  const [currentLog, setCurrentLog] = useState(todayLog ?? null);
  const [value, setValue] = useState(todayLog?.value ?? '');
  const [loadingLog, setLoadingLog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [chartData, setChartData] = useState([]);

  // Settings for missing days
  const [showSettings, setShowSettings] = useState(false);
  const [settingsMode, setSettingsMode] = useState(habit.missingDayMode ?? 'none');
  const [settingsDefaultVal, setSettingsDefaultVal] = useState(habit.defaultValue ?? 0);
  const [savingSettings, setSavingSettings] = useState(false);

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

  const handleLog = async () => {
    if (value === '') return;
    setSaving(true);
    try {
      await api.post('/habits/logs', {
        habitId: habit._id,
        date: new Date(selectedDate + 'T12:00:00').toISOString(),
        value: +value,
      });
      if (isToday) {
        onLog();
      } else {
        // Re-fetch the entry for the selected non-today date
        const d = new Date(selectedDate + 'T00:00:00');
        const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
        const res = await api.get('/habits/logs', {
          params: { habitId: habit._id, startDate: d.toISOString(), endDate: end.toISOString() }
        });
        setCurrentLog(res.data[0] ?? null);
      }
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await api.put(`/habits/settings/${habit._id}`, { missingDayMode: settingsMode, defaultValue: +settingsDefaultVal });
      setChartData([]);
      setShowChart(false);
      setShowSettings(false);
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSavingSettings(false);
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
        const value = realValue !== null ? realValue : (settingsMode === 'default' ? +settingsDefaultVal : null);
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
            <p className="text-xs text-ink-400 mt-0.5">in {habit.unitSymbol}</p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton
            icon={Settings2}
            label="Einstellungen"
            tone="brand"
            size={15}
            active={showSettings}
            onClick={() => setShowSettings(v => !v)}
          />
          <IconButton icon={TrendingUp} label="Verlauf anzeigen" tone="brand" size={16} active={showChart} onClick={loadChart} />
        </div>
      </div>

      {showSettings && (
        <div className="mb-4 panel p-3.5 space-y-2.5">
          <p className="text-xs font-semibold text-ink-600">Fehlende Tage in Statistik</p>
          <Select
            className="!text-sm"
            value={settingsMode}
            onChange={e => setSettingsMode(e.target.value)}
          >
            <option value="none">Nicht eingetragen = kein Wert</option>
            <option value="default">Standardwert für fehlende Tage</option>
          </Select>
          {settingsMode === 'default' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-500 whitespace-nowrap">Standardwert:</span>
              <Input
                type="number"
                className="flex-1 !text-sm"
                value={settingsDefaultVal}
                onChange={e => setSettingsDefaultVal(e.target.value)}
                min="0"
                step="0.1"
                placeholder={`in ${habit.unitSymbol}`}
              />
            </div>
          )}
          <Button size="sm" className="w-full" loading={savingSettings} onClick={handleSaveSettings}>
            Übernehmen
          </Button>
        </div>
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

      {currentLog && (
        <p className="text-xs text-emerald-600 font-medium mt-2 flex items-center gap-1">
          <Check size={12} strokeWidth={3} />
          {(() => {
            const unit = currentLog.historicalUnit || habit.unitSymbol;
            const suffix = currentLog.historicalUnit ? ` ${currentLog.historicalUnit} (jetzt: ${habit.unitSymbol})` : ` ${unit}`;
            const datePrefix = isToday ? 'Heute' : format(parseISO(selectedDate), 'd. MMM', { locale: de });
            return `${datePrefix}: ${currentLog.value}${suffix}`;
          })()}
        </p>
      )}

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
          {settingsMode === 'default' && chartData.some(d => d.isDefault) && (
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

  const load = useCallback(async () => {
    setLoading(true);
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

  const loggedCount = activeHabits.filter(h => getTodayLog(h._id)).length;

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
              <span className="text-ink-400"> · {loggedCount}/{activeHabits.length} eingetragen</span>
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
          title="Keine Gewohnheiten ausgewählt"
          text="Wähle aus, welche Gewohnheiten du täglich tracken möchtest."
          action={
            <Button icon={Settings2} onClick={() => setShowManage(true)}>
              Gewohnheiten auswählen
            </Button>
          }
        />
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {activeHabits.map(habit => (
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
          definitions={definitions}
          onSave={() => { setShowManage(false); load(); }}
          onClose={() => setShowManage(false)}
        />
      )}
    </div>
  );
}
