import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { format, startOfWeek, addDays, addWeeks, subWeeks, isSameDay } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  ChevronLeft, ChevronRight, Plus, CheckCircle2, Circle, Trash2,
  Dumbbell, Sparkles, CalendarDays,
} from 'lucide-react';
import {
  PageHeader, Button, Field, Input, Select, Textarea, Chip, chipColorFor,
  Modal, PageLoader,
} from '../components/ui';

// Card tints per activity type — light pastel surfaces matching the chip palette
const CARD_COLORS = [
  'border-brand-200 bg-brand-50',
  'border-sage-200 bg-sage-100/60',
  'border-ocher-200 bg-ocher-100/60',
  'border-rose-200 bg-rose-50',
  'border-lime-200 bg-lime-50',
];

// Custom field input

function CustomFieldInput({ field, value, onChange }) {
  if (field.type === 'select') {
    return (
      <Select value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">– Keine Auswahl –</option>
        {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </Select>
    );
  }
  if (field.type === 'multiselect') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-wrap gap-1.5">
        {field.options.map(opt => (
          <Chip
            key={opt}
            color="clay"
            active={selected.includes(opt)}
            onClick={() => onChange(
              selected.includes(opt) ? selected.filter(v => v !== opt) : [...selected, opt]
            )}
          >
            {opt}
          </Chip>
        ))}
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <Input
        type="number"
        className="flex-1"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        min="0"
        step="0.01"
        placeholder={field.unit ? `in ${field.unit}` : ''}
      />
      {field.unit && (
        <span className="flex items-center px-3 panel text-ink-500 text-sm whitespace-nowrap">{field.unit}</span>
      )}
    </div>
  );
}

// Add plan (activity or habit)

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
    <Modal
      onClose={onClose}
      title="Plan hinzufügen"
      subtitle={format(date, 'EEEE, d. MMMM', { locale: de })}
      icon={CalendarDays}
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>Abbrechen</Button>
          <Button type="submit" form="add-form" className="flex-1" loading={saving}>
            Speichern
          </Button>
        </>
      }
    >
      {/* Mode toggle */}
      <div className="flex gap-2 mb-5">
        {activityTypes.length > 0 && (
          <button
            type="button"
            onClick={() => setMode('activity')}
            className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors ${
              mode === 'activity'
                ? 'border-brand-400 bg-brand-50 text-brand-700'
                : 'border-paper-200 bg-paper-50 text-ink-400 hover:text-ink-600'
            }`}
          >
            <Dumbbell size={13} /> Aktivität
          </button>
        )}
        {habits.length > 0 && (
          <button
            type="button"
            onClick={() => setMode('habit')}
            className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors ${
              mode === 'habit'
                ? 'border-sage-400 bg-sage-100/70 text-sage-700'
                : 'border-paper-200 bg-paper-50 text-ink-400 hover:text-ink-600'
            }`}
          >
            <Sparkles size={13} /> Gewohnheit
          </button>
        )}
      </div>

      {mode === 'activity' && activityTypes.length > 0 && (
        <form id="add-form" onSubmit={handleSubmitActivity} className="space-y-4">
          <Field label="Aktivität">
            <Select
              value={actForm.activityTypeId}
              onChange={e => { setAct('activityTypeId', e.target.value); setCustomValues({}); }}
            >
              {activityTypes.map(t => <option key={t._id} value={t._id}>{t.label}</option>)}
            </Select>
          </Field>
          {selectedType?.showDuration !== false && (
            <Field label="Dauer (min)">
              <Input type="number" value={actForm.duration} onChange={e => setAct('duration', e.target.value)} min="1" placeholder="z.B. 60" />
            </Field>
          )}
          {selectedType?.showDistance && (
            <Field label="Distanz (km)">
              <Input type="number" value={actForm.distance} onChange={e => setAct('distance', e.target.value)} min="0" step="0.1" placeholder="z.B. 5.5" />
            </Field>
          )}
          {selectedType?.customFields?.map(field => (
            <Field
              key={field.key}
              label={<>{field.label}{field.unit && <span className="text-ink-300 ml-1 normal-case">({field.unit})</span>}</>}
            >
              <CustomFieldInput field={field} value={customValues[field.key]} onChange={v => setCustomValues(cv => ({ ...cv, [field.key]: v }))} />
            </Field>
          ))}
          <Field label="Notizen">
            <Textarea rows={2} value={actForm.notes} onChange={e => setAct('notes', e.target.value)} placeholder="Optional…" />
          </Field>
        </form>
      )}

      {mode === 'habit' && habits.length > 0 && (
        <form id="add-form" onSubmit={handleSubmitHabit} className="space-y-4">
          <Field
            label="Gewohnheit"
            hint={selectedHabit && (
              selectedHabit.type === 'boolean' ? 'Wird mit einem Klick als erledigt markiert.'
              : selectedHabit.type === 'amount' ? `Beim Abhaken kannst du die Menge in ${selectedHabit.unitSymbol || 'Einheiten'} eintragen.`
              : `Beim Abhaken kannst du die Dauer in ${selectedHabit.unitSymbol || 'min'} eintragen.`
            )}
          >
            <Select value={habitForm.habitId} onChange={e => setHab('habitId', e.target.value)}>
              {habits.map(h => <option key={h._id} value={h._id}>{h.name}{h.unitSymbol ? ` (${h.unitSymbol})` : ''}</option>)}
            </Select>
          </Field>
          <Field label="Notizen" optional>
            <Textarea rows={2} value={habitForm.notes} onChange={e => setHab('notes', e.target.value)} placeholder="Erinnerung, Kontext…" />
          </Field>
        </form>
      )}

      {mode === 'activity' && activityTypes.length === 0 && (
        <p className="text-sm text-ink-400 text-center py-4">Keine Aktivitätstypen vorhanden.</p>
      )}
      {mode === 'habit' && habits.length === 0 && (
        <p className="text-sm text-ink-400 text-center py-4">Keine Gewohnheiten vorhanden.</p>
      )}
    </Modal>
  );
}

