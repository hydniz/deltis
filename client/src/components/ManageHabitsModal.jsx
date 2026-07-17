import { useState, useEffect } from 'react';
import api from '../utils/api';
import {
  Sparkles, Plus, Check, Trash2, Settings2, ChevronUp, ChevronDown, RotateCcw, AlertTriangle,
} from 'lucide-react';
import {
  Button, Field, Input, Select, Checkbox, Modal, IconButton, Segmented, Spinner,
} from './ui';
import { WEEKDAYS, formatScheduleBadge } from '../utils/habitSchedule';
import { TARGET_CONDITIONS } from '../utils/habitTarget';

// Habit types: 'boolean' logs a simple done/not-done, the others a value.
const TYPE_OPTIONS = [
  { value: 'amount', label: 'Menge' },
  { value: 'duration', label: 'Dauer' },
  { value: 'boolean', label: 'Ja/Nein' },
];

// THE single place to create and configure habits. Everything lives here:
// selection (what to track), creating habits (including their schedule),
// editing them, and the trash of deleted habits. There is no distinction
// between predefined and custom anymore — every habit belongs to the user
// and is managed the same way.
//
// Loads its own definitions so callers don't have to pass state around.
// `onSave(lastCreated)` receives the most recently created definition (or
// null) so the goal wizard can preselect it.

// Initial settings state derived from a definition (or defaults for creation)
function settingsStateFrom(def = {}) {
  return {
    scheduleMode: def.scheduleDate ? 'date' : def.scheduleDays?.length ? 'weekly' : 'daily',
    days: new Set(def.scheduleDays || []),
    date: def.scheduleDate || '',
    missingMode: def.missingDayMode ?? 'none',
    defaultVal: def.defaultValue ?? 0,
    targetCondition: def.targetCondition ?? 'none',
    targetValue: def.targetValue ?? 0,
  };
}

// Settings payload for the API from the state object
function settingsPayload(s, type) {
  const target = type === 'boolean'
    ? { targetCondition: 'none', targetValue: 0 }
    : { targetCondition: s.targetCondition, targetValue: +s.targetValue };
  return {
    missingDayMode: s.missingMode,
    defaultValue: type === 'boolean' ? (+s.defaultVal > 0 ? 1 : 0) : +s.defaultVal,
    scheduleDays: s.scheduleMode === 'weekly' ? [...s.days] : [],
    scheduleDate: s.scheduleMode === 'date' && s.date ? s.date : null,
    ...target,
  };
}

function settingsValid(s) {
  return !(s.scheduleMode === 'date' && !s.date)
    // max 0 is valid ("höchstens 0 Zigaretten"), min/exact need > 0
    && !(['min', 'exact'].includes(s.targetCondition) && !(+s.targetValue > 0));
}

