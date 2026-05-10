import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { format, startOfWeek, addDays, addWeeks, subWeeks, isSameDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus, CheckCircle2, Circle, Trash2, X, Dumbbell, Sparkles } from 'lucide-react';

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

// ─── Custom Field Input ───────────────────────────────────────────────────────

function CustomFieldInput({ field, value, onChange }) {
  if (field.type === 'select') {
    return (
      <select className="input" value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">– Keine Auswahl –</option>
        {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    );
  }
  if (field.type === 'multiselect') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-2 px-1">
        {field.options.map(opt => (
          <label key={opt} className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={selected.includes(opt)}
              onChange={e => onChange(e.target.checked ? [...selected, opt] : selected.filter(v => v !== opt))}
              className="w-4 h-4 accent-violet-600"
            />
            <span className="text-sm text-slate-300">{opt}</span>
          </label>
        ))}
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <input type="number" className="input flex-1" value={value || ''}
        onChange={e => onChange(e.target.value)} min="0" step="0.01" placeholder={field.unit ? `in ${field.unit}` : ''} />
      {field.unit && (
        <span className="flex items-center px-3 bg-slate-700 rounded-xl text-slate-400 text-sm whitespace-nowrap">{field.unit}</span>
      )}
    </div>
  );
}

// ─── Plan hinzufügen (Aktivität oder Gewohnheit) ─────────────────────────────