// Complete activity → log

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
    <Modal
      onClose={onClose}
      title="Aktivität loggen"
      subtitle={typeConfig.label || plan.activityType}
      icon={CheckCircle2}
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>Abbrechen</Button>
          <Button type="submit" form="complete-act-form" className="flex-1" loading={saving} icon={CheckCircle2}>
            Als erledigt loggen
          </Button>
        </>
      }
    >
      <form id="complete-act-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="Datum">
          <Input type="date" value={form.date} onChange={e => set('date', e.target.value)} required />
        </Field>
        {typeConfig.showDuration !== false && (
          <Field label="Dauer (min)">
            <Input type="number" value={form.duration} onChange={e => set('duration', e.target.value)} min="1" placeholder="z.B. 60" />
          </Field>
        )}
        {typeConfig.showDistance && (
          <Field label="Distanz (km)">
            <Input type="number" value={form.distance} onChange={e => set('distance', e.target.value)} min="0" step="0.1" placeholder="z.B. 5.5" />
          </Field>
        )}
        {(typeConfig.customFields || []).map(field => (
          <Field
            key={field.key}
            label={<>{field.label}{field.unit && <span className="text-ink-300 ml-1 normal-case">({field.unit})</span>}</>}
          >
            <CustomFieldInput field={field} value={customValues[field.key]} onChange={v => setCustomValues(cv => ({ ...cv, [field.key]: v }))} />
          </Field>
        ))}
        <Field label="Notizen">
          <Textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional…" />
        </Field>
      </form>
    </Modal>
  );
}

// Complete habit → log

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
    <Modal
      onClose={onClose}
      title="Gewohnheit abhaken"
      subtitle={plan.habitName}
      icon={Sparkles}
      size="sm"
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>Abbrechen</Button>
          <Button type="submit" form="complete-habit-form" className="flex-1" loading={saving} icon={CheckCircle2}>
            Erledigt
          </Button>
        </>
      }
    >
      <form id="complete-habit-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="Datum">
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} required />
        </Field>
        {!isBoolean && (
          <Field label={`Wert${plan.unitSymbol ? ` (${plan.unitSymbol})` : ''}`}>
            <Input
              type="number"
              value={value}
              onChange={e => setValue(e.target.value)}
              min="0"
              step="0.01"
              placeholder={`z.B. 1 ${plan.unitSymbol || ''}`}
              autoFocus
            />
          </Field>
        )}
        {isBoolean && (
          <p className="text-sm text-ink-500">
            <Sparkles size={14} className="inline text-sage-500 mr-1.5" />
            Wird als erledigt in dein Tagebuch eingetragen.
          </p>
        )}
      </form>
    </Modal>
  );
}

