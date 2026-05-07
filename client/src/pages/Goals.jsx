import { useState, useEffect } from 'react';
import api from '../utils/api';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { Plus, Target, Trash2, X, ChevronRight } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine
} from 'recharts';

const ACTIVITY_TYPES = [
  { value: 'gym', label: 'Gym' },
  { value: 'jogging', label: 'Joggen' },
  { value: 'cycling', label: 'Radfahren' },
  { value: 'swimming', label: 'Schwimmen' },
  { value: 'yoga', label: 'Yoga' },
  { value: 'hiking', label: 'Wandern' },
  { value: 'sports', label: 'Sport' },
  { value: 'other', label: 'Sonstiges' },
];

function GoalProgress({ goal }) {
  const [progress, setProgress] = useState(null);
  const [showChart, setShowChart] = useState(false);

  useEffect(() => {
    api.get(`/goals/${goal._id}/progress`).then(r => setProgress(r.data)).catch(() => {});
  }, [goal._id]);

  const { currentValue, weeklyData } = progress || {};

  const conditionLabel = goal.condition === 'min' ? 'mindestens' : goal.condition === 'max' ? 'maximal' : 'genau';
  const isWeekly = goal.type.startsWith('weekly');

  let progressPct = 0;
  let statusColor = 'bg-slate-700';
  let statusText = '';

  if (currentValue !== undefined) {
    if (goal.condition === 'min') {
      progressPct = Math.min(100, (currentValue / goal.targetValue) * 100);
      statusColor = progressPct >= 100 ? 'bg-emerald-500' : progressPct >= 60 ? 'bg-amber-500' : 'bg-red-500';
      statusText = progressPct >= 100 ? 'Ziel erreicht!' : `${currentValue} / ${goal.targetValue}`;
    } else if (goal.condition === 'max') {
      progressPct = currentValue <= goal.targetValue ? 100 : Math.max(0, 100 - ((currentValue - goal.targetValue) / goal.targetValue) * 100);
      statusColor = currentValue <= goal.targetValue ? 'bg-emerald-500' : 'bg-red-500';
      statusText = currentValue <= goal.targetValue ? 'Im Zielbereich' : `${currentValue} (Ziel: max. ${goal.targetValue})`;
    } else {
      progressPct = currentValue === goal.targetValue ? 100 : currentValue < goal.targetValue
        ? (currentValue / goal.targetValue) * 100 : Math.max(0, 100 - ((currentValue - goal.targetValue) / goal.targetValue) * 50);
      statusColor = currentValue === goal.targetValue ? 'bg-emerald-500' : 'bg-amber-500';
      statusText = `${currentValue} / ${goal.targetValue}`;
    }
  }

  const currentStep = goal.intermediateSteps
    ?.filter(s => new Date(s.date) >= new Date())
    ?.sort((a, b) => new Date(a.date) - new Date(b.date))[0];

  const chartDataWithTarget = (weeklyData || []).map(d => ({
    date: format(parseISO(d.weekStart), 'd. MMM', { locale: de }),
    Wert: d.value,
    Ziel: goal.targetValue,
  }));

  if (goal.intermediateSteps?.length > 0) {
    goal.intermediateSteps.forEach(step => {
      const stepDate = format(parseISO(step.date), 'd. MMM', { locale: de });
      const idx = chartDataWithTarget.findIndex(d => d.date === stepDate);
      if (idx >= 0) chartDataWithTarget[idx].Zwischenziel = step.targetValue;
    });
  }

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-white">{goal.name}</h3>
            <span className={`badge text-xs ${isWeekly ? 'bg-brand-900/50 text-brand-400' : 'bg-amber-900/50 text-amber-400'}`}>
              {isWeekly ? 'Wöchentlich' : 'Langfristig'}
            </span>
          </div>
          {goal.description && <p className="text-xs text-slate-500 mt-0.5">{goal.description}</p>}
          <p className="text-xs text-slate-500 mt-1">
            {conditionLabel} <span className="text-slate-300 font-medium">{goal.targetValue} {goal.unitSymbol}</span> pro Woche
          </p>
          {goal.endDate && (
            <p className="text-xs text-slate-600 mt-0.5">
              Bis {format(parseISO(goal.endDate), 'd. MMMM yyyy', { locale: de })}
            </p>
          )}
        </div>
      </div>

      {progress && (
        <div className="space-y-2 mb-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Diese Woche: <span className="text-slate-200 font-medium">{currentValue} {goal.unitSymbol}</span></span>
            <span className={`font-medium ${
              progressPct >= 100 ? 'text-emerald-400' :
              progressPct >= 60 ? 'text-amber-400' : 'text-red-400'
            }`}>{statusText}</span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${statusColor}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {currentStep && (
        <div className="bg-amber-900/20 border border-amber-800/30 rounded-xl px-3 py-2 text-xs mb-3">
          <span className="text-amber-400 font-medium">Nächster Schritt: </span>
          <span className="text-slate-300">{conditionLabel} {currentStep.targetValue} {goal.unitSymbol} bis {format(parseISO(currentStep.date), 'd. MMM yyyy', { locale: de })}</span>
          {currentStep.description && <span className="text-slate-500"> · {currentStep.description}</span>}
        </div>
      )}

      {!isWeekly && chartDataWithTarget.length > 0 && (
        <button
          onClick={() => setShowChart(v => !v)}
          className="text-xs text-brand-400 hover:text-brand-300 transition-colors mb-2"
        >
          {showChart ? 'Verlauf ausblenden' : 'Verlauf anzeigen'}
        </button>
      )}

      {showChart && chartDataWithTarget.length > 0 && (
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={chartDataWithTarget}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} />
            <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} width={30} />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9' }} />
            <Line type="monotone" dataKey="Wert" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="Ziel" stroke="#334155" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function CreateGoalModal({ habits, onSave, onClose }) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    type: 'weekly-activity',
    targetRef: 'gym',
    targetRefModel: 'activity',
    condition: 'min',
    targetValue: '',
    unitSymbol: 'Mal',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
  });
  const [steps, setSteps] = useState([]);
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleTypeChange = (type) => {
    const isActivity = type.includes('activity');
    set('type', type);
    set('targetRefModel', isActivity ? 'activity' : 'habit');
    set('targetRef', isActivity ? 'gym' : habits[0]?._id || '');
    set('unitSymbol', isActivity ? 'Mal' : habits[0]?.unitSymbol || '');
  };

  const handleRefChange = (ref) => {
    set('targetRef', ref);
    if (form.targetRefModel === 'habit') {
      const h = habits.find(h => h._id === ref);
      if (h) set('unitSymbol', h.unitSymbol);
    } else {
      set('unitSymbol', 'Mal');
    }
  };

  const addStep = () => setSteps(s => [...s, { date: '', targetValue: '', description: '' }]);
  const updateStep = (i, k, v) => setSteps(s => s.map((step, idx) => idx === i ? { ...step, [k]: v } : step));
  const removeStep = (i) => setSteps(s => s.filter((_, idx) => idx !== i));

  const isLongTerm = form.type.startsWith('long-term');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/goals', {
        ...form,
        targetValue: +form.targetValue,
        intermediateSteps: steps.filter(s => s.date && s.targetValue).map(s => ({
          ...s, targetValue: +s.targetValue
        })),
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
      });
      onSave();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="card w-full max-w-lg p-6 my-4">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white">Neues Ziel</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="z.B. Öfter joggen gehen" required />
          </div>
          <div>
            <label className="label">Beschreibung</label>
            <input className="input" value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Typ</label>
              <select className="input" value={form.type} onChange={e => handleTypeChange(e.target.value)}>
                <option value="weekly-activity">Wöchentl. Aktivität</option>
                <option value="weekly-habit">Wöchentl. Gewohnheit</option>
                <option value="long-term-activity">Langfr. Aktivität</option>
                <option value="long-term-habit">Langfr. Gewohnheit</option>
              </select>
            </div>
            <div>
              <label className="label">Bedingung</label>
              <select className="input" value={form.condition} onChange={e => set('condition', e.target.value)}>
                <option value="min">Mindestens</option>
                <option value="max">Maximal</option>
                <option value="exact">Genau</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label">{form.targetRefModel === 'activity' ? 'Aktivität' : 'Gewohnheit'}</label>
            <select className="input" value={form.targetRef} onChange={e => handleRefChange(e.target.value)}>
              {form.targetRefModel === 'activity'
                ? ACTIVITY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)
                : habits.map(h => <option key={h._id} value={h._id}>{h.name}</option>)
              }
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Zielwert</label>
              <input type="number" className="input" value={form.targetValue} onChange={e => set('targetValue', e.target.value)} min="0" step="0.1" placeholder="z.B. 3" required />
            </div>
            <div>
              <label className="label">Einheit</label>
              <input className="input" value={form.unitSymbol} onChange={e => set('unitSymbol', e.target.value)} placeholder="z.B. Mal" />
            </div>
          </div>

          {isLongTerm && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Startdatum</label>
                  <input type="date" className="input" value={form.startDate} onChange={e => set('startDate', e.target.value)} />
                </div>
                <div>
                  <label className="label">Enddatum</label>
                  <input type="date" className="input" value={form.endDate} onChange={e => set('endDate', e.target.value)} />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">Zwischenschritte</label>
                  <button type="button" onClick={addStep} className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1">
                    <Plus size={12} /> Hinzufügen
                  </button>
                </div>
                {steps.map((step, i) => (
                  <div key={i} className="flex gap-2 items-start mb-2">
                    <input type="date" className="input flex-1" value={step.date} onChange={e => updateStep(i, 'date', e.target.value)} />
                    <input type="number" className="input w-24" value={step.targetValue} onChange={e => updateStep(i, 'targetValue', e.target.value)} placeholder="Wert" />
                    <input className="input flex-1" value={step.description} onChange={e => updateStep(i, 'description', e.target.value)} placeholder="Beschreibung" />
                    <button type="button" onClick={() => removeStep(i)} className="text-red-400 hover:text-red-300 mt-2">
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? 'Speichern...' : 'Ziel erstellen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Goals() {
  const [goals, setGoals] = useState([]);
  const [habits, setHabits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [goalsRes, habitsRes] = await Promise.all([
        api.get('/goals'),
        api.get('/habits/definitions')
      ]);
      setGoals(goalsRes.data);
      setHabits(habitsRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id) => {
    if (!confirm('Ziel löschen?')) return;
    await api.delete(`/goals/${id}`);
    load();
  };

  const weekly = goals.filter(g => g.type.startsWith('weekly'));
  const longTerm = goals.filter(g => g.type.startsWith('long-term'));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Ziele</h1>
          <p className="text-slate-400 text-sm mt-0.5">{goals.length} aktive Ziele</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          <span className="hidden sm:inline">Neues Ziel</span>
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : goals.length === 0 ? (
        <div className="card p-12 text-center">
          <Target size={36} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">Noch keine Ziele definiert</p>
          <p className="text-slate-600 text-sm mt-1">Erstelle dein erstes Ziel</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary mt-4 inline-flex items-center gap-2">
            <Plus size={16} /> Ziel erstellen
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {weekly.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Wöchentliche Ziele</h2>
              <div className="space-y-3">
                {weekly.map(g => (
                  <div key={g._id} className="relative">
                    <GoalProgress goal={g} />
                    <button
                      onClick={() => handleDelete(g._id)}
                      className="absolute top-4 right-4 text-slate-600 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {longTerm.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Langfristige Ziele</h2>
              <div className="space-y-3">
                {longTerm.map(g => (
                  <div key={g._id} className="relative">
                    <GoalProgress goal={g} />
                    <button
                      onClick={() => handleDelete(g._id)}
                      className="absolute top-4 right-4 text-slate-600 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <CreateGoalModal
          habits={habits}
          onSave={() => { setShowCreate(false); load(); }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
