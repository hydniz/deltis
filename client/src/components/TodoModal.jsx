// Create / edit a to-do: title, notes, priority, an optional reminder time and
// a schedule that mirrors habits — once, daily, weekly, every N days, or an
// event trigger. The trigger can fire off habits, activities, Strava sports,
// trainings AND other todos, so tasks chain into the rest of the system.
import { useState, useEffect } from 'react';
import api from '../utils/api';
import { Modal, Field, Input, Select, Textarea, Button, Segmented, Chip } from './ui';

const MODES = [
  { value: 'once', label: 'Einmalig' },
  { value: 'daily', label: 'Täglich' },
  { value: 'weekly', label: 'Wöchentlich' },
  { value: 'interval', label: 'Intervall' },
  { value: 'trigger', label: 'Auslöser' },
];
const PRIORITIES = [
  { value: 'low', label: 'Niedrig' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Hoch' },
];
const WEEKDAYS = [['Mo', 1], ['Di', 2], ['Mi', 3], ['Do', 4], ['Fr', 5], ['Sa', 6], ['So', 0]];
const TRIGGER_KINDS = [
  { value: 'habit', label: 'Gewohnheit' },
  { value: 'activityType', label: 'Aktivität' },
  { value: 'stravaSport', label: 'Strava-Sport' },
  { value: 'trainingType', label: 'Training' },
  { value: 'todo', label: 'Aufgabe' },
];
// Which directions each source allows (stravaSport/todo = happened only,
// trainingType = planned only).
const DIRECTION_FIXED = { stravaSport: 'after', todo: 'after', trainingType: 'before' };

const todayStr = () => new Date().toISOString().slice(0, 10);

function stateFrom(todo) {
  const t = todo || {};
  const tr = t.scheduleTrigger || {};
  return {
    title: t.title || '',
    notes: t.notes || '',
    priority: t.priority || 'normal',
    reminderTime: t.reminderTime || '',
    scheduleMode: t.scheduleMode || 'once',
    dueDate: t.dueDate || todayStr(),
    scheduleDays: new Set(t.scheduleDays || []),
    scheduleIntervalDays: t.scheduleIntervalDays || 3,
    scheduleAnchorDate: t.scheduleAnchorDate || todayStr(),
    triggerKind: tr.kind || 'habit',
    triggerRefId: tr.refId || '',
    triggerSport: tr.sport || 'Run',
    triggerDirection: tr.direction || 'after',
    triggerOffset: tr.offsetDays ?? 0,
  };
}

function payloadFrom(s) {
  const base = {
    title: s.title.trim(),
    notes: s.notes,
    priority: s.priority,
    reminderTime: s.reminderTime || null,
    scheduleMode: s.scheduleMode,
  };
  if (s.scheduleMode === 'once') base.dueDate = s.dueDate;
  if (s.scheduleMode === 'weekly') base.scheduleDays = [...s.scheduleDays];
  if (s.scheduleMode === 'interval') {
    base.scheduleIntervalDays = parseInt(s.scheduleIntervalDays, 10) || null;
    base.scheduleAnchorDate = s.scheduleAnchorDate;
  }
  if (s.scheduleMode === 'trigger') {
    const dir = DIRECTION_FIXED[s.triggerKind] || s.triggerDirection;
    base.scheduleTrigger = {
      kind: s.triggerKind,
      direction: dir,
      offsetDays: Math.max(0, parseInt(s.triggerOffset, 10) || 0),
      ...(s.triggerKind === 'stravaSport' ? { sport: s.triggerSport } : { refId: s.triggerRefId }),
    };
  }
  return base;
}

export default function TodoModal({ todo, sources = {}, onSaved, onClose }) {
  const [s, setS] = useState(() => stateFrom(todo));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // A submit attempt with an empty required field marks the field (see below)
  // rather than showing a separate error message.
  const [attempted, setAttempted] = useState(false);
  const set = (patch) => setS(prev => ({ ...prev, ...patch }));

  const { habits = [], activityTypes = [], trainingTypes = [], todos = [], sportTypes = [] } = sources;
  const refOptions =
    s.triggerKind === 'habit' ? habits.map(h => ({ id: h._id, label: h.name }))
    : s.triggerKind === 'activityType' ? activityTypes.map(t => ({ id: t._id, label: t.label }))
    : s.triggerKind === 'trainingType' ? trainingTypes.map(t => ({ id: t._id, label: t.name }))
    : s.triggerKind === 'todo' ? todos.filter(t => !todo || t._id !== todo._id).map(t => ({ id: t._id, label: t.title }))
    : [];
  const directionFixed = DIRECTION_FIXED[s.triggerKind];

  const submit = async () => {
    if (!s.title.trim()) { setAttempted(true); return; }
    setSaving(true);
    setError('');
    try {
      const body = payloadFrom(s);
      if (todo) await api.put(`/todos/${todo._id}`, body);
      else await api.post('/todos', body);
      onSaved?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} title={todo ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}
      footer={
        <div className="flex gap-2">
          <Button className="flex-1" loading={saving} onClick={submit}>{todo ? 'Speichern' : 'Anlegen'}</Button>
          <Button variant="secondary" onClick={onClose}>Abbrechen</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Titel">
          <Input value={s.title} invalid={attempted && !s.title.trim()} onChange={e => { set({ title: e.target.value }); setError(''); }} placeholder="z. B. Rechnung bezahlen" autoFocus />
        </Field>

        <Field label="Notiz" optional>
          <Textarea value={s.notes} onChange={e => set({ notes: e.target.value })} rows={2} placeholder="Details …" />
        </Field>

        <div>
          <p className="text-xs font-semibold text-ink-600 mb-1.5">Priorität</p>
          <Segmented value={s.priority} onChange={v => set({ priority: v })} options={PRIORITIES} />
        </div>

        <div>
          <p className="text-xs font-semibold text-ink-600 mb-1.5">Wann?</p>
          <Segmented value={s.scheduleMode} onChange={v => set({ scheduleMode: v })} options={MODES} />
        </div>

        {s.scheduleMode === 'once' && (
          <Field label="Fällig am">
            <Input type="date" value={s.dueDate} onChange={e => set({ dueDate: e.target.value })} />
          </Field>
        )}

        {s.scheduleMode === 'weekly' && (
          <div>
            <p className="text-xs font-semibold text-ink-600 mb-1.5">Wochentage</p>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map(([label, d]) => (
                <Chip key={d} color="clay" active={s.scheduleDays.has(d)}
                  onClick={() => {
                    const next = new Set(s.scheduleDays);
                    next.has(d) ? next.delete(d) : next.add(d);
                    set({ scheduleDays: next });
                  }}>
                  {label}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {s.scheduleMode === 'interval' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Alle … Tage">
              <Input type="number" min="1" max="365" value={s.scheduleIntervalDays} onChange={e => set({ scheduleIntervalDays: e.target.value })} />
            </Field>
            <Field label="Beginnend am">
              <Input type="date" value={s.scheduleAnchorDate} onChange={e => set({ scheduleAnchorDate: e.target.value })} />
            </Field>
          </div>
        )}

        {s.scheduleMode === 'trigger' && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Select value={s.triggerKind} onChange={e => set({ triggerKind: e.target.value, triggerRefId: '' })}>
                {TRIGGER_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
              </Select>
              {s.triggerKind === 'stravaSport' ? (
                <Input list="todo-strava-sports" value={s.triggerSport} onChange={e => set({ triggerSport: e.target.value })} placeholder="z. B. Run" />
              ) : (
                <Select value={s.triggerRefId} onChange={e => set({ triggerRefId: e.target.value })}>
                  <option value="">– wählen –</option>
                  {refOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </Select>
              )}
            </div>
            <datalist id="todo-strava-sports">{sportTypes.map(x => <option key={x} value={x} />)}</datalist>
            <div className="flex items-center gap-2">
              <Input type="number" className="!w-16" min="0" max="30" value={s.triggerOffset} onChange={e => set({ triggerOffset: e.target.value })} />
              <Select className="flex-1" value={directionFixed || s.triggerDirection} disabled={!!directionFixed} onChange={e => set({ triggerDirection: e.target.value })}>
                <option value="after">Tage NACHDEM es passiert ist</option>
                <option value="before">Tage BEVOR es geplant ist</option>
              </Select>
            </div>
            <p className="text-[11px] text-ink-400">0 Tage = am selben Tag.</p>
          </div>
        )}

        <Field label="Erinnerung (Uhrzeit)" hint="Leer = Standardzeit aus den Einstellungen." optional>
          <Input type="time" value={s.reminderTime} onChange={e => set({ reminderTime: e.target.value })} />
        </Field>

        {error && <p className="text-sm text-rose-500">{error}</p>}
      </div>
    </Modal>
  );
}