// Main page

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
      <PageHeader
        title="Wochenplan"
        icon={CalendarDays}
        tone="amber"
        subtitle={`${format(weekStart, 'd. MMM', { locale: de })} – ${format(weekEnd, 'd. MMM yyyy', { locale: de })}`}
        action={
          <div className="flex items-center gap-1.5">
            <Button variant="secondary" className="!p-2.5" onClick={() => setWeekStart(w => subWeeks(w, 1))} aria-label="Vorherige Woche">
              <ChevronLeft size={16} />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
              Heute
            </Button>
            <Button variant="secondary" className="!p-2.5" onClick={() => setWeekStart(w => addWeeks(w, 1))} aria-label="Nächste Woche">
              <ChevronRight size={16} />
            </Button>
          </div>
        }
      />

      {loading ? (
        <PageLoader />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
          {days.map(day => {
            const dayDate = format(day, 'yyyy-MM-dd');
            const dayPlans = plans.filter(p => (p.scheduledDate || '').slice(0, 10) === dayDate);
            const dayHabitPlans = habitPlans.filter(p => (p.scheduledDate || '').slice(0, 10) === dayDate);
            const isToday_ = isSameDay(day, today);
            const totalItems = dayPlans.length + dayHabitPlans.length;

            return (
              <div
                key={day.toISOString()}
                className={`card p-3 ${isToday_ ? '!border-brand-300 shadow-card-hover' : ''}`}
              >
                {/* Day header */}
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className={`text-[10px] font-semibold uppercase tracking-[0.09em] ${isToday_ ? 'text-brand-600' : 'text-ink-400'}`}>
                      {format(day, 'EEE', { locale: de })}
                    </p>
                    <p className={`display text-xl ${isToday_ ? 'text-brand-600' : ''}`}>
                      {format(day, 'd')}
                    </p>
                  </div>
                  <button
                    onClick={() => setAddFor(day)}
                    aria-label="Plan hinzufügen"
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-brand-50 hover:bg-brand-500 text-brand-500 hover:text-white transition-colors"
                  >
                    <Plus size={14} />
                  </button>
                </div>

                <div className="space-y-2">
                  {/* Activity plans */}
                  {dayPlans.map(plan => (
                    <div key={plan._id} className={`rounded-xl border p-2 ${getCardColor(plan)} ${plan.completed ? 'opacity-55' : ''}`}>
                      <div className="flex items-start justify-between gap-1">
                        <button
                          onClick={() => handleCompleteActivity(plan)}
                          className="flex-shrink-0 mt-0.5"
                          title={plan.completed ? 'Als offen markieren' : 'Als erledigt loggen'}
                        >
                          {plan.completed
                            ? <CheckCircle2 size={14} className="text-emerald-600" />
                            : <Circle size={14} className="text-ink-300 hover:text-emerald-600 transition-colors" />
                          }
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-semibold leading-tight ${plan.completed ? 'line-through text-ink-400' : 'text-ink-800'}`}>
                            {(() => {
                              const current = plan.activityTypeRef?.label || plan.activityType;
                              return plan.historicalLabel ? `${current} (${plan.historicalLabel})` : current;
                            })()}
                          </p>
                          {(plan.duration || plan.distance) && (
                            <p className="text-xs text-ink-500 mt-0.5">
                              {plan.duration ? `${plan.duration} min` : ''}
                              {plan.duration && plan.distance ? ' · ' : ''}
                              {plan.distance ? `${plan.distance} km` : ''}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => api.delete(`/planner/${plan._id}`).then(load)}
                          aria-label="Plan löschen"
                          className="flex-shrink-0 text-ink-300 hover:text-red-600 transition-colors p-1 -mr-1"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Habit plans */}
                  {dayHabitPlans.map(plan => (
                    <div
                      key={plan._id}
                      className={`rounded-xl border p-2 border-sage-200 bg-sage-100/60 ${plan.completed ? 'opacity-55' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <button
                          onClick={() => handleCompleteHabit(plan)}
                          className="flex-shrink-0 mt-0.5"
                          title={plan.completed ? 'Als offen markieren' : 'Als erledigt markieren'}
                        >
                          {plan.completed
                            ? <CheckCircle2 size={14} className="text-emerald-600" />
                            : <Circle size={14} className="text-sage-400 hover:text-emerald-600 transition-colors" />
                          }
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <Sparkles size={10} className="text-sage-500 flex-shrink-0" />
                            <p className={`text-xs font-semibold leading-tight truncate ${plan.completed ? 'line-through text-ink-400' : 'text-sage-700'}`}>
                              {plan.habitId?.name || plan.habitName}
                            </p>
                          </div>
                          {plan.completed && plan.loggedValue != null && plan.habitType !== 'boolean' && (
                            <p className="text-xs text-ink-500 mt-0.5">
                              {plan.loggedValue} {plan.unitSymbol}
                            </p>
                          )}
                          {plan.notes && !plan.completed && (
                            <p className="text-xs text-ink-400 mt-0.5 truncate">{plan.notes}</p>
                          )}
                        </div>
                        <button
                          onClick={() => api.delete(`/planner/habits/${plan._id}`).then(load)}
                          aria-label="Plan löschen"
                          className="flex-shrink-0 text-ink-300 hover:text-red-600 transition-colors p-1 -mr-1"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}

                  {totalItems === 0 && (
                    <p className="text-xs text-ink-200 text-center py-2">Frei</p>
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
