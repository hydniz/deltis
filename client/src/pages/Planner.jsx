import { useState, useEffect } from 'react';
import api from '../utils/api';
import { format, startOfWeek, addDays, addWeeks, subWeeks, isSameDay, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus, CheckCircle2, Circle, Trash2, X } from 'lucide-react';

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

const TYPE_COLORS = {
  gym: 'border-brand-700 bg-brand-900/30',
  jogging: 'border-emerald-700 bg-emerald-900/30',
  cycling: 'border-amber-700 bg-amber-900/30',
  swimming: 'border-sky-700 bg-sky-900/30',
  yoga: 'border-purple-700 bg-purple-900/30',
  hiking: 'border-lime-700 bg-lime-900/30',
  sports: 'border-orange-700 bg-orange-900/30',
  other: 'border-slate-700 bg-slate-800/50',
};

function PlanForm({ date, onSave, onClose }) {
  const [form, setForm] = useState({
    activityType: 'gym',
    scheduledDate: date.toISOString().slice(0, 10),
    duration: '',
    distance: '',
    notes: ''
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/planner', {
        ...form,
        duration: form.duration ? +form.duration : undefined,
        distance: form.distance ? +form.distance : undefined,
      });
      onSave();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white">
            Plan für {format(date, 'EEEE, d. MMM', { locale: de })}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Aktivität</label>
            <select className="input" value={form.activityType} onChange={e => set('activityType', e.target.value)}>
              {ACTIVITY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Dauer (min)</label>
              <input type="number" className="input" value={form.duration} onChange={e => set('duration', e.target.value)} min="1" placeholder="z.B. 60" />
            </div>
            <div>
              <label className="label">Distanz (km)</label>
              <input type="number" className="input" value={form.distance} onChange={e => set('distance', e.target.value)} min="0" step="0.1" placeholder="z.B. 5.5" />
            </div>
          </div>
          <div>
            <label className="label">Notizen</label>
            <textarea className="input resize-none" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional..." />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? 'Speichern...' : 'Speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Planner() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addFor, setAddFor] = useState(null);

  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/planner', {
        params: { startDate: weekStart.toISOString(), endDate: weekEnd.toISOString() }
      });
      setPlans(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [weekStart]);

  const toggleComplete = async (plan) => {
    await api.put(`/planner/${plan._id}`, { completed: !plan.completed });
    load();
  };

  const handleDelete = async (id) => {
    await api.delete(`/planner/${id}`);
    load();
  };

  const today = new Date();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Wochenplan</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {format(weekStart, 'd. MMM', { locale: de })} – {format(weekEnd, 'd. MMM yyyy', { locale: de })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekStart(w => subWeeks(w, 1))} className="btn-secondary p-2">
            <ChevronLeft size={18} />
          </button>
          <button onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))} className="btn-secondary px-3 py-2 text-sm">
            Heute
          </button>
          <button onClick={() => setWeekStart(w => addWeeks(w, 1))} className="btn-secondary p-2">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-7 gap-3">
          {days.map(day => {
            const dayPlans = plans.filter(p => isSameDay(parseISO(p.scheduledDate), day));
            const isToday_ = isSameDay(day, today);
            return (
              <div key={day.toISOString()} className={`card p-3 ${isToday_ ? 'border-brand-600/50 bg-brand-950/20' : ''}`}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className={`text-xs font-semibold uppercase tracking-wide ${isToday_ ? 'text-brand-400' : 'text-slate-500'}`}>
                      {format(day, 'EEE', { locale: de })}
                    </p>
                    <p className={`text-lg font-bold ${isToday_ ? 'text-brand-300' : 'text-slate-300'}`}>
                      {format(day, 'd')}
                    </p>
                  </div>
                  <button
                    onClick={() => setAddFor(day)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-brand-700 text-slate-400 hover:text-white transition-colors"
                  >
                    <Plus size={14} />
                  </button>
                </div>

                <div className="space-y-2">
                  {dayPlans.map(plan => (
                    <div
                      key={plan._id}
                      className={`rounded-lg border p-2 ${TYPE_COLORS[plan.activityType] || TYPE_COLORS.other} ${plan.completed ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <button onClick={() => toggleComplete(plan)} className="flex-shrink-0 mt-0.5">
                          {plan.completed
                            ? <CheckCircle2 size={14} className="text-emerald-400" />
                            : <Circle size={14} className="text-slate-500" />
                          }
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium leading-tight ${plan.completed ? 'line-through text-slate-500' : 'text-slate-200'}`}>
                            {ACTIVITY_TYPES.find(t => t.value === plan.activityType)?.label || plan.activityType}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {plan.duration ? `${plan.duration} min` : ''}
                            {plan.duration && plan.distance ? ' · ' : ''}
                            {plan.distance ? `${plan.distance} km` : ''}
                          </p>
                        </div>
                        <button onClick={() => handleDelete(plan._id)} className="flex-shrink-0 text-slate-600 hover:text-red-400 transition-colors">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {dayPlans.length === 0 && (
                    <p className="text-xs text-slate-700 text-center py-2">Frei</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {addFor && <PlanForm date={addFor} onSave={() => { setAddFor(null); load(); }} onClose={() => setAddFor(null)} />}
    </div>
  );
}
