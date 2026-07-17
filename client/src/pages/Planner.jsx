import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/api';
import {
  format, parseISO, startOfWeek, startOfDay, addDays, addWeeks, subWeeks, isSameDay, isBefore,
} from 'date-fns';
import { de } from 'date-fns/locale';
import {
  ChevronLeft, ChevronRight, Plus, CheckCircle2, Circle, Trash2,
  Dumbbell, Sparkles, CalendarDays, Pencil, Copy, Activity, ArrowRight,
} from 'lucide-react';
import {
  PageHeader, Button, Field, Input, Select, Textarea, Chip, chipColorFor,
  Modal, PageLoader, ProgressBar, Segmented,
} from '../components/ui';
import PlannerHeatmap from '../components/PlannerHeatmap';
import StravaCriteriaBuilder, { normalizeCriteria, criteriaSummary, emptyGroup } from '../components/StravaCriteriaBuilder';
import TrainingDetailModal, { trainingLabel, MatchedActivityRow } from '../components/TrainingDetailModal';
import StravaActivityDetailModal from '../components/StravaActivityDetailModal';
import { formatDueReason } from '../utils/habitSchedule';

// Which entry kinds the week view shows — persisted so the planner opens
// the way the user left it.
const FILTER_STORAGE_KEY = 'deltis.plannerFilters';
const FILTER_OPTIONS = [
  { key: 'activities', label: 'Aktivitäten' },
  { key: 'habits', label: 'Geplante Gewohnheiten' },
  { key: 'due', label: 'Fällige Gewohnheiten' },
  { key: 'trainings', label: 'Trainings' },
  { key: 'strava', label: 'Strava' },
];

function loadFilters() {
  try {
    const raw = JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY));
    if (raw && typeof raw === 'object') {
      return Object.fromEntries(FILTER_OPTIONS.map(o => [o.key, raw[o.key] !== false]));
    }
  } catch { /* corrupted storage falls back to defaults */ }
  return Object.fromEntries(FILTER_OPTIONS.map(o => [o.key, true]));
}

