import { useState, useEffect } from 'react';
import api from '../utils/api';
import { format, subDays, parseISO, startOfDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { Plus, Trash2, TrendingUp, Sparkles, X, ChevronDown, ChevronUp } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';

function AddHabitModal({ onSave, onClose }) {
  const [form, setForm] = useState({ name: '', unitSymbol: '', type: 'amount' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/habits/definitions', form);
      onSave();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4">
      <div className="card w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white">Neue Gewohnheit</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="z.B. Vitamine" required />
          </div>
          <div>
            <label className="label">Einheit</label>
            <input className="input" value={form.unitSymbol} onChange={e => set('unitSymbol', e.target.value)} placeholder="z.B. Tabletten, ml, min" required />
          </div>
          <div>
            <label className="label">Typ</label>
            <select className="input" value={form.type} onChange={e => set('type', e.target.value)}>
              <option value="amount">Menge</option>
              <option value="duration">Dauer</option>
            </select>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? 'Speichern...' : 'Erstellen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function HabitCard({ habit, todayLog, onLog }) {
  const [value, setValue] = useState(todayLog?.value ?? '');
  const [saving, setSaving] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [chartData, setChartData] = useState([]);

  const handleLog = async () => {
    if (value === '') return;
    setSaving(true);
    try {
      await api.post('/habits/logs', {
        habitId: habit._id,
        date: new Date().toISOString(),
        value: +value
      });
      onLog();
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
    const res = await api.get('/habits/logs', {
      params: { habitId: habit._id, startDate: start.toISOString(), endDate: end.toISOString() }
    });
    const data = Array.from({ length: 30 }, (_, i) => {
      const d = subDays(end, 29 - i);
      const dayKey = format(d, 'yyyy-MM-dd');
      const log = res.data.find(l => format(parseISO(l.date), 'yyyy-MM-dd') === dayKey);
      return { date: format(d, 'd. MMM', { locale: de }), value: log?.value ?? null };
    }).filter(d => d.value !== null);
    setChartData(data);
    setShowChart(true);
  };

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-white">{habit.name}</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {habit.isPredefined ? 'Vordefiniert' : 'Benutzerdefiniert'} · {habit.unitSymbol}
          </p>
        </div>
        <button
          onClick={loadChart}
          className="text-slate-500 hover:text-brand-400 transition-colors"
        >
          <TrendingUp size={18} />
        </button>
      </div>

      <div className="flex gap-2">
        <input
          type="number"
          value={value}
          onChange={e => setValue(e.target.value)}
          className="input flex-1"
          placeholder={`Heute in ${habit.unitSymbol}`}
          min="0"
          step="0.1"
        />
        <button
          onClick={handleLog}
          disabled={saving || value === ''}
          className="btn-primary px-4 whitespace-nowrap"
        >
          {saving ? '...' : todayLog ? 'Aktualisieren' : 'Eintragen'}
        </button>
      </div>

      {todayLog && (
        <p className="text-xs text-emerald-400 mt-2">
          Heute: {todayLog.value} {habit.unitSymbol}
        </p>
      )}

      {showChart && chartData.length > 0 && (
        <div className="mt-4">
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} width={30} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9' }}
                formatter={(v) => [`${v} ${habit.unitSymbol}`, habit.name]}
              />
              <Line type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: '#8b5cf6', r: 3 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default function Habits() {
  const [definitions, setDefinitions] = useState([]);
  const [todayLogs, setTodayLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const todayStart = startOfDay(new Date());
      const [defsRes, logsRes] = await Promise.all([
        api.get('/habits/definitions'),
        api.get('/habits/logs', {
          params: {
            startDate: todayStart.toISOString(),
            endDate: new Date().toISOString()
          }
        })
      ]);
      setDefinitions(defsRes.data);
      setTodayLogs(logsRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const deleteHabit = async (id) => {
    if (!confirm('Gewohnheit löschen?')) return;
    try {
      await api.delete(`/habits/definitions/${id}`);
      load();
    } catch {
      alert('Vordefinierte Gewohnheiten können nicht gelöscht werden.');
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const predefined = definitions.filter(d => d.isPredefined);
  const custom = definitions.filter(d => !d.isPredefined);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Gewohnheiten</h1>
          <p className="text-slate-400 text-sm mt-0.5">{format(new Date(), 'EEEE, d. MMMM', { locale: de })}</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          <span className="hidden sm:inline">Neue Gewohnheit</span>
        </button>
      </div>

      {definitions.length === 0 ? (
        <div className="card p-12 text-center">
          <Sparkles size={36} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">Keine Gewohnheiten gefunden</p>
        </div>
      ) : (
        <>
          {predefined.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Voreingestellt</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {predefined.map(habit => (
                  <HabitCard
                    key={habit._id}
                    habit={habit}
                    todayLog={todayLogs.find(l => l.habitId?._id === habit._id || l.habitId === habit._id)}
                    onLog={load}
                  />
                ))}
              </div>
            </div>
          )}

          {custom.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Eigene Gewohnheiten</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {custom.map(habit => (
                  <div key={habit._id} className="relative">
                    <HabitCard
                      habit={habit}
                      todayLog={todayLogs.find(l => l.habitId?._id === habit._id || l.habitId === habit._id)}
                      onLog={load}
                    />
                    <button
                      onClick={() => deleteHabit(habit._id)}
                      className="absolute top-3 right-3 text-slate-600 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {showAdd && <AddHabitModal onSave={() => { setShowAdd(false); load(); }} onClose={() => setShowAdd(false)} />}
    </div>
  );
}
