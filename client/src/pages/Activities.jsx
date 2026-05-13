import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';
import { format, parseISO, subWeeks, startOfWeek, endOfWeek } from 'date-fns';
import { de } from 'date-fns/locale';
import { Plus, Trash2, Dumbbell, X, TrendingUp, Settings as SettingsIcon, Pencil, Check } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';

// ── OptionsInput ─────────────────────────────────────────────────────────────
// Keeps raw text locally – only parses on blur.
// Prevents cursor jumping in controlled inputs with split/join transformations.

function OptionsInput({ options, onChange }) {
  const [raw, setRaw] = useState((options || []).join(', '));

  const handleBlur = () => {
    const parsed = raw.split(',').map(s => s.trim()).filter(Boolean);
    onChange(parsed);
    setRaw(parsed.join(', '));
  };

  return (
    <input
      className="input text-sm py-1.5"
      value={raw}
      onChange={e => setRaw(e.target.value)}
      onBlur={handleBlur}
      placeholder="z.B. Push, Pull, Legs"
    />
  );
}

// ── CustomFieldEditor ──────────────────────────────────────────────────────

function CustomFieldEditor({ field, onChange, onRemove }) {
  return (
    <div className="bg-white/[.06] border border-white/[.09] rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-white/40 uppercase tracking-wide">Feld</span>
        <button type="button" onClick={onRemove} className="text-white/30 hover:text-red-400 transition-colors">
          <X size={14} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label text-xs">Name</label>
          <input
            className="input text-sm py-1.5"
            value={field.label}
            onChange={e => onChange({ ...field, label: e.target.value, key: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
            placeholder="z.B. Gesamtgewicht"
          />
        </div>
        <div>
          <label className="label text-xs">Typ</label>
          <select
            className="input text-sm py-1.5"
            value={field.type}
            onChange={e => onChange({ ...field, type: e.target.value, options: [], unit: '' })}
          >
            <option value="number">Zahl</option>
            <option value="select">Auswahl (einzeln)</option>
            <option value="multiselect">Auswahl (mehrfach)</option>
          </select>
        </div>
      </div>
      {field.type === 'number' && (
        <div>
          <label className="label text-xs">Einheit</label>
          <input
            className="input text-sm py-1.5"
            value={field.unit || ''}
            onChange={e => onChange({ ...field, unit: e.target.value })}
            placeholder="z.B. kg, km, kcal"
          />
        </div>
      )}
      {(field.type === 'select' || field.type === 'multiselect') && (
        <div>
          <label className="label text-xs">Optionen (kommagetrennt)</label>
          <OptionsInput
            options={field.options}
            onChange={parsed => onChange({ ...field, options: parsed })}
          />
        </div>
      )}
      <label className="flex items-center gap-2 cursor-pointer pt-0.5">
        <input
          type="checkbox"
          checked={field.showInPreview !== false}
          onChange={e => onChange({ ...field, showInPreview: e.target.checked })}
          className="w-4 h-4 accent-brand-500"
        />
        <span className="text-xs text-slate-400">In Aktivitätenvorschau anzeigen</span>
      </label>
    </div>
  );
}

// ── ActivityTypeWizard ─────────────────────────────────────────────────────
// Shared create/edit wizard for activity types (2 steps).

function ActivityTypeWizard({ initialForm, title, submitLabel, onSubmit, onClose, originalFieldCount = 0 }) {
  const [form, setForm] = useState({ ...initialForm });
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const STEPS = 2;
  const stepTitles = ['Grundlagen', 'Eigene Felder'];

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addCustomField = () => setForm(f => ({
    ...f,
    customFields: [...(f.customFields || []), { key: '', label: '', type: 'number', unit: '', options: [] }]
  }));

  const updateCustomField = (i, updatedField) => setForm(f => ({
    ...f,
    customFields: f.customFields.map((cf, idx) => {
      if (idx !== i) return cf;
      if (idx < originalFieldCount) return { ...updatedField, key: cf.key };
      return updatedField;
    })
  }));

  const removeCustomField = (i) => setForm(f => ({
    ...f,
    customFields: f.customFields.filter((_, idx) => idx !== i)
  }));

  const handleSubmit = async () => {
    if (!form.label.trim()) return;
    setSaving(true);
    try {
      await onSubmit(form);
    } catch (err) {
      alert('Fehler: ' + err.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center z-[60]">
      <div
        className="bg-[#1e1a14]/95 backdrop-blur-2xl border border-white/[.1] w-full max-w-lg rounded-t-2xl sm:rounded-2xl flex flex-col"
        style={{ maxHeight: '92dvh' }}
      >
        <div className="w-10 h-1 bg-white/15 rounded-full mx-auto mt-3 sm:hidden flex-shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/[.08] flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-white">{title}</h2>
            <p className="text-xs text-white/35 mt-0.5">{stepTitles[step - 1]}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              {Array.from({ length: STEPS }).map((_, i) => (
                <div key={i} className={`rounded-full transition-all duration-200 ${
                  i + 1 === step ? 'w-5 h-1.5 bg-brand-500' :
                  i + 1 < step  ? 'w-1.5 h-1.5 bg-brand-600' :
                                  'w-1.5 h-1.5 bg-white/15'
                }`} />
              ))}
            </div>
            <button type="button" onClick={onClose} className="text-white/40 hover:text-white/80 p-1 -mr-1">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">

          {/* Step 1: Grundlagen */}
          {step === 1 && (<>
            <div>
              <label className="label">Name des Aktivitätstyps</label>
              <input
                className="input text-base"
                value={form.label}
                onChange={e => setField('label', e.target.value)}
                placeholder="z.B. Joggen, Krafttraining, Klettern …"
                autoFocus
              />
            </div>

            <div className="bg-white/[.05] border border-white/[.09] rounded-2xl p-4 space-y-3">
              <p className="label mb-0">Standard-Felder</p>
              <label className="flex items-center gap-3 cursor-pointer">
                <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                  form.showDuration ? 'bg-brand-600 border-brand-600' : 'border-white/30'
                }`}>
                  {form.showDuration && <Check size={12} className="text-white" strokeWidth={3} />}
                </div>
                <input type="checkbox" checked={form.showDuration} onChange={e => setField('showDuration', e.target.checked)} className="sr-only" />
                <div>
                  <p className="text-sm font-medium text-white/80">Dauer</p>
                  <p className="text-xs text-white/35">Dauer der Aktivität in Minuten</p>
                </div>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                  form.showDistance ? 'bg-brand-600 border-brand-600' : 'border-white/30'
                }`}>
                  {form.showDistance && <Check size={12} className="text-white" strokeWidth={3} />}
                </div>
                <input type="checkbox" checked={form.showDistance} onChange={e => setField('showDistance', e.target.checked)} className="sr-only" />
                <div>
                  <p className="text-sm font-medium text-white/80">Distanz</p>
                  <p className="text-xs text-white/35">Zurückgelegte Distanz in km</p>
                </div>
              </label>
            </div>
          </>)}

          {/* Step 2: Eigene Felder */}
          {step === 2 && (<>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">Eigene Felder</p>
                <p className="text-xs text-white/35 mt-0.5">Optionale Felder, die du selbst definierst</p>
              </div>
              <button
                type="button"
                onClick={addCustomField}
                className="flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors"
              >
                <Plus size={14} /> Feld hinzufügen
              </button>
            </div>

            {(form.customFields || []).length === 0 ? (
              <button
                type="button"
                onClick={addCustomField}
                className="w-full border-2 border-dashed border-white/15 hover:border-brand-400/50 rounded-2xl py-8 text-white/35 hover:text-brand-400 transition-colors flex flex-col items-center gap-2"
              >
                <Plus size={22} />
                <span className="text-sm">Erstes Feld hinzufügen</span>
              </button>
            ) : (
              <div className="space-y-2">
                {(form.customFields || []).map((field, i) => (
                  <CustomFieldEditor
                    key={i}
                    field={field}
                    onChange={updated => updateCustomField(i, updated)}
                    onRemove={() => removeCustomField(i)}
                  />
                ))}
              </div>
            )}
          </>)}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-white/[.08] flex-shrink-0">
          {step > 1
            ? <button type="button" onClick={() => setStep(s => s - 1)} className="btn-secondary flex-1">Zurück</button>
            : <button type="button" onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
          }
          {step < STEPS ? (
            <button
              type="button"
              onClick={() => setStep(s => s + 1)}
              disabled={!form.label.trim()}
              className="btn-primary flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
            >Weiter</button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving || !form.label.trim()}
              className="btn-primary flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
            >{saving ? 'Speichern...' : submitLabel}</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ActivityTypeCard ───────────────────────────────────────────────────────

function ActivityTypeCard({ type, onSave, onDelete }) {
  const [showEdit, setShowEdit] = useState(false);
  const originalFieldCount = useRef((type.customFields || []).length);

  const handleEdit = async (form) => {
    await api.put(`/activity-types/${type._id}`, form);
    await onSave();
    setShowEdit(false);
  };

  return (
    <>
      <div className="bg-white/[.05] border border-white/[.09] rounded-2xl px-4 py-3 flex items-center gap-3">
        <Dumbbell size={15} className="text-brand-400 flex-shrink-0" />
        <span className="flex-1 font-medium text-white/80 text-sm">{type.label}</span>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {type.showDuration && <span className="badge bg-white/[.07] text-white/40 text-xs">Dauer</span>}
          {type.showDistance && <span className="badge bg-white/[.07] text-white/40 text-xs">Distanz</span>}
          {type.customFields?.length > 0 && (
            <span className="badge bg-white/[.07] text-white/40 text-xs">
              {type.customFields.length} Feld{type.customFields.length !== 1 ? 'er' : ''}
            </span>
          )}
          <button
            onClick={() => setShowEdit(true)}
            className="text-white/30 hover:text-brand-400 transition-colors p-1"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => onDelete(type._id)}
            className="text-white/30 hover:text-red-400 transition-colors p-1"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {showEdit && (
        <ActivityTypeWizard
          title="Typ bearbeiten"
          submitLabel="Speichern"
          initialForm={{ ...type }}
          originalFieldCount={originalFieldCount.current}
          onSubmit={handleEdit}
          onClose={() => setShowEdit(false)}
        />
      )}
    </>
  );
}

// ── ActivityTypesModal ─────────────────────────────────────────────────────

function ActivityTypesModal({ onClose, onUpdate }) {
  const [types, setTypes] = useState([]);
  const [showCreate, setShowCreate] = useState(false);

  const loadTypes = useCallback(async () => {
    const res = await api.get('/activity-types');
    setTypes(res.data);
  }, []);

  useEffect(() => { loadTypes(); }, [loadTypes]);

  const handleCreate = async (form) => {
    await api.post('/activity-types', form);
    await loadTypes();
    onUpdate();
    setShowCreate(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('Aktivitätstyp löschen? Bestehende Einträge bleiben erhalten.')) return;
    await api.delete(`/activity-types/${id}`);
    await loadTypes();
    onUpdate();
  };

  const handleSave = async () => {
    await loadTypes();
    onUpdate();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center z-50">
        <div
          className="bg-[#1e1a14]/95 backdrop-blur-2xl border border-white/[.1] w-full max-w-lg rounded-t-2xl sm:rounded-2xl flex flex-col"
          style={{ maxHeight: '92dvh' }}
        >
          <div className="w-10 h-1 bg-white/15 rounded-full mx-auto mt-3 sm:hidden flex-shrink-0" />

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-4 border-b border-white/[.08] flex-shrink-0">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Dumbbell size={17} className="text-brand-400" />
              Aktivitätstypen verwalten
            </h2>
            <button onClick={onClose} className="text-white/40 hover:text-white/80"><X size={20} /></button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
            {types.map(type => (
              <ActivityTypeCard
                key={type._id}
                type={type}
                onSave={handleSave}
                onDelete={handleDelete}
              />
            ))}
            {types.length === 0 && (
              <div className="text-center py-10">
                <Dumbbell size={28} className="text-white/15 mx-auto mb-2" />
                <p className="text-sm text-white/30">Noch keine Aktivitätstypen</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-white/[.08] flex-shrink-0">
            <button
              onClick={() => setShowCreate(true)}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              <Plus size={16} /> Neuer Typ
            </button>
          </div>
        </div>
      </div>

      {showCreate && (
        <ActivityTypeWizard
          title="Neuer Aktivitätstyp"
          submitLabel="Erstellen"
          initialForm={{ label: '', showDuration: true, showDistance: false, customFields: [] }}
          onSubmit={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}
    </>
  );
}

// ── Activity form ─────────────────────────────────────────────────────

function ActivityForm({ activityTypes, onSave, onClose }) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [selectedType, setSelectedType] = useState(activityTypes[0] || null);
  const [form, setForm] = useState({ date: today, duration: '', distance: '', notes: '' });
  const [customValues, setCustomValues] = useState({});
  const [saving, setSaving] = useState(false);

  const handleTypeChange = (id) => {
    const t = activityTypes.find(t => t._id === id);
    setSelectedType(t || null);
    setCustomValues({});
  };

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setCustomField = (k, v) => setCustomValues(cv => ({ ...cv, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedType) return;
    setSaving(true);
    try {
      await api.post('/activities', {
        activityType: selectedType.label,
        activityTypeRef: selectedType._id,
        date: form.date,
        duration: form.duration ? +form.duration : undefined,
        distance: form.distance ? +form.distance : undefined,
        notes: form.notes || undefined,
        customValues,
      });
      onSave();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white">Aktivität eintragen</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Aktivität</label>
            <select
              className="input"
              value={selectedType?._id || ''}
              onChange={e => handleTypeChange(e.target.value)}
            >
              {activityTypes.map(t => (
                <option key={t._id} value={t._id}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Datum</label>
            <input type="date" className="input" value={form.date} onChange={e => setField('date', e.target.value)} required />
          </div>

          {selectedType?.showDuration && (
            <div>
              <label className="label">Dauer (min)</label>
              <input type="number" className="input" value={form.duration} onChange={e => setField('duration', e.target.value)} min="1" placeholder="z.B. 60" />
            </div>
          )}

          {selectedType?.showDistance && (
            <div>
              <label className="label">Distanz (km)</label>
              <input type="number" className="input" value={form.distance} onChange={e => setField('distance', e.target.value)} min="0" step="0.1" placeholder="z.B. 5.5" />
            </div>
          )}

          {/* Custom Fields */}
          {selectedType?.customFields?.map(field => (
            <div key={field.key}>
              <label className="label">
                {field.label}
                {field.unit && <span className="text-slate-600 ml-1">({field.unit})</span>}
              </label>
              {field.type === 'select' ? (
                <select
                  className="input"
                  value={customValues[field.key] || ''}
                  onChange={e => setCustomField(field.key, e.target.value)}
                >
                  <option value="">– Keine Auswahl –</option>
                  {field.options.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : field.type === 'multiselect' ? (
                <div className="flex flex-wrap gap-x-4 gap-y-2 px-1">
                  {field.options.map(opt => (
                    <label key={opt} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(customValues[field.key] || []).includes(opt)}
                        onChange={e => {
                          const cur = customValues[field.key] || [];
                          setCustomField(field.key, e.target.checked ? [...cur, opt] : cur.filter(v => v !== opt));
                        }}
                        className="w-4 h-4 accent-brand-500"
                      />
                      <span className="text-sm text-slate-300">{opt}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="number"
                    className="input flex-1"
                    value={customValues[field.key] || ''}
                    onChange={e => setCustomField(field.key, e.target.value)}
                    min="0"
                    step="0.01"
                    placeholder={field.unit ? `in ${field.unit}` : ''}
                  />
                  {field.unit && (
                    <span className="flex items-center px-3 bg-white/[.08] border border-white/[.1] rounded-xl text-white/50 text-sm whitespace-nowrap">
                      {field.unit}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}

          <div>
            <label className="label">Notizen</label>
            <textarea className="input resize-none" rows={2} value={form.notes} onChange={e => setField('notes', e.target.value)} placeholder="Optional..." />
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
            <button type="submit" disabled={saving || !selectedType} className="btn-primary flex-1">
              {saving ? 'Speichern...' : 'Speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── History chart ──────────────────────────────────────────────────────────

function ActivityChart({ typeId, typeLabel, onClose }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const now = new Date();
      const start = subWeeks(now, 11);
      try {
        const res = await api.get('/activities', {
          params: { typeRef: typeId, startDate: start.toISOString(), endDate: now.toISOString(), limit: 500 }
        });
        const weeks = Array.from({ length: 12 }, (_, i) => {
          const ws = startOfWeek(subWeeks(now, 11 - i), { weekStartsOn: 1 });
          const we = endOfWeek(ws, { weekStartsOn: 1 });
          const count = res.data.activities.filter(a => {
            const d = parseISO(a.date.slice(0, 10));
            return d >= ws && d <= we;
          }).length;
          return { kw: format(ws, "'KW' w", { locale: de }), Einheiten: count };
        });
        setData(weeks);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [typeLabel]);

  return (
    <div className="card p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-white flex items-center gap-2">
          <TrendingUp size={16} className="text-brand-400" />
          Verlauf – {typeLabel}
        </h2>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center h-28">
          <div className="w-6 h-6 border-2 border-zinc-700 border-t-brand-500 rounded-full animate-spin" />
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="kw" tick={{ fill: 'rgba(255,255,255,0.30)', fontSize: 10 }} tickLine={false} />
            <YAxis tick={{ fill: 'rgba(255,255,255,0.30)', fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} width={20} />
            <Tooltip
              contentStyle={{ background: 'rgba(30,28,50,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, color: '#fff', backdropFilter: 'blur(8px)' }}
              formatter={(v) => [`${v}x`, typeLabel]}
            />
            <Bar dataKey="Einheiten" fill="#c4623a" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── Edit activity ────────────────────────────────────────────────────

function EditActivityModal({ activity, onSave, onClose }) {
  // Aktuelle Felddefinitionen verwenden (nicht historische), damit neue Felder erscheinen
  const typeConfig = activity.activityTypeRef || {};
  const currentFields = typeConfig.customFields || [];

  const [form, setForm] = useState({
    date: activity.date?.slice(0, 10) || format(new Date(), 'yyyy-MM-dd'),
    duration: activity.duration ?? '',
    distance: activity.distance ?? '',
    notes: activity.notes ?? '',
  });
  const [customValues, setCustomValues] = useState({ ...(activity.customValues || {}) });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setCustomField = (k, v) => setCustomValues(cv => ({ ...cv, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put(`/activities/${activity._id}`, {
        date: new Date(form.date + 'T12:00:00').toISOString(),
        duration: form.duration !== '' ? +form.duration : null,
        distance: form.distance !== '' ? +form.distance : null,
        notes: form.notes || undefined,
        customValues,
      });
      onSave();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-white">Aktivität bearbeiten</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200"><X size={20} /></button>
        </div>
        <p className="text-sm text-slate-400 mb-5">
          {typeConfig.label || activity.activityType}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
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

          {/* Aktuelle Felddefinitionen – inkl. neu hinzugefügter Felder */}
          {currentFields.map(field => (
            <div key={field.key}>
              <label className="label">
                {field.label}
                {field.unit && <span className="text-slate-500 ml-1">({field.unit})</span>}
              </label>
              {field.type === 'select' ? (
                <select className="input" value={customValues[field.key] || ''} onChange={e => setCustomField(field.key, e.target.value)}>
                  <option value="">– Keine Auswahl –</option>
                  {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              ) : field.type === 'multiselect' ? (
                <div className="flex flex-wrap gap-x-4 gap-y-2 px-1">
                  {field.options.map(opt => (
                    <label key={opt} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(customValues[field.key] || []).includes(opt)}
                        onChange={e => {
                          const cur = customValues[field.key] || [];
                          setCustomField(field.key, e.target.checked ? [...cur, opt] : cur.filter(v => v !== opt));
                        }}
                        className="w-4 h-4 accent-brand-500"
                      />
                      <span className="text-sm text-slate-300">{opt}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="number" className="input flex-1"
                    value={customValues[field.key] ?? ''}
                    onChange={e => setCustomField(field.key, e.target.value)}
                    min="0" step="0.01"
                    placeholder={field.unit ? `in ${field.unit}` : ''}
                  />
                  {field.unit && (
                    <span className="flex items-center px-3 bg-white/[.08] border border-white/[.1] rounded-xl text-white/50 text-sm whitespace-nowrap">
                      {field.unit}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}

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

// ── Activity card ────────────────────────────────────────────────────────

function ActivityCard({ activity, onDelete, onEdit }) {
  const [editing, setEditing] = useState(false);

  // showInPreview always comes from the CURRENT fields (display preference)
  // Label/unit come from the HISTORICAL fields if the name has changed
  const currentFields = activity.activityTypeRef?.customFields || [];
  const historicalFields = activity.historicalCustomFields;
  const histMap = Object.fromEntries((historicalFields || []).map(f => [f.key, f]));

  const currentLabel = activity.activityTypeRef?.label || activity.activityType;
  const displayLabel = activity.historicalLabel
    ? `${currentLabel} (${activity.historicalLabel})`
    : currentLabel;

  return (
    <>
      <div className="card p-4 flex items-start gap-4 hover:border-slate-700 transition-colors">
        <div className="flex-shrink-0 mt-0.5">
          <span className="badge bg-white/[.1] text-white/60 py-1 px-2.5 whitespace-nowrap">
            {displayLabel}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-200">
            {format(parseISO(activity.date.slice(0, 10)), 'EEEE, d. MMMM yyyy', { locale: de })}
          </p>

          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
            {activity.duration && (
              <span className="text-xs text-slate-400">{activity.duration} min</span>
            )}
            {activity.distance && (
              <span className="text-xs text-slate-400">{activity.distance} km</span>
            )}
            {currentFields.filter(f => f.showInPreview !== false).map(field => {
              const val = activity.customValues?.[field.key];
              if (!val && val !== 0) return null;
              // Historisches Label/Einheit verwenden falls Feld umbenannt wurde
              const hist = histMap[field.key];
              const label = hist && historicalFields ? hist.label : field.label;
              const unit  = hist && historicalFields ? hist.unit  : field.unit;
              const display = Array.isArray(val) ? val.join(', ') : val;
              return (
                <span key={field.key} className="text-xs text-slate-400">
                  {label}: <span className="text-slate-300 font-medium">
                    {display}{unit && !Array.isArray(val) ? ` ${unit}` : ''}
                  </span>
                </span>
              );
            })}
            {!currentFields.length && activity.customValues && Object.entries(activity.customValues).map(([k, v]) => (
              <span key={k} className="text-xs text-slate-400">
                {k}: <span className="text-slate-300 font-medium">{Array.isArray(v) ? v.join(', ') : v}</span>
              </span>
            ))}
          </div>

          {activity.notes && (
            <p className="text-xs text-slate-500 mt-1 truncate">{activity.notes}</p>
          )}
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={() => setEditing(true)}
            className="text-slate-600 hover:text-brand-400 transition-colors p-1"
            title="Bearbeiten"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => onDelete(activity._id)}
            className="text-slate-600 hover:text-red-400 transition-colors p-1 -mr-1"
            title="Löschen"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {editing && (
        <EditActivityModal
          activity={activity}
          onSave={() => { setEditing(false); onEdit(); }}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function Activities() {
  const [activityTypes, setActivityTypes] = useState([]);
  const [activities, setActivities] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showTypesModal, setShowTypesModal] = useState(false);
  const [filter, setFilter] = useState(''); // activityType._id
  const [chartType, setChartType] = useState(null); // { _id, label } | null
  const [page, setPage] = useState(0);
  const limit = 20;

  const loadTypes = useCallback(async () => {
    const res = await api.get('/activity-types');
    setActivityTypes(res.data);
  }, []);

  const loadActivities = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/activities', {
        params: { typeRef: filter || undefined, limit, skip: page * limit }
      });
      setActivities(res.data.activities);
      setTotal(res.data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => { loadTypes(); }, []);
  useEffect(() => { loadActivities(); }, [loadActivities]);

  const handleDelete = async (id) => {
    if (!confirm('Aktivität löschen?')) return;
    await api.delete(`/activities/${id}`);
    loadActivities();
  };

  const handleSave = () => {
    setShowForm(false);
    setPage(0);
    loadActivities();
  };

  const toggleChart = (type) => {
    setChartType(prev => prev?._id === type._id ? null : type);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Aktivitäten</h1>
          <p className="text-slate-400 text-sm mt-0.5">{total} Einheiten insgesamt</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          <span className="hidden sm:inline">Eintragen</span>
        </button>
      </div>

      {/* Filter + Typen-Button */}
      <div className="flex gap-2 flex-wrap items-center">
        <button
          onClick={() => { setFilter(''); setPage(0); setChartType(null); }}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            !filter ? 'bg-brand-600 text-white shadow-md shadow-brand-600/25' : 'bg-white/[.08] text-white/50 hover:text-white/80'
          }`}
        >
          Alle
        </button>
        {activityTypes.map(t => (
          <div key={t._id} className="flex items-center gap-0.5">
            <button
              onClick={() => { setFilter(t._id); setPage(0); }}
              className={`px-3 py-1.5 rounded-l-md text-sm font-medium transition-colors ${
                filter === t._id ? 'bg-brand-600 text-white shadow-md shadow-brand-600/25' : 'bg-white/[.08] text-white/50 hover:text-white/80'
              }`}
            >
              {t.label}
            </button>
            <button
              onClick={() => toggleChart({ _id: t._id, label: t.label })}
              title="Verlauf anzeigen"
              className={`p-2 rounded-r-md text-sm transition-colors border-l border-white/[.08] ${
                chartType?._id === t._id
                  ? 'bg-brand-600 text-white'
                  : 'bg-white/[.08] text-white/40 hover:text-brand-300'
              }`}
            >
              <TrendingUp size={14} />
            </button>
          </div>
        ))}
        <button
          onClick={() => setShowTypesModal(true)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-white/[.08] text-white/50 hover:text-white/80 transition-colors"
          title="Aktivitätstypen verwalten"
        >
          <SettingsIcon size={14} />
          <span className="hidden sm:inline">Typen</span>
        </button>
      </div>

      {/* Chart */}
      {chartType && (
        <ActivityChart typeId={chartType._id} typeLabel={chartType.label} onClose={() => setChartType(null)} />
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-brand-500 rounded-full animate-spin" />
        </div>
      ) : activities.length === 0 ? (
        <div className="card p-12 text-center">
          <Dumbbell size={36} className="text-white/15 mx-auto mb-3" />
          <p className="text-white/40">Noch keine Aktivitäten eingetragen</p>
          <button onClick={() => setShowForm(true)} className="btn-primary mt-4 inline-flex items-center gap-2">
            <Plus size={16} /> Erste Aktivität eintragen
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {activities.map(a => (
            <ActivityCard
              key={a._id}
              activity={a}
              onDelete={handleDelete}
              onEdit={loadActivities}
            />
          ))}
        </div>
      )}

      {total > limit && (
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="btn-secondary px-3 py-1.5 text-sm disabled:opacity-40">
            Zurück
          </button>
          <span className="text-slate-400 text-sm">Seite {page + 1} von {Math.ceil(total / limit)}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * limit >= total} className="btn-secondary px-3 py-1.5 text-sm disabled:opacity-40">
            Weiter
          </button>
        </div>
      )}

      {showForm && activityTypes.length > 0 && (
        <ActivityForm
          activityTypes={activityTypes}
          onSave={handleSave}
          onClose={() => setShowForm(false)}
        />
      )}

      {showTypesModal && (
        <ActivityTypesModal
          onClose={() => setShowTypesModal(false)}
          onUpdate={loadTypes}
        />
      )}
    </div>
  );
}