// Why is this due habit in the planner? Shows the reason and lets the user
// log the habit right away.
function DueHabitModal({ entry, onSave, onClose }) {
  const isBoolean = entry.type === 'boolean';
  const [value, setValue] = useState(entry.loggedValue ?? '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/habits/logs', {
        habitId: entry.habitId,
        date: `${entry.date}T12:00:00`,
        value: isBoolean ? 1 : (value !== '' ? +value : 1),
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
      title={entry.name}
      subtitle={format(parseISO(entry.date), 'EEEE, d. MMMM', { locale: de })}
      icon={Sparkles}
      size="sm"
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>Schließen</Button>
          <Button type="submit" form="due-habit-form" className="flex-1" loading={saving} icon={CheckCircle2}>
            {entry.logged ? 'Aktualisieren' : 'Erledigt'}
          </Button>
        </>
      }
    >
      <form id="due-habit-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-xl border border-sage-200 bg-sage-100/50 px-3.5 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-sage-700 mb-1">
            Warum steht das hier?
          </p>
          <p className="text-sm text-ink-600">{formatDueReason(entry.reason)}</p>
          <Link
            to={`/habits?manage=${entry.habitId}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors mt-2"
          >
            Zeitplan anpassen <ArrowRight size={12} />
          </Link>
        </div>
        {!isBoolean && (
          <Field label={`Wert${entry.unitSymbol ? ` (${entry.unitSymbol})` : ''}`}>
            <Input
              type="number"
              value={value}
              onChange={e => setValue(e.target.value)}
              min="0"
              step="0.01"
              placeholder={`z.B. 1 ${entry.unitSymbol || ''}`}
            />
          </Field>
        )}
        {entry.logged && (
          <p className="text-xs text-emerald-600 font-medium">
            Bereits eingetragen{entry.loggedValue != null && !isBoolean ? `: ${entry.loggedValue} ${entry.unitSymbol || ''}` : ''}.
          </p>
        )}
      </form>
    </Modal>
  );
}

// Strava brand colour — marks synced activities so their origin is obvious
const STRAVA_ORANGE = '#FC4C02';

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
        {/* Provenance — why is this entry in the planner? */}
        <p className="text-xs text-ink-400">
          {plan.source === 'copy-week' ? 'Aus der Vorwoche kopiert' : 'Von dir geplant'}
          {plan.createdAt && ` am ${format(parseISO(plan.createdAt), 'd. MMMM yyyy', { locale: de })}`}.
        </p>
      </form>
    </Modal>
  );
}

// One planner entry as a calm, uniform row: status toggle, kind icon, title
// and meta on a single line, actions on the right. `completed` strikes the
// title, `dim` fades the whole row; nested children (e.g. the fulfilling
// Strava activities of a training) render indented below.
function DayRow({
  onOpen, titleAttr, toggle, icon: KindIcon, iconClass = '', iconStyle,
  title, titleClass = '', meta, badge, overdue, completed, dim, actions, children,
}) {
  const clickable = typeof onOpen === 'function';
  return (
    <div
      className={`rounded-lg transition-colors ${clickable ? 'cursor-pointer hover:bg-paper-100/70' : ''} ${dim ? 'opacity-55' : ''}`}
      title={titleAttr}
      {...(clickable ? {
        role: 'button',
        tabIndex: 0,
        onClick: onOpen,
        onKeyDown: (e) => { if (e.key === 'Enter') onOpen(); },
      } : {})}
    >
      <div className="flex items-center gap-2 px-1.5 py-1.5">
        {toggle}
        <KindIcon size={13} className={`flex-shrink-0 ${iconClass}`} style={iconStyle} />
        <p className={`text-sm font-medium truncate ${completed ? 'line-through text-ink-400' : 'text-ink-800'} ${titleClass}`}>
          {title}
        </p>
        <p className="text-xs text-ink-400 truncate flex-1 min-w-0">{meta || ''}</p>
        {overdue && <span className="text-[10px] font-semibold text-ocher-600 flex-shrink-0">Überfällig</span>}
        {badge}
        {actions}
      </div>
      {children && (
        <div className="pl-9 pr-1.5 pb-2 space-y-1.5" onClick={e => e.stopPropagation()}>
          {children}
        </div>
      )}
    </div>
  );
}

// Main page

export default function Planner() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [plans, setPlans] = useState([]);
  const [habitPlans, setHabitPlans] = useState([]);
  const [stravaActivities, setStravaActivities] = useState([]);
  const [trainingPlans, setTrainingPlans] = useState([]);
  const [dueHabits, setDueHabits] = useState([]);
  const [filters, setFilters] = useState(loadFilters);
  const [dueDetail, setDueDetail] = useState(null);
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
      const [plansRes, habitPlansRes, typesRes, habitsRes, trainingPlansRes, trainingTypesRes, stravaRes, dueRes] = await Promise.all([
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
        // Habits that are DUE this week per their schedule (implicit entries,
        // separate from explicitly planned ones).
        api.get('/habits/due', { params }).catch(() => ({ data: [] })),
      ]);
      setPlans(plansRes.data);
      setHabitPlans(habitPlansRes.data);
      setActivityTypes(typesRes.data);
      setHabits(habitsRes.data.filter(h => h.selected));
      setTrainingPlans(trainingPlansRes.data);
      setTrainingTypes(trainingTypesRes.data);
      setStravaActivities(stravaRes.data.activities || []);
      setDueHabits(dueRes.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  const toggleFilter = (key) => {
    setFilters(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  };

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

          {/* What the week view shows — persisted per browser */}
          <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t hairline">
            <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-ink-400 mr-1">
              Anzeigen
            </span>
            {FILTER_OPTIONS.map(opt => (
              <Chip
                key={opt.key}
                color="clay"
                active={filters[opt.key]}
                onClick={() => toggleFilter(opt.key)}
              >
                {opt.label}
              </Chip>
            ))}
          </div>
        </div>

        {/* Week agenda: one row per day — stays readable on mobile and inside
            the narrow desktop content column, where seven side-by-side day
            columns get too cramped. */}
        <div className="card overflow-hidden divide-y divide-[color:var(--surface-border)] anim-list">
          {days.map(day => {
            const dayDate = format(day, 'yyyy-MM-dd');
            const dayPlans = filters.activities
              ? plans.filter(p => (p.scheduledDate || '').slice(0, 10) === dayDate)
              : [];
            const dayHabitPlans = filters.habits
              ? habitPlans.filter(p => (p.scheduledDate || '').slice(0, 10) === dayDate)
              : [];
            const dayTrainings = filters.trainings
              ? trainingPlans.filter(p => (p.scheduledDate || '').slice(0, 10) === dayDate)
              : [];
            // Habits DUE per schedule — implicit entries, not planned ones.
            // Planned entries of the same habit win to avoid duplicates.
            const plannedHabitIds = new Set(dayHabitPlans.map(p => String(p.habitId?._id || p.habitId)));
            const dayDue = filters.due
              ? dueHabits.filter(d => d.date === dayDate && !plannedHabitIds.has(d.habitId))
              : [];
            // Activities already claimed by a training plan render nested
            // inside that plan's card — don't list them a second time.
            const claimedIds = new Set(
              dayTrainings.flatMap(p => (p.matchedActivities || []).map(m => m.id))
            );
            // startDateLocal carries the athlete's local wall time — the date
            // the activity belongs to from the user's perspective.
            const dayStrava = filters.strava
              ? stravaActivities.filter(a =>
                  ((a.startDateLocal || a.startDate) || '').slice(0, 10) === dayDate
                  && !claimedIds.has(a._id)
                )
              : [];
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

                {/* Entries: one calm row per item — open things first,
                    completed ones sink to the end of the day. */}
                <div className="flex-1 min-w-0 self-center">
                  {(() => {
                    const entries = [
                      ...dayPlans.map(p => ({ key: `a-${p._id}`, kind: 'activity', done: !!p.completed, data: p })),
                      ...dayHabitPlans.map(p => ({ key: `h-${p._id}`, kind: 'habit', done: !!p.completed, data: p })),
                      ...dayDue.map(d => ({ key: `d-${d.habitId}-${d.date}`, kind: 'due', done: !!d.logged, data: d })),
                      ...dayTrainings.map(t => ({ key: `t-${t._id}`, kind: 'training', done: !!t.completed, data: t })),
                      ...dayStrava.map(a => ({ key: `s-${a._id}`, kind: 'strava', done: true, data: a })),
                    ];
                    const sorted = [...entries.filter(e => !e.done), ...entries.filter(e => e.done)];
                    if (sorted.length === 0) {
                      return <p className="text-xs text-ink-200 py-1">Frei</p>;
                    }

                    const editDeleteActions = (onEdit, onDelete) => (
                      <>
                        <button
                          onClick={e => { e.stopPropagation(); onEdit(); }}
                          aria-label="Plan bearbeiten"
                          className="flex-shrink-0 text-ink-300 hover:text-brand-600 transition-colors p-1"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); onDelete(); }}
                          aria-label="Plan löschen"
                          className="flex-shrink-0 text-ink-300 hover:text-red-600 transition-colors p-1 -mr-1"
                        >
                          <Trash2 size={12} />
                        </button>
                      </>
                    );

                    return sorted.map(entry => {
                      if (entry.kind === 'activity') {
                        const plan = entry.data;
                        const label = plan.activityTypeRef?.label || plan.activityType;
                        return (
                          <DayRow
                            key={entry.key}
                            icon={Dumbbell}
                            iconClass="text-brand-500"
                            completed={plan.completed}
                            dim={plan.completed}
                            overdue={isPast && !plan.completed}
                            title={plan.historicalLabel ? `${label} (${plan.historicalLabel})` : label}
                            meta={[
                              plan.duration ? `${plan.duration} min` : null,
                              plan.distance ? `${plan.distance} km` : null,
                            ].filter(Boolean).join(' · ')}
                            toggle={
                              <button
                                onClick={e => { e.stopPropagation(); handleCompleteActivity(plan); }}
                                className="flex-shrink-0"
                                title={plan.completed ? 'Als offen markieren' : 'Als erledigt loggen'}
                              >
                                {plan.completed
                                  ? <CheckCircle2 size={15} className="text-emerald-600 anim-check" />
                                  : <Circle size={15} className="text-ink-300 hover:text-emerald-600 transition-colors" />}
                              </button>
                            }
                            actions={editDeleteActions(
                              () => setEditing({ plan, kind: 'activity' }),
                              () => api.delete(`/planner/${plan._id}`).then(load)
                            )}
                          />
                        );
                      }

                      if (entry.kind === 'habit') {
                        const plan = entry.data;
                        return (
                          <DayRow
                            key={entry.key}
                            icon={Sparkles}
                            iconClass="text-sage-500"
                            completed={plan.completed}
                            dim={plan.completed}
                            overdue={isPast && !plan.completed}
                            title={plan.habitId?.name || plan.habitName}
                            meta={plan.completed && plan.loggedValue != null && plan.habitType !== 'boolean'
                              ? `${plan.loggedValue} ${plan.unitSymbol || ''}`.trim()
                              : (!plan.completed && plan.notes) || ''}
                            toggle={
                              <button
                                onClick={e => { e.stopPropagation(); handleCompleteHabit(plan); }}
                                className="flex-shrink-0"
                                title={plan.completed ? 'Als offen markieren' : 'Als erledigt markieren'}
                              >
                                {plan.completed
                                  ? <CheckCircle2 size={15} className="text-emerald-600 anim-check" />
                                  : <Circle size={15} className="text-sage-400 hover:text-emerald-600 transition-colors" />}
                              </button>
                            }
                            actions={editDeleteActions(
                              () => setEditing({ plan, kind: 'habit' }),
                              () => api.delete(`/planner/habits/${plan._id}`).then(load)
                            )}
                          />
                        );
                      }

                      if (entry.kind === 'due') {
                        const d = entry.data;
                        return (
                          <DayRow
                            key={entry.key}
                            onOpen={() => setDueDetail(d)}
                            icon={Sparkles}
                            iconClass="text-sage-300"
                            completed={d.logged}
                            dim={d.logged}
                            title={d.name}
                            titleClass={d.logged ? '' : '!text-sage-700'}
                            meta={d.reason?.kind === 'trigger' ? 'Fällig durch Ereignis' : 'Fällig laut Zeitplan'}
                            toggle={
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  if (d.logged) return;
                                  if (d.type === 'boolean') {
                                    api.post('/habits/logs', {
                                      habitId: d.habitId,
                                      date: `${d.date}T12:00:00`,
                                      value: 1,
                                    }).then(load).catch(() => {});
                                  } else {
                                    setDueDetail(d);
                                  }
                                }}
                                className="flex-shrink-0"
                                title={d.logged ? 'Bereits eingetragen' : 'Erledigt'}
                              >
                                {d.logged
                                  ? <CheckCircle2 size={15} className="text-emerald-600 anim-check" />
                                  : <Circle size={15} className="text-sage-400 hover:text-emerald-600 transition-colors" />}
                              </button>
                            }
                          />
                        );
                      }

                      if (entry.kind === 'training') {
                        const plan = entry.data;
                        const nested = plan.matchedActivities || (plan.fulfilledBy ? [plan.fulfilledBy] : []);
                        const showNested = plan.completed && nested.length > 0;
                        const autoCompleted = plan.autoCompleted ?? nested.length > 0;
                        return (
                          <DayRow
                            key={entry.key}
                            onOpen={() => setTrainingDetailId(plan._id)}
                            icon={Activity}
                            iconClass="text-ocher-600"
                            completed={plan.completed}
                            dim={plan.completed && !showNested}
                            overdue={isPast && !plan.completed}
                            title={trainingLabel(plan)}
                            titleClass={plan.completed && showNested ? '!no-underline !text-ocher-700' : ''}
                            meta={plan.completed && !autoCompleted ? 'Manuell absolviert'
                              : (!plan.completed && plan.notes) || ''}
                            toggle={
                              <button
                                onClick={e => { e.stopPropagation(); if (!autoCompleted) handleToggleTrainingManual(plan); }}
                                className="flex-shrink-0"
                                title={autoCompleted
                                  ? 'Durch Aktivität erfüllt'
                                  : plan.manualCompleted
                                    ? 'Als offen markieren'
                                    : 'Als absolviert markieren'}
                              >
                                {plan.completed
                                  ? <CheckCircle2 size={15} className="text-emerald-600 anim-check" />
                                  : <Circle size={15} className="text-ocher-400 hover:text-emerald-600 transition-colors" />}
                              </button>
                            }
                            actions={editDeleteActions(
                              () => setEditing({ plan, kind: 'training' }),
                              () => api.delete(`/planner/trainings/${plan._id}`).then(load)
                            )}
                          >
                            {showNested ? nested.map(activity => (
                              <MatchedActivityRow
                                key={activity.id}
                                activity={activity}
                                onOpen={id => setStravaDetailId(id)}
                              />
                            )) : null}
                          </DayRow>
                        );
                      }

                      // Synced Strava activity — read-only, clearly external
                      const activity = entry.data;
                      return (
                        <DayRow
                          key={entry.key}
                          onOpen={() => setStravaDetailId(activity._id)}
                          titleAttr="Von Strava synchronisiert – Details anzeigen"
                          icon={Activity}
                          iconStyle={{ color: STRAVA_ORANGE }}
                          title={activity.name || activity.sportType || 'Aktivität'}
                          meta={[
                            activity.sportType,
                            activity.movingTime ? `${Math.round(activity.movingTime / 60)} min` : null,
                            activity.distance ? `${(activity.distance / 1000).toFixed(1)} km` : null,
                          ].filter(Boolean).join(' · ')}
                          badge={
                            <span className="text-[10px] font-semibold flex-shrink-0" style={{ color: STRAVA_ORANGE }}>
                              Strava
                            </span>
                          }
                          toggle={<span className="w-[15px] flex-shrink-0" aria-hidden="true" />}
                        />
                      );
                    });
                  })()}
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

      {dueDetail && (
        <DueHabitModal
          entry={dueDetail}
          onSave={() => { setDueDetail(null); load(); }}
          onClose={() => setDueDetail(null)}
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