function AddPlanModal({ date, activityTypes, habits, onSave, onClose }) {
  const [mode, setMode] = useState(activityTypes.length > 0 ? 'activity' : 'habit');

  // Activity form
  const [actForm, setActForm] = useState({
    activityTypeId: activityTypes[0]?._id || '',
    duration: '',
    distance: '',
    notes: '',
  });
  const [customValues, setCustomValues] = useState({});
  const selectedType = activityTypes.find(t => t._id === actForm.activityTypeId);

  // Habit form
  const [habitForm, setHabitForm] = useState({
    habitId: habits[0]?._id || '',
    notes: '',
  });
  const selectedHabit = habits.find(h => h._id === habitForm.habitId);

  const [saving, setSaving] = useState(false);
  const scheduledDate = format(date, 'yyyy-MM-dd');

  const setAct = (k, v) => setActForm(f => ({ ...f, [k]: v }));
  const setHab = (k, v) => setHabitForm(f => ({ ...f, [k]: v }));

  const handleSubmitActivity = async (e) => {
    e.preventDefault();
    if (!selectedType) return;
    setSaving(true);
    try {
      await api.post('/planner', {
        activityType: selectedType.label,
        activityTypeRef: selectedType._id,
        scheduledDate,
        duration: actForm.duration ? +actForm.duration : undefined,
        distance: actForm.distance ? +actForm.distance : undefined,
        notes: actForm.notes || undefined,
        customValues,
      });
      onSave();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitHabit = async (e) => {
    e.preventDefault();
    if (!selectedHabit) return;
    setSaving(true);
    try {
      await api.post('/planner/habits', {
        habitId: selectedHabit._id,
        scheduledDate,
        notes: habitForm.notes || undefined,
      });
      onSave();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-700/50 w-full max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col" style={{ maxHeight: '90dvh' }}>
        <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mt-3 sm:hidden flex-shrink-0" />

        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-800 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-white">Plan hinzufügen</h2>
            <p className="text-xs text-slate-500 mt-0.5">{format(date, 'EEEE, d. MMMM', { locale: de })}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200 p-1 -mr-1"><X size={20} /></button>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2 px-5 pt-4 flex-shrink-0">
          {activityTypes.length > 0 && (
            <button type="button" onClick={() => setMode('activity')}
              className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors ${mode === 'activity' ? 'border-brand-500 bg-brand-950/60 text-white' : 'border-slate-700 bg-slate-800/40 text-slate-400'}`}
            ><Dumbbell size={13} /> Aktivität</button>
          )}
          {habits.length > 0 && (
            <button type="button" onClick={() => setMode('habit')}
              className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors ${mode === 'habit' ? 'border-emerald-500 bg-emerald-950/60 text-white' : 'border-slate-700 bg-slate-800/40 text-slate-400'}`}
            ><Sparkles size={13} /> Gewohnheit</button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {mode === 'activity' && activityTypes.length > 0 && (
            <form id="add-form" onSubmit={handleSubmitActivity} className="space-y-4">
              <div>
                <label className="label">Aktivität</label>
                <select className="input" value={actForm.activityTypeId}
                  onChange={e => { setAct('activityTypeId', e.target.value); setCustomValues({}); }}>
                  {activityTypes.map(t => <option key={t._id} value={t._id}>{t.label}</option>)}
                </select>
              </div>
              {selectedType?.showDuration !== false && (
                <div>
                  <label className="label">Dauer (min)</label>
                  <input type="number" className="input" value={actForm.duration} onChange={e => setAct('duration', e.target.value)} min="1" placeholder="z.B. 60" />
                </div>
              )}
              {selectedType?.showDistance && (
                <div>
                  <label className="label">Distanz (km)</label>
                  <input type="number" className="input" value={actForm.distance} onChange={e => setAct('distance', e.target.value)} min="0" step="0.1" placeholder="z.B. 5.5" />
                </div>
              )}
              {selectedType?.customFields?.map(field => (
                <div key={field.key}>
                  <label className="label">{field.label}{field.unit && <span className="text-slate-500 ml-1">({field.unit})</span>}</label>
                  <CustomFieldInput field={field} value={customValues[field.key]} onChange={v => setCustomValues(cv => ({ ...cv, [field.key]: v }))} />
                </div>
              ))}
              <div>
                <label className="label">Notizen</label>
                <textarea className="input resize-none" rows={2} value={actForm.notes} onChange={e => setAct('notes', e.target.value)} placeholder="Optional..." />
              </div>
            </form>
          )}

          {mode === 'habit' && habits.length > 0 && (
            <form id="add-form" onSubmit={handleSubmitHabit} className="space-y-4">
              <div>
                <label className="label">Gewohnheit</label>
                <select className="input" value={habitForm.habitId} onChange={e => setHab('habitId', e.target.value)}>
                  {habits.map(h => <option key={h._id} value={h._id}>{h.name}{h.unitSymbol ? ` (${h.unitSymbol})` : ''}</option>)}
                </select>
                {selectedHabit && (
                  <p className="text-xs text-slate-500 mt-1.5">
                    {selectedHabit.type === 'boolean' && 'Wird mit einem Klick als erledigt markiert.'}
                    {selectedHabit.type === 'amount' && `Beim Abhaken kannst du die Menge in ${selectedHabit.unitSymbol || 'Einheiten'} eintragen.`}
                    {selectedHabit.type === 'duration' && `Beim Abhaken kannst du die Dauer in ${selectedHabit.unitSymbol || 'min'} eintragen.`}
                  </p>
                )}
              </div>
              <div>
                <label className="label">Notizen <span className="text-slate-600 font-normal">(optional)</span></label>
                <textarea className="input resize-none" rows={2} value={habitForm.notes} onChange={e => setHab('notes', e.target.value)} placeholder="Erinnerung, Kontext..." />
              </div>
            </form>
          )}

          {mode === 'activity' && activityTypes.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-4">Keine Aktivitätstypen vorhanden.</p>
          )}
          {mode === 'habit' && habits.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-4">Keine Gewohnheiten vorhanden.</p>
          )}
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-slate-800 flex-shrink-0">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
          <button type="submit" form="add-form" disabled={saving} className="btn-primary flex-1">
            {saving ? 'Speichern…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Aktivität vervollständigen → loggen ─────────────────────────────────────

function CompleteActivityModal({ plan, onSave, onClose }) {
  const typeConfig = plan.activityTypeRef || {};
  const [form, setForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    duration: plan.duration || '',
    distance: plan.distance || '',
    notes: plan.notes || '',
  });
  const [customValues, setCustomValues] = useState(plan.customValues || {});
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

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-700/50 w-full max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col" style={{ maxHeight: '90dvh' }}>
        <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mt-3 sm:hidden flex-shrink-0" />
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-800 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-white">Aktivität loggen</h2>
            <p className="text-xs text-slate-400 mt-0.5">{typeConfig.label || plan.activityType}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200 p-1 -mr-1"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <form id="complete-act-form" onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Datum</label>
              <input type="date" className="input" value={form.date} onChange={e => set('date', e.target.value)} required />
            </div>
            {typeConfig.showDuration !== false && (
              <div>
                <label className="label">Dauer (min)</label>
                <input type="number" className="input" value={form.duration} onChange={e => set('duration', e.target.value)} min="1" placeholder="z.B. 60" />
              </div>
            )}
            {typeConfig.showDistance && (
              <div>
                <label className="label">Distanz (km)</label>
                <input type="number" className="input" value={form.distance} onChange={e => set('distance', e.target.value)} min="0" step="0.1" placeholder="z.B. 5.5" />
              </div>
            )}
            {(typeConfig.customFields || []).map(field => (
              <div key={field.key}>
                <label className="label">{field.label}{field.unit && <span className="text-slate-500 ml-1">({field.unit})</span>}</label>
                <CustomFieldInput field={field} value={customValues[field.key]} onChange={v => setCustomValues(cv => ({ ...cv, [field.key]: v }))} />
              </div>
            ))}
            <div>
              <label className="label">Notizen</label>
              <textarea className="input resize-none" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional..." />
            </div>
          </form>
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-slate-800 flex-shrink-0">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
          <button type="submit" form="complete-act-form" disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2">
            <CheckCircle2 size={16} />
            {saving ? 'Speichern…' : 'Als erledigt loggen'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Gewohnheit vervollständigen → loggen ────────────────────────────────────

function CompleteHabitModal({ plan, onSave, onClose }) {
  const isBoolean = plan.habitType === 'boolean';
  const [value, setValue] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/planner/habits/${plan._id}/complete`, {
        value: isBoolean ? 1 : (value !== '' ? +value : 1),
        date,
      });
      onSave();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-700/50 w-full max-w-sm rounded-t-2xl sm:rounded-2xl flex flex-col">
        <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mt-3 sm:hidden flex-shrink-0" />
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-800 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-white">Gewohnheit abhaken</h2>
            <p className="text-xs text-emerald-400 mt-0.5">{plan.habitName}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200 p-1 -mr-1"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="label">Datum</label>
            <input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} required />
          </div>
          {!isBoolean && (
            <div>
              <label className="label">
                Wert{plan.unitSymbol ? ` (${plan.unitSymbol})` : ''}
              </label>
              <input type="number" className="input" value={value}
                onChange={e => setValue(e.target.value)}
                min="0" step="0.01" placeholder={`z.B. 1 ${plan.unitSymbol || ''}`}
                autoFocus
              />
            </div>
          )}
          {isBoolean && (
            <p className="text-sm text-slate-400">
              <Sparkles size={14} className="inline text-emerald-400 mr-1.5" />
              Wird als erledigt in dein Tagebuch eingetragen.
            </p>
          )}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2">
              <CheckCircle2 size={16} />
              {saving ? 'Speichern…' : 'Erledigt'}
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
  const [habitPlans, setHabitPlans] = useState([]);
  const [activityTypes, setActivityTypes] = useState([]);
  const [habits, setHabits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addFor, setAddFor] = useState(null);
  const [completingPlan, setCompletingPlan] = useState(null);
  const [completingHabitPlan, setCompletingHabitPlan] = useState(null);

  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { startDate: format(weekStart, 'yyyy-MM-dd'), endDate: format(weekEnd, 'yyyy-MM-dd') };
      const [plansRes, habitPlansRes, typesRes, habitsRes] = await Promise.all([
        api.get('/planner', { params }),
        api.get('/planner/habits', { params }),
        api.get('/activity-types'),
        api.get('/habits/definitions'),
      ]);
      setPlans(plansRes.data);
      setHabitPlans(habitPlansRes.data);
      setActivityTypes(typesRes.data);
      setHabits(habitsRes.data.filter(h => h.selected));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => { load(); }, [load]);

  const handleCompleteActivity = (plan) => {
    if (plan.completed) {
      api.put(`/planner/${plan._id}`, { completed: false }).then(load);
    } else {
      setCompletingPlan(plan);
    }
  };

  const handleCompleteHabit = (plan) => {
    if (plan.completed) {
      api.put(`/planner/habits/${plan._id}`, { completed: false }).then(load);
    } else if (plan.habitType === 'boolean') {
      setCompletingHabitPlan(plan); // still open modal for date selection
    } else {
      setCompletingHabitPlan(plan);
    }
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
          <button onClick={() => setWeekStart(w => subWeeks(w, 1))} className="btn-secondary p-2"><ChevronLeft size={18} /></button>
          <button onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))} className="btn-secondary px-3 py-2 text-sm">Heute</button>
          <button onClick={() => setWeekStart(w => addWeeks(w, 1))} className="btn-secondary p-2"><ChevronRight size={18} /></button>
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
            const dayHabitPlans = habitPlans.filter(p => (p.scheduledDate || '').slice(0, 10) === dayDate);
            const isToday_ = isSameDay(day, today);
            const totalItems = dayPlans.length + dayHabitPlans.length;

            return (
              <div key={day.toISOString()} className={`card p-3 ${isToday_ ? 'border-brand-600/50' : ''}`}>
                {/* Day header */}
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className={`text-xs font-semibold uppercase tracking-wide ${isToday_ ? 'text-brand-400' : 'text-slate-500'}`}>
                      {format(day, 'EEE', { locale: de })}
                    </p>
                    <p className={`text-lg font-bold ${isToday_ ? 'text-brand-300' : 'text-slate-300'}`}>
                      {format(day, 'd')}
                    </p>
                  </div>
                  <button onClick={() => setAddFor(day)}
                    className="w-9 h-9 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-brand-700 text-slate-400 hover:text-white transition-colors"
                  >
                    <Plus size={15} />
                  </button>
                </div>

                <div className="space-y-2">
                  {/* Activity plans */}
                  {dayPlans.map(plan => (
                    <div key={plan._id} className={`rounded-lg border p-2 ${getCardColor(plan)} ${plan.completed ? 'opacity-60' : ''}`}>
                      <div className="flex items-start justify-between gap-1">
                        <button onClick={() => handleCompleteActivity(plan)} className="flex-shrink-0 mt-0.5"
                          title={plan.completed ? 'Als offen markieren' : 'Als erledigt loggen'}>
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
                          {(plan.duration || plan.distance) && (
                            <p className="text-xs text-slate-500 mt-0.5">
                              {plan.duration ? `${plan.duration} min` : ''}
                              {plan.duration && plan.distance ? ' · ' : ''}
                              {plan.distance ? `${plan.distance} km` : ''}
                            </p>
                          )}
                        </div>
                        <button onClick={() => api.delete(`/planner/${plan._id}`).then(load)}
                          className="flex-shrink-0 text-slate-600 hover:text-red-400 transition-colors p-1 -mr-1">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Habit plans */}
                  {dayHabitPlans.map(plan => (
                    <div key={plan._id}
                      className={`rounded-lg border p-2 ${plan.completed
                        ? 'border-emerald-800/40 bg-emerald-900/20 opacity-60'
                        : 'border-emerald-700/50 bg-emerald-900/20'}`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <button onClick={() => handleCompleteHabit(plan)} className="flex-shrink-0 mt-0.5"
                          title={plan.completed ? 'Als offen markieren' : 'Als erledigt markieren'}>
                          {plan.completed
                            ? <CheckCircle2 size={14} className="text-emerald-400" />
                            : <Circle size={14} className="text-emerald-600 hover:text-emerald-400 transition-colors" />
                          }
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <Sparkles size={10} className="text-emerald-500 flex-shrink-0" />
                            <p className={`text-xs font-medium leading-tight truncate ${plan.completed ? 'line-through text-slate-500' : 'text-emerald-200'}`}>
                              {plan.habitId?.name || plan.habitName}
                            </p>
                          </div>
                          {plan.completed && plan.loggedValue != null && plan.habitType !== 'boolean' && (
                            <p className="text-xs text-slate-500 mt-0.5">
                              {plan.loggedValue} {plan.unitSymbol}
                            </p>
                          )}
                          {plan.notes && !plan.completed && (
                            <p className="text-xs text-slate-600 mt-0.5 truncate">{plan.notes}</p>
                          )}
                        </div>
                        <button onClick={() => api.delete(`/planner/habits/${plan._id}`).then(load)}
                          className="flex-shrink-0 text-slate-600 hover:text-red-400 transition-colors p-1 -mr-1">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}

                  {totalItems === 0 && (
                    <p className="text-xs text-slate-700 text-center py-2">Frei</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {addFor && (
        <AddPlanModal
          date={addFor}
          activityTypes={activityTypes}
          habits={habits}
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

      {completingHabitPlan && (
        <CompleteHabitModal
          plan={completingHabitPlan}
          onSave={() => { setCompletingHabitPlan(null); load(); }}
          onClose={() => setCompletingHabitPlan(null)}
        />
      )}
    </div>
  );
}