// Shared schedule/target/missing-day fields — used by the edit form of every
// habit row AND the create form, so a new habit can be fully configured
// ("wann geplant" etc.) in one go.
function HabitSettingsFields({ type, unitSymbol, value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const toggleDay = (day) => {
    const next = new Set(value.days);
    next.has(day) ? next.delete(day) : next.add(day);
    set({ days: next });
  };
  const isBoolean = type === 'boolean';

  return (
    <>
      <div>
        <p className="text-xs font-semibold text-ink-600 mb-1.5">Geplante Tage</p>
        <Segmented
          value={value.scheduleMode}
          onChange={mode => set({ scheduleMode: mode })}
          options={[
            { value: 'daily', label: 'Täglich' },
            { value: 'weekly', label: 'Wochentage' },
            { value: 'date', label: 'Nur ein Datum' },
          ]}
        />
        {value.scheduleMode === 'weekly' && (
          <>
            <div className="flex gap-1 mt-2">
              {WEEKDAYS.map(({ value: day, label }) => (
                <button
                  key={day}
                  type="button"
                  aria-pressed={value.days.has(day)}
                  onClick={() => toggleDay(day)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    value.days.has(day)
                      ? 'bg-brand-500 text-white shadow-sm'
                      : 'bg-paper-100 border border-paper-200 text-ink-400 hover:text-ink-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-ink-400 mt-1.5">Keine Auswahl = täglich.</p>
          </>
        )}
        {value.scheduleMode === 'date' && (
          <>
            <Input
              type="date"
              className="mt-2 !text-sm"
              value={value.date}
              onChange={e => set({ date: e.target.value })}
            />
            <p className="text-[11px] text-ink-400 mt-1.5">
              Die Gewohnheit ist nur an diesem Tag fällig.
            </p>
          </>
        )}
      </div>

      {!isBoolean && (
        <div>
          <p className="text-xs font-semibold text-ink-600 mb-1.5">Tagesziel</p>
          <div className="flex gap-2">
            <Select
              className="!text-sm flex-1"
              value={value.targetCondition}
              onChange={e => set({ targetCondition: e.target.value })}
            >
              {TARGET_CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
            {value.targetCondition !== 'none' && (
              <Input
                type="number"
                className="!text-sm !w-24"
                min="0"
                step="0.1"
                value={value.targetValue}
                onChange={e => set({ targetValue: e.target.value })}
                placeholder={unitSymbol}
              />
            )}
          </div>
          <p className="text-[11px] text-ink-400 mt-1.5">
            Der Tag zählt nur als erfüllt, wenn der eingetragene Wert das Ziel erreicht.
          </p>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-ink-600 mb-1.5">Fehlende Tage in Statistik</p>
        <Select
          className="!text-sm"
          value={value.missingMode}
          onChange={e => set({ missingMode: e.target.value })}
        >
          <option value="none">Nicht eingetragen = kein Wert</option>
          <option value="default">Standardwert für fehlende Tage</option>
        </Select>
        {value.missingMode === 'default' && (
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-ink-500 whitespace-nowrap">Standardwert:</span>
            {isBoolean ? (
              // Yes/no habits know exactly two default states — no numbers here.
              <Select
                className="flex-1 !text-sm"
                value={+value.defaultVal > 0 ? '1' : '0'}
                onChange={e => set({ defaultVal: +e.target.value })}
              >
                <option value="0">Nein – nicht gemacht</option>
                <option value="1">Ja – gemacht</option>
              </Select>
            ) : (
              <Input
                type="number"
                className="flex-1 !text-sm"
                value={value.defaultVal}
                onChange={e => set({ defaultVal: e.target.value })}
                min="0"
                step="0.1"
                placeholder={`in ${unitSymbol || ''}`}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}

function HabitRow({ def, selected, onToggle, onDelete, onUpdate }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({ name: def.name, unitSymbol: def.unitSymbol, type: def.type });
  const [settings, setSettings] = useState(() => settingsStateFrom(def));

  const typeChanged = form.type !== def.type;

  const handleSave = async () => {
    setSaving(true);
    try {
      // Boolean habits need no unit — a check mark serves as the symbol.
      const payload = form.type === 'boolean' ? { ...form, unitSymbol: '✓' } : form;
      const res = await api.put(`/habits/definitions/${def._id}`, payload);
      const body = settingsPayload(settings, form.type);
      await api.put(`/habits/settings/${def._id}`, body);
      onUpdate({ ...def, ...res.data, ...body });
      setOpen(false);
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const badge = formatScheduleBadge(def);

  return (
    <div className="rounded-xl hover:bg-paper-50 transition-colors">
      <div className="flex items-center gap-1 p-2.5">
        <Checkbox
          checked={selected}
          onChange={onToggle}
          label={def.name}
          description={`${def.type === 'boolean' ? 'Ja/Nein' : def.unitSymbol}${badge ? ` · ${badge}` : ''}`}
          className="flex-1"
        />
        <IconButton
          icon={open ? ChevronUp : Settings2}
          label="Einstellungen"
          tone="brand"
          size={14}
          active={open}
          onClick={() => setOpen(v => !v)}
        />
        <IconButton icon={Trash2} label="Löschen" tone="danger" size={14} onClick={onDelete} />
      </div>

      {open && (
        <form
          onSubmit={e => { e.preventDefault(); handleSave(); }}
          className="px-3 pb-3 pt-3 space-y-3.5 border-t hairline mx-1"
        >
          <Field label="Name">
            <Input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Typ">
              <Select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
            {form.type !== 'boolean' && (
              <Field label="Einheit">
                <Input
                  value={form.unitSymbol}
                  onChange={e => setForm(f => ({ ...f, unitSymbol: e.target.value }))}
                  placeholder="z.B. min, ml"
                />
              </Field>
            )}
          </div>

          {typeChanged && (
            <p className="text-xs text-ocher-600 flex items-start gap-1.5">
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
              Typwechsel: Bestehende Einträge und Pläne behalten ihre Werte.
              {form.type === 'boolean'
                ? ' Bei Ja/Nein zählt künftig jeder Wert größer 0 als „gemacht“; das Tagesziel entfällt.'
                : ' Frühere Ja/Nein-Einträge erscheinen als 1er-Werte im Verlauf.'}
            </p>
          )}

          <HabitSettingsFields
            type={form.type}
            unitSymbol={form.unitSymbol}
            value={settings}
            onChange={setSettings}
          />

          <Button
            type="submit"
            size="sm"
            className="w-full"
            loading={saving}
            disabled={!settingsValid(settings)}
          >
            Übernehmen
          </Button>
        </form>
      )}
    </div>
  );
}

export default function ManageHabitsModal({ onSave, onClose, initialShowAdd = false, zIndex }) {
  const [defs, setDefs] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [newHabit, setNewHabit] = useState({ name: '', unitSymbol: '', type: 'amount' });
  const [newSettings, setNewSettings] = useState(() => settingsStateFrom());
  const [showAddForm, setShowAddForm] = useState(initialShowAdd);
  const [showTrash, setShowTrash] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingSaving, setAddingSaving] = useState(false);
  const [lastCreated, setLastCreated] = useState(null);

  useEffect(() => {
    api.get('/habits/definitions', { params: { includeDeleted: true } }).then(res => {
      setDefs(res.data);
      setSelected(new Set(res.data.filter(d => d.selected).map(d => d._id)));
      if (res.data.length === 0) setShowAddForm(true);
    }).catch(err => {
      console.error(err);
      setDefs([]);
    });
  }, []);

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
      onSave(lastCreated);
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddHabit = async (e) => {
    e.preventDefault();
    const isBoolean = newHabit.type === 'boolean';
    if (!newHabit.name.trim() || (!isBoolean && !newHabit.unitSymbol.trim())) return;
    setAddingSaving(true);
    try {
      const payload = {
        ...(isBoolean ? { ...newHabit, unitSymbol: '✓' } : newHabit),
        // Schedule & Co. travel with the creation — no second trip needed.
        ...settingsPayload(newSettings, newHabit.type),
      };
      const res = await api.post('/habits/definitions', payload);
      const created = { ...res.data, selected: true };
      setDefs(d => [...d, created]);
      setSelected(prev => new Set([...prev, created._id]));
      setLastCreated(created);
      setNewHabit({ name: '', unitSymbol: '', type: 'amount' });
      setNewSettings(settingsStateFrom());
      setShowAddForm(false);
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setAddingSaving(false);
    }
  };

  // Deleting moves the habit into the trash — logs and planner history keep
  // resolving, and it can be restored at any time.
  const handleDelete = async (def) => {
    if (!confirm('Gewohnheit in den Papierkorb legen? Einträge und Verlauf bleiben erhalten.')) return;
    try {
      await api.delete(`/habits/definitions/${def._id}`);
      setDefs(d => d.map(x => x._id === def._id ? { ...x, hidden: true, deletedAt: new Date().toISOString() } : x));
      setSelected(prev => { const next = new Set(prev); next.delete(def._id); return next; });
    } catch {
      alert('Löschen fehlgeschlagen.');
    }
  };

  const handleRestore = async (def) => {
    try {
      await api.post(`/habits/definitions/${def._id}/restore`);
      setDefs(d => d.map(x => x._id === def._id ? { ...x, hidden: false, deletedAt: null } : x));
    } catch {
      alert('Wiederherstellen fehlgeschlagen.');
    }
  };

  const handleUpdate = (updated) => {
    setDefs(d => d.map(def => def._id === updated._id ? { ...def, ...updated } : def));
  };

  const active = defs?.filter(d => !d.hidden) ?? [];
  const trashed = defs?.filter(d => d.hidden) ?? [];

  return (
    <Modal
      onClose={onClose}
      title="Gewohnheiten verwalten"
      subtitle="Auswahl, Zeitplan & Einstellungen an einem Ort"
      icon={Sparkles}
      zIndex={zIndex}
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>Abbrechen</Button>
          <Button className="flex-1" loading={saving} icon={Check} onClick={handleSave} disabled={defs === null}>
            {selected.size} aktiv – Speichern
          </Button>
        </>
      }
    >
      {defs === null ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* All habits — one list, everything managed the same way */}
          {active.length > 0 && (
            <div>
              <p className="label mb-2">Gewohnheiten</p>
              <div className="space-y-0.5">
                {active.map(d => (
                  <HabitRow
                    key={d._id}
                    def={d}
                    selected={selected.has(d._id)}
                    onToggle={() => toggle(d._id)}
                    onDelete={() => handleDelete(d)}
                    onUpdate={handleUpdate}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Add new habit — including schedule and defaults in one go */}
          {showAddForm ? (
            <form onSubmit={handleAddHabit} className="panel p-4 space-y-3.5">
              <p className="display text-base">Neue Gewohnheit</p>
              <Field label="Name">
                <Input
                  value={newHabit.name}
                  onChange={e => setNewHabit(h => ({ ...h, name: e.target.value }))}
                  placeholder="z.B. Vitamine, Stretching …"
                  autoFocus
                  required
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Typ">
                  <Select value={newHabit.type} onChange={e => setNewHabit(h => ({ ...h, type: e.target.value }))}>
                    {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </Select>
                </Field>
                {newHabit.type !== 'boolean' && (
                  <Field label="Einheit">
                    <Input
                      value={newHabit.unitSymbol}
                      onChange={e => setNewHabit(h => ({ ...h, unitSymbol: e.target.value }))}
                      placeholder="z.B. min, ml, Stück"
                      required
                    />
                  </Field>
                )}
              </div>
              <HabitSettingsFields
                type={newHabit.type}
                unitSymbol={newHabit.unitSymbol}
                value={newSettings}
                onChange={setNewSettings}
              />
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" className="flex-1" onClick={() => setShowAddForm(false)}>Abbrechen</Button>
                <Button type="submit" size="sm" className="flex-1" loading={addingSaving} disabled={!settingsValid(newSettings)}>
                  Hinzufügen
                </Button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-2 text-sm font-semibold text-brand-600 hover:text-brand-700 transition-colors py-1"
            >
              <Plus size={16} />
              Neue Gewohnheit hinzufügen
            </button>
          )}

          {/* Trash — compact and collapsed by default, no endless list */}
          {trashed.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowTrash(v => !v)}
                className="flex items-center gap-2 text-xs font-semibold text-ink-400 hover:text-ink-600 transition-colors py-1"
              >
                <Trash2 size={13} />
                Papierkorb ({trashed.length})
                {showTrash ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
              {showTrash && (
                <div className="space-y-0.5 mt-1.5">
                  {trashed.map(d => (
                    <div key={d._id} className="flex items-center gap-3 rounded-xl p-2.5 opacity-70 hover:opacity-100 hover:bg-paper-50 transition-all">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink-500 truncate">{d.name}</p>
                        <p className="text-xs text-ink-400">{d.type === 'boolean' ? 'Ja/Nein' : d.unitSymbol}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRestore(d)}
                        className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors px-2 py-1.5"
                      >
                        <RotateCcw size={12} />
                        Wiederherstellen
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
