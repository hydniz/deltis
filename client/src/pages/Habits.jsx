import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { format, subDays, parseISO, startOfDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { Plus, Trash2, TrendingUp, Sparkles, X, Settings2, Check, Pencil, ChevronUp } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';

// ── Editable row for custom habits ───────────────────────────

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
    <div className="rounded-xl hover:bg-white/[.06] transition-colors">
      <div className="flex items-center gap-3 p-3">
        <label className="flex items-center gap-3 flex-1 cursor-pointer">
          <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
            selected ? 'bg-brand-600 border-brand-600' : 'border-slate-600'
          }`}>
            {selected && <Check size={12} className="text-white" strokeWidth={3} />}
          </div>
          <input type="checkbox" checked={selected} onChange={onToggle} className="sr-only" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-200">{def.name}</p>
            <p className="text-xs text-slate-500">{def.unitSymbol}</p>
          </div>
        </label>
        <button
          onClick={() => setEditing(v => !v)}
          className="text-slate-500 hover:text-brand-400 transition-colors flex-shrink-0 p-1"
        >
          {editing ? <ChevronUp size={15} /> : <Pencil size={14} />}
        </button>
        <button onClick={onDelete} className="text-slate-600 hover:text-red-400 transition-colors flex-shrink-0">
          <Trash2 size={15} />
        </button>
      </div>

      {editing && (
        <form onSubmit={e => { e.preventDefault(); handleSave(); }} className="px-3 pb-3 space-y-2 border-t border-slate-700 pt-3 mx-1">
          <div>
            <label className="label text-xs">Name</label>
            <input
              className="input text-sm"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label text-xs">Einheit</label>
              <input
                className="input text-sm"
                value={form.unitSymbol}
                onChange={e => setForm(f => ({ ...f, unitSymbol: e.target.value }))}
                placeholder="z.B. min, ml"
              />
            </div>
            <div>
              <label className="label text-xs">Typ</label>
              <select className="input text-sm" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                <option value="amount">Menge</option>
                <option value="duration">Dauer</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={handleCancel} className="btn-secondary flex-1 text-sm py-1.5">Abbrechen</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 text-sm py-1.5">
              {saving ? 'Speichern...' : 'Speichern'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Management modal ───────────────────────────────────────────────────────

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
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-white">Gewohnheiten verwalten</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200"><X size={20} /></button>
        </div>

        {/* Liste */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Vordefinierte */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Voreingestellt</p>
            <div className="space-y-1.5">
              {predefined.map(d => (
                <label key={d._id} className="flex items-center gap-3 p-3 rounded-xl cursor-pointer hover:bg-white/[.06] focus-within:ring-1 focus-within:ring-brand-400/50 transition-colors">
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    selected.has(d._id)
                      ? 'bg-brand-600 border-brand-600'
                      : 'border-slate-600'
                  }`}>
                    {selected.has(d._id) && <Check size={12} className="text-white" strokeWidth={3} />}
                  </div>
                  <input
                    type="checkbox"
                    checked={selected.has(d._id)}
                    onChange={() => toggle(d._id)}
                    className="sr-only"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200">{d.name}</p>
                    <p className="text-xs text-slate-500">{d.unitSymbol}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Eigene */}
          {(custom.length > 0 || showAddForm) && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Eigene</p>
              <div className="space-y-1.5">
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

          {/* Neue Gewohnheit hinzufügen */}
          {showAddForm ? (
            <form onSubmit={handleAddHabit} className="bg-white/[.06] border border-white/[.1] rounded-2xl p-4 space-y-3">
              <p className="text-sm font-semibold text-white">Neue Gewohnheit</p>
              <div>
                <label className="label text-xs">Name</label>
                <input
                  className="input text-sm"
                  value={newHabit.name}
                  onChange={e => setNewHabit(h => ({ ...h, name: e.target.value }))}
                  placeholder="z.B. Vitamine, Stretching …"
                  autoFocus
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label text-xs">Einheit</label>
                  <input
                    className="input text-sm"
                    value={newHabit.unitSymbol}
                    onChange={e => setNewHabit(h => ({ ...h, unitSymbol: e.target.value }))}
                    placeholder="z.B. min, ml, Stück"
                    required
                  />
                </div>
                <div>
                  <label className="label text-xs">Typ</label>
                  <select className="input text-sm" value={newHabit.type} onChange={e => setNewHabit(h => ({ ...h, type: e.target.value }))}>
                    <option value="amount">Menge</option>
                    <option value="duration">Dauer</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowAddForm(false)} className="btn-secondary flex-1 text-sm py-1.5">Abbrechen</button>
                <button type="submit" disabled={addingSaving} className="btn-primary flex-1 text-sm py-1.5">
                  {addingSaving ? 'Hinzufügen...' : 'Hinzufügen'}
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300 transition-colors py-1"
            >
              <Plus size={16} />
              Eigene Gewohnheit hinzufügen
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-800 flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2">
            {saving ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : <Check size={16} />}
            {saving ? 'Speichern...' : `${selected.size} aktiv – Speichern`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Habit card ─────────────────────────────────────────────────────────────

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

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-white">{habit.name}</h3>
          <p className="text-xs text-slate-500 mt-0.5">in {habit.unitSymbol}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSettings(v => !v)}
            className={`transition-colors p-1 ${showSettings ? 'text-brand-400' : 'text-slate-500 hover:text-brand-400'}`}
            title="Einstellungen"
          >
            <Settings2 size={16} />
          </button>
          <button onClick={loadChart} className="text-slate-500 hover:text-brand-400 transition-colors p-1 -mr-1" title="Verlauf anzeigen">
            <TrendingUp size={18} />
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="mb-4 p-3 bg-white/[.06] rounded-2xl border border-white/[.1] space-y-2">
          <p className="text-xs font-semibold text-slate-400">Fehlende Tage in Statistik</p>
          <select
            className="input text-sm w-full"
            value={settingsMode}
            onChange={e => setSettingsMode(e.target.value)}
          >
            <option value="none">Nicht eingetragen = kein Wert</option>
            <option value="default">Standardwert für fehlende Tage</option>
          </select>
          {settingsMode === 'default' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 whitespace-nowrap">Standardwert:</span>
              <input
                type="number"
                className="input text-sm flex-1"
                value={settingsDefaultVal}
                onChange={e => setSettingsDefaultVal(e.target.value)}
                min="0"
                step="0.1"
                placeholder={`in ${habit.unitSymbol}`}
              />
            </div>
          )}
          <button
            onClick={handleSaveSettings}
            disabled={savingSettings}
            className="btn-primary w-full text-sm py-1.5"
          >
            {savingSettings ? 'Speichern...' : 'Übernehmen'}
          </button>
        </div>
      )}

      {/* Datumszeile */}
      <div className="flex items-center gap-2 mb-3">
        <input
          type="date"
          value={selectedDate}
          max={todayStr}
          onChange={e => handleDateChange(e.target.value)}
          className={`text-sm rounded-lg px-2 py-2 border transition-colors bg-slate-800 ${
            isToday
              ? 'border-white/[.15] text-white/35 w-auto'
              : 'border-brand-600 text-slate-200 flex-1'
          }`}
        />
        {!isToday && (
          <button
            type="button"
            onClick={() => handleDateChange(todayStr)}
            className="text-xs text-brand-400 hover:text-brand-300 whitespace-nowrap px-2 py-2"
          >
            Heute
          </button>
        )}
      </div>

      {loadingLog ? (
        <div className="flex items-center justify-center py-3">
          <div className="w-4 h-4 border-2 border-zinc-700 border-t-brand-500 rounded-full animate-spin" />
        </div>
      ) : (
        <form onSubmit={e => { e.preventDefault(); handleLog(); }} className="flex gap-2">
          <input
            type="number"
            value={value}
            onChange={e => setValue(e.target.value)}
            className="input flex-1"
            placeholder={`${isToday ? 'Heute' : 'Wert'} in ${habit.unitSymbol}`}
            min="0"
            step="0.1"
          />
          <button
            type="submit"
            disabled={saving || value === ''}
            className="btn-primary px-4 whitespace-nowrap"
          >
            {saving ? '...' : currentLog ? 'Aktualisieren' : 'Eintragen'}
          </button>
        </form>
      )}

      {currentLog && (
        <p className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
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
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.30)', fontSize: 10 }} tickLine={false} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.30)', fontSize: 10 }} tickLine={false} axisLine={false} width={30} />
              <Tooltip
                contentStyle={{ background: 'rgba(30,28,50,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, color: '#fff', backdropFilter: 'blur(8px)' }}
                formatter={(v, _name, props) => [
                  `${v} ${habit.unitSymbol}${props.payload?.isDefault ? ' (Standard)' : ''}`,
                  habit.name
                ]}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#c4623a"
                strokeWidth={2}
                dot={(props) => {
                  const { cx, cy, payload } = props;
                  return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={3} fill={payload.isDefault ? '#7a6050' : '#c4623a'} />;
                }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
          {settingsMode === 'default' && chartData.some(d => d.isDefault) && (
            <p className="text-xs text-slate-600 mt-1 flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-slate-600" />
              Grau = Standardwert (nicht eingetragen)
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

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

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-zinc-700 border-t-brand-500 rounded-full animate-spin" />
    </div>
  );

  const loggedCount = activeHabits.filter(h => getTodayLog(h._id)).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Gewohnheiten</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {format(new Date(), 'EEEE, d. MMMM', { locale: de })}
            {activeHabits.length > 0 && (
              <span className="ml-2 text-slate-500">· {loggedCount}/{activeHabits.length} eingetragen</span>
            )}
          </p>
        </div>
        <button
          onClick={() => setShowManage(true)}
          className="btn-secondary flex items-center gap-2 text-sm"
        >
          <Settings2 size={16} />
          <span className="hidden sm:inline">Verwalten</span>
        </button>
      </div>

      {activeHabits.length === 0 ? (
        <div className="card p-12 text-center">
          <Sparkles size={36} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-300 font-medium">Keine Gewohnheiten ausgewählt</p>
          <p className="text-slate-500 text-sm mt-1 mb-4">Wähle aus, welche Gewohnheiten du täglich tracken möchtest.</p>
          <button onClick={() => setShowManage(true)} className="btn-primary inline-flex items-center gap-2">
            <Settings2 size={16} />
            Gewohnheiten auswählen
          </button>
        </div>
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
