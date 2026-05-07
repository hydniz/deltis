import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { format, startOfWeek, addDays, addWeeks, subWeeks, isSameDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus, CheckCircle2, Circle, Trash2, X } from 'lucide-react';

const CARD_COLORS = [
  'border-brand-700 bg-brand-900/30',
  'border-emerald-700 bg-emerald-900/30',
  'border-amber-700 bg-amber-900/30',
  'border-sky-700 bg-sky-900/30',
  'border-purple-700 bg-purple-900/30',
  'border-lime-700 bg-lime-900/30',
  'border-orange-700 bg-orange-900/30',
  'border-slate-700 bg-slate-800/50',
];

// ─── Plan erstellen ──────────────────────────────────────────────────────────

function PlanForm({ date, activityTypes, onSave, onClose }) {
  const [form, setForm] = useState({
    activityTypeId: activityTypes[0]?._id || '',
    scheduledDate: format(date, 'yyyy-MM-dd'),
    duration: '',
    distance: '',
    notes: ''
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const selectedType = activityTypes.find(t => t._id === form.activityTypeId);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedType) return;
    setSaving(true);
    try {
      await api.post('/planner', {
        activityType: selectedType.label,
        activityTypeRef: selectedType._id,
        scheduledDate: form.scheduledDate,
        duration: form.duration ? +form.duration : undefined,
        distance: form.distance ? +form.distance : undefined,
        notes: form.notes || undefined,
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
            <select className="input" value={form.activityTypeId} onChange={e => set('activityTypeId', e.target.value)}>
              {activityTypes.map(t => <option key={t._id} value={t._id}>{t.label}</option>)}
            </select>
          </div>
          {selectedType?.showDuration !== false && (
            <div>
              <label className="label">Dauer (min)</label>
              <input type="number" className="input" value={form.duration} onChange={e => set('duration', e.target.value)} min="1" placeholder="z.B. 60" />
            </div>
          )}
          {selectedType?.showDistance && (
            <div>
              <label className="label">Distanz (km)</label>
              <input type="number" className="input" value={form.distance} onChange={e => set('distance', e.target.value)} min="0" step="0.1" placeholder="z.B. 5.5" />
            </div>
          )}
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

// ─── Plan vervollständigen → Aktivität loggen ────────────────────────────────

function CompleteActivityModal({ plan, onSave, onClose }) {
  // plan.activityTypeRef ist vom Backend populiert: { _id, label, showDistance, showDuration, customFields }
  const typeConfig = plan.activityTypeRef || {};

  const [form, setForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    duration: plan.duration || '',
    distance: plan.distance || '',
    notes: plan.notes || '',
  });
  const [customValues, setCustomValues] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/activities', {
        activityType: typeConfig.label || plan.activityType,
        activityTypeRef: typeConfig._id || plan.activityTypeRef,
        date: form.date,
        duration: form.duration ? +form.duration : undefined,
        distance: form.distance ? +form.distance : undefined,
        notes: form.notes || undefined,
        customValues,
      });
      await api.put(`/planner/${plan._id}`, { completed: true });
      onSave();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const activityLabel = typeConfig.label || plan.activityType || 'Aktivität';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-white">Aktivität vervollständigen</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200"><X size={20} /></button>
        </div>
        <p className="text-sm text-slate-400 mb-5">{activityLabel}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Datum</label>
            <input
              type="date"
              className="input"
              value={form.date}
              onChange={e => set('date', e.target.value)}
              required
            />
          </div>

          {typeConfig.showDuration !== false && (
            <div>
              <label className="label">Dauer (min)</label>
              <input
                type="number"
                className="input"
                value={form.duration}
                onChange={e => set('duration', e.target.value)}
                min="1"
                placeholder="z.B. 60"
              />
            </div>
          )}

          {typeConfig.showDistance && (
            <div>
              <label className="label">Distanz (km)</label>
              <input
                type="number"
                className="input"
                value={form.distance}
                onChange={e => set('distance', e.target.value)}
                min="0"
                step="0.1"
                placeholder="z.B. 5.5"
              />
            </div>
          )}

          {(typeConfig.customFields || []).map(field => (
            <div key={field.key}>
              <label className="label">
                {field.label}
                {field.unit && <span className="text-slate-600 ml-1">({field.unit})</span>}
              </label>
              {field.type === 'select' ? (
                <select
                  className="input"
                  value={customValues[field.key] || ''}
                  onChange={e => setCustomValues(cv => ({ ...cv, [field.key]: e.target.value }))}
                >
                  <option value="">– Keine Auswahl –</option>
                  {field.options.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="number"
                    className="input flex-1"
                    value={customValues[field.key] || ''}
                    onChange={e => setCustomValues(cv => ({ ...cv, [field.key]: e.target.value }))}
                    min="0"
                    step="0.01"
                    placeholder={field.unit ? `in ${field.unit}` : ''}
                  />
                  {field.unit && (
                    <span className="flex items-center px-3 bg-slate-700 rounded-xl text-slate-400 text-sm whitespace-nowrap">
                      {field.unit}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}

          <div>
            <label className="label">Notizen</label>
            <textarea
              className="input resize-none"
              rows={2}
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Optional..."
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2">
              <CheckCircle2 size={16} />
              {saving ? 'Speichern...' : 'Als erledigt loggen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Hauptseite ──────────────────────────────────────────────────────────────

export default function Planner() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [plans, setPlans] = useState([]);
  const [activityTypes, setActivityTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addFor, setAddFor] = useState(null);
  const [completingPlan, setCompletingPlan] = useState(null);

  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [plansRes, typesRes] = await Promise.all([
        api.get('/planner', {
          params: { startDate: format(weekStart, 'yyyy-MM-dd'), endDate: format(weekEnd, 'yyyy-MM-dd') }
        }),
        api.get('/activity-types'),
      ]);
      setPlans(plansRes.data);
      setActivityTypes(typesRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => { load(); }, [load]);

  const handleComplete = (plan) => {
    if (plan.completed) {
      // Rückgängig: einfach als nicht abgeschlossen markieren
      api.put(`/planner/${plan._id}`, { completed: false }).then(load);
    } else {
      // Modal öffnen, um die Aktivität zu erfassen und zu loggen
      setCompletingPlan(plan);
    }
  };

  const handleDelete = async (id) => {
    await api.delete(`/planner/${id}`);
    load();
  };

  const getCardColor = (plan) => {
    const ref = plan.activityTypeRef?._id || plan.activityTypeRef || plan.activityType || '';
    const hash = [...ref.toString()].reduce((h, c) => h + c.charCodeAt(0), 0);
    return CARD_COLORS[hash % CARD_COLORS.length];
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
            const dayDate = format(day, 'yyyy-MM-dd');
            const dayPlans = plans.filter(p => (p.scheduledDate || '').slice(0, 10) === dayDate);
            const isToday_ = isSameDay(day, today);
            return (
              <div key={day.toISOString()} className={`card p-3 ${isToday_ ? 'border-brand-600/50' : ''}`}>
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
                    <div key={plan._id} className={`rounded-lg border p-2 ${getCardColor(plan)} ${plan.completed ? 'opacity-60' : ''}`}>
                      <div className="flex items-start justify-between gap-1">
                        <button
                          onClick={() => handleComplete(plan)}
                          className="flex-shrink-0 mt-0.5"
                          title={plan.completed ? 'Als offen markieren' : 'Als erledigt loggen'}
                        >
                          {plan.completed
                            ? <CheckCircle2 size={14} className="text-emerald-400" />
                            : <Circle size={14} className="text-slate-500 hover:text-emerald-400 transition-colors" />
                          }
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium leading-tight ${plan.completed ? 'line-through text-slate-500' : 'text-slate-200'}`}>
                            {(() => {
                              const current = plan.activityTypeRef?.label || plan.activityType;
                              return plan.historicalLabel ? `${current} (${plan.historicalLabel})` : current;
                            })()}
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

      {addFor && activityTypes.length > 0 && (
        <PlanForm
          date={addFor}
          activityTypes={activityTypes}
          onSave={() => { setAddFor(null); load(); }}
          onClose={() => setAddFor(null)}
        />
      )}

      {completingPlan && (
        <CompleteActivityModal
          plan={completingPlan}
          onSave={() => { setCompletingPlan(null); load(); }}
          onClose={() => setCompletingPlan(null)}
        />
      )}
    </div>
  );
}
