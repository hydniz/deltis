import { useState, useEffect } from 'react';
import api from '../utils/api';
import { Sparkles, Plus, Check, Trash2, Settings2, ChevronUp, RotateCcw } from 'lucide-react';
import {
  Button, Field, Input, Select, Checkbox, Modal, IconButton, Segmented, Spinner,
} from './ui';
import { WEEKDAYS, formatScheduleBadge } from '../utils/habitSchedule';

// THE single place to create and configure habits. Everything lives here:
// selection (what to track), creating custom habits, editing/deleting them,
// and per-habit settings (weekday/date schedule, missing-day statistics).
// Used by the Habits page and by the goal wizard (layered via zIndex).
//
// Loads its own definitions so callers don't have to pass state around.
// `onSave(lastCreated)` receives the most recently created definition (or
// null) so the goal wizard can preselect it.

function HabitRow({ def, selected, onToggle, onDelete, onUpdate }) {
  const isCustom = !def.isPredefined;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Definition fields — editable for custom habits only
  const [form, setForm] = useState({ name: def.name, unitSymbol: def.unitSymbol, type: def.type });

  // Per-user settings (schedule + missing-day statistics)
  const [scheduleMode, setScheduleMode] = useState(
    def.scheduleDate ? 'date' : def.scheduleDays?.length ? 'weekly' : 'daily'
  );
  const [days, setDays] = useState(() => new Set(def.scheduleDays || []));
  const [date, setDate] = useState(def.scheduleDate || '');
  const [missingMode, setMissingMode] = useState(def.missingDayMode ?? 'none');
  const [defaultVal, setDefaultVal] = useState(def.defaultValue ?? 0);

  const toggleDay = (day) => {
    setDays(prev => {
      const next = new Set(prev);
      next.has(day) ? next.delete(day) : next.add(day);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let updated = { ...def };
      if (isCustom) {
        const res = await api.put(`/habits/definitions/${def._id}`, form);
        updated = { ...updated, ...res.data };
      }
      const scheduleDays = scheduleMode === 'weekly' ? [...days] : [];
      const scheduleDate = scheduleMode === 'date' && date ? date : null;
      await api.put(`/habits/settings/${def._id}`, {
        missingDayMode: missingMode,
        defaultValue: +defaultVal,
        scheduleDays,
        scheduleDate,
      });
      onUpdate({
        ...updated,
        scheduleDays,
        scheduleDate,
        missingDayMode: missingMode,
        defaultValue: +defaultVal,
      });
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
          description={`${def.unitSymbol}${badge ? ` · ${badge}` : ''}`}
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
          {isCustom && (
            <>
              <Field label="Name">
                <Input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Einheit">
                  <Input
                    value={form.unitSymbol}
                    onChange={e => setForm(f => ({ ...f, unitSymbol: e.target.value }))}
                    placeholder="z.B. min, ml"
                  />
                </Field>
                <Field label="Typ">
                  <Select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                    <option value="amount">Menge</option>
                    <option value="duration">Dauer</option>
                  </Select>
                </Field>
              </div>
            </>
          )}

          <div>
            <p className="text-xs font-semibold text-ink-600 mb-1.5">Geplante Tage</p>
            <Segmented
              value={scheduleMode}
              onChange={setScheduleMode}
              options={[
                { value: 'daily', label: 'Täglich' },
                { value: 'weekly', label: 'Wochentage' },
                { value: 'date', label: 'Nur ein Datum' },
              ]}
            />
            {scheduleMode === 'weekly' && (
              <>
                <div className="flex gap-1 mt-2">
                  {WEEKDAYS.map(({ value: day, label }) => (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={days.has(day)}
                      onClick={() => toggleDay(day)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        days.has(day)
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
            {scheduleMode === 'date' && (
              <>
                <Input
                  type="date"
                  className="mt-2 !text-sm"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                />
                <p className="text-[11px] text-ink-400 mt-1.5">
                  Die Gewohnheit ist nur an diesem Tag fällig.
                </p>
              </>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold text-ink-600 mb-1.5">Fehlende Tage in Statistik</p>
            <Select
              className="!text-sm"
              value={missingMode}
              onChange={e => setMissingMode(e.target.value)}
            >
              <option value="none">Nicht eingetragen = kein Wert</option>
              <option value="default">Standardwert für fehlende Tage</option>
            </Select>
            {missingMode === 'default' && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-ink-500 whitespace-nowrap">Standardwert:</span>
                <Input
                  type="number"
                  className="flex-1 !text-sm"
                  value={defaultVal}
                  onChange={e => setDefaultVal(e.target.value)}
                  min="0"
                  step="0.1"
                  placeholder={`in ${def.unitSymbol}`}
                />
              </div>
            )}
          </div>

          <Button
            type="submit"
            size="sm"
            className="w-full"
            loading={saving}
            disabled={scheduleMode === 'date' && !date}
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
  const [showAddForm, setShowAddForm] = useState(initialShowAdd);
  const [saving, setSaving] = useState(false);
  const [addingSaving, setAddingSaving] = useState(false);
  const [lastCreated, setLastCreated] = useState(null);

  useEffect(() => {
    api.get('/habits/definitions', { params: { includeHidden: true } }).then(res => {
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
    if (!newHabit.name.trim() || !newHabit.unitSymbol.trim()) return;
    setAddingSaving(true);
    try {
      const res = await api.post('/habits/definitions', newHabit);
      const created = { ...res.data, selected: true };
      setDefs(d => [...d, created]);
      setSelected(prev => new Set([...prev, created._id]));
      setLastCreated(created);
      setNewHabit({ name: '', unitSymbol: '', type: 'amount' });
      setShowAddForm(false);
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setAddingSaving(false);
    }
  };

  // Custom habits are removed for good; predefined ones are hidden per-user
  // (server decides) and reappear in the "Gelöscht" section for restoring.
  const handleDelete = async (def) => {
    if (!confirm('Gewohnheit löschen? Bestehende Einträge bleiben erhalten.')) return;
    try {
      await api.delete(`/habits/definitions/${def._id}`);
      setDefs(d => def.isPredefined
        ? d.map(x => x._id === def._id ? { ...x, hidden: true } : x)
        : d.filter(x => x._id !== def._id));
      setSelected(prev => { const next = new Set(prev); next.delete(def._id); return next; });
    } catch {
      alert('Löschen fehlgeschlagen.');
    }
  };

  const handleRestore = async (def) => {
    try {
      await api.post(`/habits/definitions/${def._id}/restore`);
      setDefs(d => d.map(x => x._id === def._id ? { ...x, hidden: false } : x));
    } catch {
      alert('Wiederherstellen fehlgeschlagen.');
    }
  };

  const handleUpdate = (updated) => {
    setDefs(d => d.map(def => def._id === updated._id ? { ...def, ...updated } : def));
  };

  const predefined = defs?.filter(d => d.isPredefined && !d.hidden) ?? [];
  const custom = defs?.filter(d => !d.isPredefined) ?? [];
  const hiddenDefs = defs?.filter(d => d.isPredefined && d.hidden) ?? [];

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
          {/* Predefined */}
          {predefined.length > 0 && (
            <div>
              <p className="label mb-2">Voreingestellt</p>
              <div className="space-y-0.5">
                {predefined.map(d => (
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

          {/* Custom */}
          {(custom.length > 0 || showAddForm) && (
            <div>
              <p className="label mb-2">Eigene</p>
              <div className="space-y-0.5">
                {custom.map(d => (
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

          {/* Deleted (hidden) predefined habits — restorable */}
          {hiddenDefs.length > 0 && (
            <div>
              <p className="label mb-2">Gelöscht</p>
              <div className="space-y-0.5">
                {hiddenDefs.map(d => (
                  <div key={d._id} className="flex items-center gap-3 rounded-xl p-2.5 opacity-70 hover:opacity-100 hover:bg-paper-50 transition-all">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink-500 truncate">{d.name}</p>
                      <p className="text-xs text-ink-400">{d.unitSymbol}</p>
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
            </div>
          )}

          {/* Add new habit */}
          {showAddForm ? (
            <form onSubmit={handleAddHabit} className="panel p-4 space-y-3">
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
                <Field label="Einheit">
                  <Input
                    value={newHabit.unitSymbol}
                    onChange={e => setNewHabit(h => ({ ...h, unitSymbol: e.target.value }))}
                    placeholder="z.B. min, ml, Stück"
                    required
                  />
                </Field>
                <Field label="Typ">
                  <Select value={newHabit.type} onChange={e => setNewHabit(h => ({ ...h, type: e.target.value }))}>
                    <option value="amount">Menge</option>
                    <option value="duration">Dauer</option>
                  </Select>
                </Field>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" className="flex-1" onClick={() => setShowAddForm(false)}>Abbrechen</Button>
                <Button type="submit" size="sm" className="flex-1" loading={addingSaving}>Hinzufügen</Button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-2 text-sm font-semibold text-brand-600 hover:text-brand-700 transition-colors py-1"
            >
              <Plus size={16} />
              Eigene Gewohnheit hinzufügen
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
