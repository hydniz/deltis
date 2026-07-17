import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import {
  format, startOfWeek, startOfDay, addDays, addWeeks, subWeeks, isSameDay, isBefore,
} from 'date-fns';
import { de } from 'date-fns/locale';
import {
  ChevronLeft, ChevronRight, Plus, CheckCircle2, Circle, Trash2,
  Dumbbell, Sparkles, CalendarDays, Pencil, Copy, Activity,
} from 'lucide-react';
import {
  PageHeader, Button, Field, Input, Select, Textarea, Chip, chipColorFor,
  Modal, PageLoader, ProgressBar, Segmented,
} from '../components/ui';
import PlannerHeatmap from '../components/PlannerHeatmap';
import StravaCriteriaBuilder, { normalizeCriteria, criteriaSummary, emptyGroup } from '../components/StravaCriteriaBuilder';
import TrainingDetailModal, { trainingLabel, MatchedActivityRow } from '../components/TrainingDetailModal';
import StravaActivityDetailModal from '../components/StravaActivityDetailModal';

// Strava brand colour — marks synced activities so their origin is obvious
const STRAVA_ORANGE = '#FC4C02';

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

function AddPlanModal({ date, days, activityTypes, habits, trainingTypes = [], trainingAvailable = false, onSave, onClose }) {
  const [mode, setMode] = useState(activityTypes.length > 0 ? 'activity' : habits.length > 0 ? 'habit' : 'training');

  // Days of the week the plan is created for (multi-select, clicked day preselected)
  const [selectedDates, setSelectedDates] = useState([format(date, 'yyyy-MM-dd')]);
  const toggleDate = (d) => {
    setSelectedDates(prev =>
      prev.includes(d) ? prev.filter(v => v !== d) : [...prev, d]
    );
  };

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

  // Training form (criteria-based, auto-fulfilled by synced activities)
  const [trainingMode, setTrainingMode] = useState(trainingTypes.length > 0 ? 'type' : 'custom');
  const [trainingTypeId, setTrainingTypeId] = useState(trainingTypes[0]?._id || '');
  const [trainingCriteria, setTrainingCriteria] = useState(emptyGroup());
  const [trainingName, setTrainingName] = useState('');
  const [trainingNotes, setTrainingNotes] = useState('');

  const [saving, setSaving] = useState(false);

  const setAct = (k, v) => setActForm(f => ({ ...f, [k]: v }));
  const setHab = (k, v) => setHabitForm(f => ({ ...f, [k]: v }));

  const handleSubmitActivity = async (e) => {
    e.preventDefault();
    if (!selectedType || selectedDates.length === 0) return;
    setSaving(true);
    try {
      await Promise.all(selectedDates.map(scheduledDate => api.post('/planner', {
        activityType: selectedType.label,
        activityTypeRef: selectedType._id,
        scheduledDate,
        duration: actForm.duration ? +actForm.duration : undefined,
        distance: actForm.distance ? +actForm.distance : undefined,
        notes: actForm.notes || undefined,
        customValues,
      })));
      onSave();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitHabit = async (e) => {
    e.preventDefault();
    if (!selectedHabit || selectedDates.length === 0) return;
    setSaving(true);
    try {
      await Promise.all(selectedDates.map(scheduledDate => api.post('/planner/habits', {
        habitId: selectedHabit._id,
        scheduledDate,
        notes: habitForm.notes || undefined,
      })));
      onSave();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitTraining = async (e) => {
    e.preventDefault();
    if (selectedDates.length === 0) return;
    const useType = trainingMode === 'type' && trainingTypeId;
    const criteria = useType ? undefined : { strava: normalizeCriteria(trainingCriteria) };
    setSaving(true);
    try {
      await Promise.all(selectedDates.map(scheduledDate => api.post('/planner/trainings', {
        scheduledDate,
        trainingTypeId: useType ? trainingTypeId : undefined,
        criteria,
        name: useType ? undefined : (trainingName.trim() || undefined),
        notes: trainingNotes || undefined,
      })));
      onSave();
    } catch (err) {
      alert('Fehler: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const dayChips = (
    <Field
      label="Tage"
      hint={selectedDates.length > 1 ? `Wird für ${selectedDates.length} Tage geplant.` : undefined}
    >
      <div className="flex flex-wrap gap-1.5">
        {days.map(d => {
          const key = format(d, 'yyyy-MM-dd');
          return (
            <Chip
              key={key}
              color="clay"
              active={selectedDates.includes(key)}
              onClick={() => toggleDate(key)}
            >
              {format(d, 'EEE d.', { locale: de })}
            </Chip>
          );
        })}
      </div>
    </Field>
  );

  return (
    <Modal
      onClose={onClose}
      title="Plan hinzufügen"
      subtitle={format(date, 'EEEE, d. MMMM', { locale: de })}
      icon={CalendarDays}
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>Abbrechen</Button>
          <Button type="submit" form="add-form" className="flex-1" loading={saving} disabled={selectedDates.length === 0}>
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
        {trainingAvailable && (
          <button
            type="button"
            onClick={() => setMode('training')}
            className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors ${
              mode === 'training'
                ? 'border-ocher-400 bg-ocher-100/60 text-ocher-700'
                : 'border-paper-200 bg-paper-50 text-ink-400 hover:text-ink-600'
            }`}
          >
            <Activity size={13} /> Training
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
          {dayChips}
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
          {dayChips}
          <Field label="Notizen" optional>
            <Textarea rows={2} value={habitForm.notes} onChange={e => setHab('notes', e.target.value)} placeholder="Erinnerung, Kontext…" />
          </Field>
        </form>
      )}

      {mode === 'training' && (
        <form id="add-form" onSubmit={handleSubmitTraining} className="space-y-4">
          <p className="text-xs text-ink-400 -mt-1">
            Ein geplantes Training wird automatisch als erledigt markiert, sobald an dem Tag
            eine passende Aktivität synchronisiert wird (z.&nbsp;B. aus Strava).
          </p>
          {trainingTypes.length > 0 && (
            <Field label="Was zählt als Training?">
              <Segmented
                value={trainingMode}
                onChange={setTrainingMode}
                options={[
                  { value: 'type', label: 'Trainingstyp' },
                  { value: 'custom', label: 'Eigene Kriterien' },
                ]}
              />
            </Field>
          )}
          {trainingMode === 'type' && trainingTypes.length > 0 ? (
            <Field
              label="Trainingstyp"
              hint={criteriaSummary(trainingTypes.find(t => t._id === trainingTypeId)?.criteria?.strava)}
            >
              <Select value={trainingTypeId} onChange={e => setTrainingTypeId(e.target.value)}>
                {trainingTypes.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
              </Select>
            </Field>
          ) : (
            <>
              <Field label="Name" optional hint="Wie soll dieses Training im Planer heißen?">
                <Input
                  value={trainingName}
                  onChange={e => setTrainingName(e.target.value)}
                  maxLength={60}
                  placeholder="z.B. Intervalle, Longrun…"
                />
              </Field>
              <StravaCriteriaBuilder
                criteria={trainingCriteria}
                onChange={setTrainingCriteria}
                sportTypes={[]}
              />
            </>
          )}
          {dayChips}
          <Field label="Notizen" optional>
            <Textarea rows={2} value={trainingNotes} onChange={e => setTrainingNotes(e.target.value)} placeholder="z.B. locker bleiben" />
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

// Edit plan (activity or habit) — move to another day, adjust planned values and notes

function EditPlanModal({ plan, kind, trainingTypes = [], onSave, onClose }) {
  const isActivity = kind === 'activity';
  const isTraining = kind === 'training';
  const typeConfig = isActivity ? (plan.activityTypeRef || {}) : {};
  const [form, setForm] = useState({
    scheduledDate: (plan.scheduledDate || '').slice(0, 10),
    duration: plan.duration || '',
    distance: plan.distance || '',
    notes: plan.notes || '',
  });
  const [customValues, setCustomValues] = useState(plan.customValues || {});
  // Training target: switch between saved type and ad-hoc criteria in place.
  const [trainingMode, setTrainingMode] = useState(plan.trainingTypeId ? 'type' : 'custom');
  const [trainingTypeId, setTrainingTypeId] = useState(plan.trainingTypeId || trainingTypes[0]?._id || '');
  const [trainingCriteria, setTrainingCriteria] = useState(plan.criteria?.strava || emptyGroup());
  const [trainingName, setTrainingName] = useState(plan.name || '');
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (isActivity) {
        await api.put(`/planner/${plan._id}`, {
          scheduledDate: form.scheduledDate,
          duration: form.duration ? +form.duration : null,
          distance: form.distance ? +form.distance : null,
          notes: form.notes || null,
          customValues,
        });
      } else if (isTraining) {
        const useType = trainingMode === 'type' && trainingTypeId;
        await api.put(`/planner/trainings/${plan._id}`, {
          scheduledDate: form.scheduledDate,
          notes: form.notes || null,
          trainingTypeId: useType ? trainingTypeId : undefined,
          criteria: useType ? undefined : { strava: normalizeCriteria(trainingCriteria) },
          name: useType ? '' : trainingName.trim(),
        });
      } else {
        await api.put(`/planner/habits/${plan._id}`, {
          scheduledDate: form.scheduledDate,
          notes: form.notes || null,
        });
      }
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
      title="Plan bearbeiten"
      subtitle={isActivity
        ? (typeConfig.label || plan.activityType)
        : isTraining
          ? trainingLabel(plan)
          : (plan.habitId?.name || plan.habitName)}
      icon={Pencil}
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>Abbrechen</Button>
          <Button type="submit" form="edit-plan-form" className="flex-1" loading={saving}>
            Speichern
          </Button>
        </>
      }
    >
      <form id="edit-plan-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="Geplant für" hint="Datum ändern verschiebt den Plan auf einen anderen Tag.">
          <Input
            type="date"
            value={form.scheduledDate}
            onChange={e => set('scheduledDate', e.target.value)}
            required
          />
        </Field>
        {isActivity && typeConfig.showDuration !== false && (
          <Field label="Dauer (min)">
            <Input type="number" value={form.duration} onChange={e => set('duration', e.target.value)} min="1" placeholder="z.B. 60" />
          </Field>
        )}
        {isActivity && typeConfig.showDistance && (
          <Field label="Distanz (km)">
            <Input type="number" value={form.distance} onChange={e => set('distance', e.target.value)} min="0" step="0.1" placeholder="z.B. 5.5" />
          </Field>
        )}
        {isActivity && (typeConfig.customFields || []).map(field => (
          <Field
            key={field.key}
            label={<>{field.label}{field.unit && <span className="text-ink-300 ml-1 normal-case">({field.unit})</span>}</>}
          >
            <CustomFieldInput field={field} value={customValues[field.key]} onChange={v => setCustomValues(cv => ({ ...cv, [field.key]: v }))} />
          </Field>
        ))}
        {isTraining && (
          <>
            {trainingTypes.length > 0 && (
              <Field label="Was zählt als Training?">
                <Segmented
                  value={trainingMode}
                  onChange={setTrainingMode}
                  options={[
                    { value: 'type', label: 'Trainingstyp' },
                    { value: 'custom', label: 'Eigene Kriterien' },
                  ]}
                />
              </Field>
            )}
            {trainingMode === 'type' && trainingTypes.length > 0 ? (
              <Field
                label="Trainingstyp"
                hint={criteriaSummary(trainingTypes.find(t => t._id === trainingTypeId)?.criteria?.strava)}
              >
                <Select value={trainingTypeId} onChange={e => setTrainingTypeId(e.target.value)}>
                  {trainingTypes.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
                </Select>
              </Field>
            ) : (
              <>
                <Field label="Name" optional>
                  <Input
                    value={trainingName}
                    onChange={e => setTrainingName(e.target.value)}
                    maxLength={60}
                    placeholder="z.B. Intervalle, Longrun…"
                  />
                </Field>
                <StravaCriteriaBuilder
                  criteria={trainingCriteria}
                  onChange={setTrainingCriteria}
                  sportTypes={[]}
                />
              </>
            )}
          </>
        )}
        <Field label="Notizen">
          <Textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional…" />
        </Field>
      </form>
    </Modal>
  );
}

// Main page

export default function Planner() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [plans, setPlans] = useState([]);
  const [habitPlans, setHabitPlans] = useState([]);
  const [stravaActivities, setStravaActivities] = useState([]);
  const [trainingPlans, setTrainingPlans] = useState([]);
  const [trainingTypes, setTrainingTypes] = useState([]);
  const [stravaConfigured, setStravaConfigured] = useState(false);
  const [activityTypes, setActivityTypes] = useState([]);
  const [habits, setHabits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addFor, setAddFor] = useState(null);
  const [completingPlan, setCompletingPlan] = useState(null);
  const [completingHabitPlan, setCompletingHabitPlan] = useState(null);
  const [editing, setEditing] = useState(null);
  const [copying, setCopying] = useState(false);
  const [copyInfo, setCopyInfo] = useState(null);
  // Detail modals: the training is looked up by id so a reload (e.g. after
  // the manual-completion toggle) refreshes the open modal in place.
  const [trainingDetailId, setTrainingDetailId] = useState(null);
  const [stravaDetailId, setStravaDetailId] = useState(null);

  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Mutations (complete, add, delete, copy) call load() directly and refresh
  // silently in place — only week navigation shows the loader (see effect).
  const load = useCallback(async () => {
    try {
      const params = { startDate: format(weekStart, 'yyyy-MM-dd'), endDate: format(weekEnd, 'yyyy-MM-dd') };
      const [plansRes, habitPlansRes, typesRes, habitsRes, trainingPlansRes, trainingTypesRes, stravaRes] = await Promise.all([
        api.get('/planner', { params }),
        api.get('/planner/habits', { params }),
        api.get('/activity-types'),
        api.get('/habits/definitions'),
        api.get('/planner/trainings', { params }).catch(() => ({ data: [] })),
        api.get('/training-types').catch(() => ({ data: [] })),
        // Synced Strava activities of the visible week (read-only context).
        // The server filters on the UTC start time — fetch with a one-day
        // buffer on both sides and match the LOCAL date per day below.
        // Missing integration/connection simply yields an empty list.
        api.get('/strava/activities', {
          params: {
            startDate: format(addDays(weekStart, -1), 'yyyy-MM-dd'),
            endDate: format(addDays(weekEnd, 2), 'yyyy-MM-dd'),
            limit: 100,
          },
        }).catch(() => ({ data: { activities: [] } })),
      ]);
      setPlans(plansRes.data);
      setHabitPlans(habitPlansRes.data);
      setActivityTypes(typesRes.data);
      setHabits(habitsRes.data.filter(h => h.selected));
      setTrainingPlans(trainingPlansRes.data);
      setTrainingTypes(trainingTypesRes.data);
      setStravaActivities(stravaRes.data.activities || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => { setCopyInfo(null); }, [weekStart]);

  // Whether the "Training" planning mode is offered at all
  useEffect(() => {
    api.get('/strava/status')
      .then(res => setStravaConfigured(Boolean(res.data.configured)))
      .catch(() => {});
  }, []);

  const handleCopyWeek = async () => {
    setCopying(true);
    setCopyInfo(null);
    try {
      const res = await api.post('/planner/copy-week', {
        sourceStart: format(subWeeks(weekStart, 1), 'yyyy-MM-dd'),
        targetStart: format(weekStart, 'yyyy-MM-dd'),
      });
      const copied = (res.data.copiedActivities || 0) + (res.data.copiedHabits || 0) + (res.data.copiedTrainings || 0);
      setCopyInfo(copied > 0
        ? `${copied} ${copied === 1 ? 'Plan' : 'Pläne'} aus der Vorwoche übernommen.`
        : 'Nichts übernommen – die Vorwoche war leer oder alles ist bereits geplant.');
      await load();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setCopying(false);
    }
  };

  const handleCompleteActivity = (plan) => {
    if (plan.completed) {
      api.put(`/planner/${plan._id}`, { completed: false }).then(load);
    } else {
      setCompletingPlan(plan);
    }
  };

  // Manual completion of a training — independent of the derived
  // auto-fulfilment, so a training can be ticked off without a synced activity.
  const handleToggleTrainingManual = async (plan) => {
    try {
      await api.put(`/planner/trainings/${plan._id}`, { completed: !plan.manualCompleted });
      await load();
    } catch (err) {
      alert('Fehler: ' + (err.response?.data?.error || err.message));
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
  const allPlans = [...plans, ...habitPlans, ...trainingPlans];
  const doneCount = allPlans.filter(p => p.completed).length;
  const totalCount = allPlans.length;

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
        <>
        {/* Week overview: completion progress + copy action */}
        <div className="card p-4 anim-item">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between mb-1.5 gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-ink-400">
                  Wochenfortschritt
                </p>
                <p className="text-xs font-semibold text-ink-500">
                  {totalCount > 0 ? `${doneCount} von ${totalCount} erledigt` : 'Noch nichts geplant'}
                </p>
              </div>
              <ProgressBar pct={totalCount > 0 ? (doneCount / totalCount) * 100 : 0} tone="brand" />
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={Copy}
              loading={copying}
              onClick={handleCopyWeek}
              className="flex-shrink-0"
            >
              Vorwoche kopieren
            </Button>
          </div>
          {copyInfo && <p className="text-xs text-ink-400 mt-2">{copyInfo}</p>}
        </div>

        {/* Week agenda: one row per day — stays readable on mobile and inside
            the narrow desktop content column, where seven side-by-side day
            columns get too cramped. */}
        <div className="card overflow-hidden divide-y divide-[color:var(--surface-border)] anim-list">
          {days.map(day => {
            const dayDate = format(day, 'yyyy-MM-dd');
            const dayPlans = plans.filter(p => (p.scheduledDate || '').slice(0, 10) === dayDate);
            const dayHabitPlans = habitPlans.filter(p => (p.scheduledDate || '').slice(0, 10) === dayDate);
            const dayTrainings = trainingPlans.filter(p => (p.scheduledDate || '').slice(0, 10) === dayDate);
            // Activities already claimed by a training plan render nested
            // inside that plan's card — don't list them a second time.
            const claimedIds = new Set(
              dayTrainings.flatMap(p => (p.matchedActivities || []).map(m => m.id))
            );
            // startDateLocal carries the athlete's local wall time — the date
            // the activity belongs to from the user's perspective.
            const dayStrava = stravaActivities.filter(a =>
              ((a.startDateLocal || a.startDate) || '').slice(0, 10) === dayDate
              && !claimedIds.has(a._id)
            );
            const isToday_ = isSameDay(day, today);
            const totalItems = dayPlans.length + dayHabitPlans.length + dayTrainings.length;
            const doneItems = [...dayPlans, ...dayHabitPlans, ...dayTrainings].filter(p => p.completed).length;
            const isPast = isBefore(day, startOfDay(today));

            return (
              <div
                key={day.toISOString()}
                className={`flex gap-3 p-3 sm:p-4 ${isToday_ ? 'bg-brand-50/60' : ''}`}
              >
                {/* Day rail: weekday, date and completion badge */}
                <div className="w-11 flex-shrink-0 flex flex-col items-center pt-0.5">
                  <p className={`text-[10px] font-semibold uppercase tracking-[0.09em] ${isToday_ ? 'text-brand-600' : 'text-ink-400'}`}>
                    {format(day, 'EEE', { locale: de })}
                  </p>
                  <p className={`display text-xl leading-none mt-0.5 ${isToday_ ? 'text-brand-600' : ''}`}>
                    {format(day, 'd')}
                  </p>
                  {totalItems > 0 && (
                    <span
                      className={`mt-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        doneItems === totalItems
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-paper-100 text-ink-400'
                      }`}
                    >
                      {doneItems}/{totalItems}
                    </span>
                  )}
                </div>

                {/* Entries flow into a responsive grid: full width on phones,
                    side by side on wider screens */}
                <div className="flex-1 min-w-0 self-center grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 content-start">
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
                            ? <CheckCircle2 size={14} className="text-emerald-600 anim-check" />
                            : <Circle size={14} className="text-ink-300 hover:text-emerald-600 transition-colors" />
                          }
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-semibold leading-tight truncate ${plan.completed ? 'line-through text-ink-400' : 'text-ink-800'}`}>
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
                          {isPast && !plan.completed && (
                            <p className="text-[10px] font-semibold text-ocher-600 mt-0.5">Überfällig</p>
                          )}
                        </div>
                        <button
                          onClick={() => setEditing({ plan, kind: 'activity' })}
                          aria-label="Plan bearbeiten"
                          className="flex-shrink-0 text-ink-300 hover:text-brand-600 transition-colors p-1"
                        >
                          <Pencil size={12} />
                        </button>
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
                            ? <CheckCircle2 size={14} className="text-emerald-600 anim-check" />
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
                          {isPast && !plan.completed && (
                            <p className="text-[10px] font-semibold text-ocher-600 mt-0.5">Überfällig</p>
                          )}
                        </div>
                        <button
                          onClick={() => setEditing({ plan, kind: 'habit' })}
                          aria-label="Plan bearbeiten"
                          className="flex-shrink-0 text-ink-300 hover:text-brand-600 transition-colors p-1"
                        >
                          <Pencil size={12} />
                        </button>
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

                  {/* Planned trainings — auto-fulfilled by matching synced
                      activities or ticked off manually. The card opens the
                      detail view; fulfilled plans wrap their matching
                      activities so the plan and its proof read as one unit. */}
                  {dayTrainings.map(plan => {
                    // Older payloads only carry fulfilledBy — treat it as the
                    // single matched activity.
                    const nested = plan.matchedActivities || (plan.fulfilledBy ? [plan.fulfilledBy] : []);
                    const showNested = plan.completed && nested.length > 0;
                    const autoCompleted = plan.autoCompleted ?? nested.length > 0;
                    return (
                      <div
                        key={plan._id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setTrainingDetailId(plan._id)}
                        onKeyDown={e => { if (e.key === 'Enter') setTrainingDetailId(plan._id); }}
                        className={`rounded-xl border p-2 border-ocher-200 bg-ocher-100/60 cursor-pointer hover:border-ocher-400 transition-colors ${plan.completed && !showNested ? 'opacity-55' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <button
                            onClick={e => { e.stopPropagation(); if (!autoCompleted) handleToggleTrainingManual(plan); }}
                            className="flex-shrink-0 mt-0.5"
                            title={autoCompleted
                              ? 'Durch Aktivität erfüllt'
                              : plan.manualCompleted
                                ? 'Als offen markieren'
                                : 'Als absolviert markieren'}
                          >
                            {plan.completed
                              ? <CheckCircle2 size={14} className="text-emerald-600 anim-check" />
                              : <Circle size={14} className="text-ocher-400 hover:text-emerald-600 transition-colors" />
                            }
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1">
                              <Activity size={10} className="text-ocher-600 flex-shrink-0" />
                              <p className={`text-xs font-semibold leading-tight truncate ${plan.completed ? (showNested ? 'text-ocher-700' : 'line-through text-ink-400') : 'text-ocher-700'}`}>
                                {trainingLabel(plan)}
                              </p>
                            </div>
                            {plan.completed && !autoCompleted && (
                              <p className="text-[10px] font-semibold text-emerald-600 mt-0.5">Manuell absolviert</p>
                            )}
                            {plan.notes && !plan.completed && (
                              <p className="text-xs text-ink-400 mt-0.5 truncate">{plan.notes}</p>
                            )}
                            {isPast && !plan.completed && (
                              <p className="text-[10px] font-semibold text-ocher-600 mt-0.5">Überfällig</p>
                            )}
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); setEditing({ plan, kind: 'training' }); }}
                            aria-label="Plan bearbeiten"
                            className="flex-shrink-0 text-ink-300 hover:text-brand-600 transition-colors p-1"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); api.delete(`/planner/trainings/${plan._id}`).then(load); }}
                            aria-label="Plan löschen"
                            className="flex-shrink-0 text-ink-300 hover:text-red-600 transition-colors p-1 -mr-1"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                        {showNested && (
                          <div className="mt-1.5 space-y-1.5" onClick={e => e.stopPropagation()}>
                            {nested.map(activity => (
                              <MatchedActivityRow
                                key={activity.id}
                                activity={activity}
                                onOpen={id => setStravaDetailId(id)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Synced Strava activities — read-only, clearly marked as
                      external data (not part of the plan progress) */}
                  {dayStrava.map(activity => (
                    <div
                      key={activity._id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setStravaDetailId(activity._id)}
                      onKeyDown={e => { if (e.key === 'Enter') setStravaDetailId(activity._id); }}
                      className="rounded-xl border hairline bg-paper-50 p-2 border-l-4 cursor-pointer hover:bg-paper-100 transition-colors"
                      style={{ borderLeftColor: STRAVA_ORANGE }}
                      title="Von Strava synchronisiert – Details anzeigen"
                    >
                      <div className="flex items-start gap-1.5">
                        <Activity size={12} style={{ color: STRAVA_ORANGE }} className="flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p
                            className="text-xs font-semibold leading-tight text-ink-800 truncate"
                            title={activity.name || undefined}
                          >
                            {activity.name || activity.sportType || 'Aktivität'}
                          </p>
                          <div className="flex items-center justify-between gap-2 mt-0.5">
                            <p className="text-xs text-ink-500 truncate">
                              {[
                                activity.sportType,
                                activity.movingTime ? `${Math.round(activity.movingTime / 60)} min` : null,
                                activity.distance ? `${(activity.distance / 1000).toFixed(1)} km` : null,
                              ].filter(Boolean).join(' · ')}
                            </p>
                            <p className="text-[10px] font-semibold flex-shrink-0" style={{ color: STRAVA_ORANGE }}>
                              Strava
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {totalItems === 0 && dayStrava.length === 0 && (
                    <p className="text-xs text-ink-200 py-1">Frei</p>
                  )}
                </div>

                <button
                  onClick={() => setAddFor(day)}
                  aria-label="Plan hinzufügen"
                  className="w-8 h-8 flex-shrink-0 self-start flex items-center justify-center rounded-full bg-brand-50 hover:bg-brand-500 text-brand-500 hover:text-white transition-colors"
                >
                  <Plus size={14} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Completion heatmap over the recent weeks — remounts on every load()
            so it stays in sync after completing, adding or deleting plans. */}
        <PlannerHeatmap />
        </>
      )}

      {addFor && (
        <AddPlanModal
          date={addFor}
          days={days}
          activityTypes={activityTypes}
          habits={habits}
          trainingTypes={trainingTypes}
          trainingAvailable={stravaConfigured || trainingTypes.length > 0}
          onSave={() => { setAddFor(null); load(); }}
          onClose={() => setAddFor(null)}
        />
      )}

      {editing && (
        <EditPlanModal
          plan={editing.plan}
          kind={editing.kind}
          trainingTypes={trainingTypes}
          onSave={() => { setEditing(null); load(); }}
          onClose={() => setEditing(null)}
        />
      )}

      {trainingDetailId && (() => {
        const plan = trainingPlans.find(p => p._id === trainingDetailId);
        if (!plan) return null;
        return (
          <TrainingDetailModal
            plan={plan}
            onClose={() => setTrainingDetailId(null)}
            onEdit={p => { setTrainingDetailId(null); setEditing({ plan: p, kind: 'training' }); }}
            onDelete={p => api.delete(`/planner/trainings/${p._id}`).then(() => { setTrainingDetailId(null); load(); })}
            onToggleManual={handleToggleTrainingManual}
            onOpenActivity={id => setStravaDetailId(id)}
          />
        );
      })()}

      {stravaDetailId && (
        <StravaActivityDetailModal
          activityId={stravaDetailId}
          onClose={() => setStravaDetailId(null)}
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
