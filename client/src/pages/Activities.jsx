import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';
import { format, parseISO, subWeeks, startOfWeek, endOfWeek } from 'date-fns';
import { de } from 'date-fns/locale';
import { Plus, Trash2, Dumbbell, X, TrendingUp, Settings as SettingsIcon, Pencil } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';
import {
  PageHeader, Button, Field, Input, Select, Textarea, Chip,
  chipColorFor, Modal, IconButton, EmptyState, PageLoader, Spinner, useChart,
  TONE_ACCENT_BORDER,
} from '../components/ui';
import ActivityTypeWizard from '../components/ActivityTypeWizard';

// ActivityTypeCard

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
      <div className="panel px-4 py-3 flex items-center gap-3">
        <Chip color={chipColorFor(type._id)}>{type.label}</Chip>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 flex-wrap justify-end text-xs text-ink-400">
          {type.showDuration && <span>Dauer</span>}
          {type.showDuration && (type.showDistance || type.customFields?.length > 0) && <span>·</span>}
          {type.showDistance && <span>Distanz</span>}
          {type.showDistance && type.customFields?.length > 0 && <span>·</span>}
          {type.customFields?.length > 0 && (
            <span>{type.customFields.length} Feld{type.customFields.length !== 1 ? 'er' : ''}</span>
          )}
          <IconButton icon={Pencil} label="Bearbeiten" tone="brand" size={14} onClick={() => setShowEdit(true)} />
          <IconButton icon={Trash2} label="Löschen" tone="danger" size={14} onClick={() => onDelete(type._id)} />
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

// ActivityTypesModal

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
      <Modal
        onClose={onClose}
        title="Aktivitätstypen verwalten"
        subtitle="Eigene Sportarten mit eigenen Feldern"
        icon={Dumbbell}
        size="lg"
        footer={
          <Button className="w-full" icon={Plus} onClick={() => setShowCreate(true)}>
            Neuer Typ
          </Button>
        }
      >
        <div className="space-y-2.5">
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
              <Dumbbell size={28} className="text-ink-200 mx-auto mb-2" />
              <p className="text-sm text-ink-400">Noch keine Aktivitätstypen</p>
            </div>
          )}
        </div>
      </Modal>

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

// Shared custom-field inputs for activity forms

function CustomFieldControl({ field, value, onChange }) {
  if (field.type === 'select') {
    return (
      <Select value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">– Keine Auswahl –</option>
        {field.options.map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
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
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        min="0"
        step="0.01"
        placeholder={field.unit ? `in ${field.unit}` : ''}
      />
      {field.unit && (
        <span className="flex items-center px-3 panel text-ink-500 text-sm whitespace-nowrap">
          {field.unit}
        </span>
      )}
    </div>
  );
}

// Activity form

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
    <Modal
      onClose={onClose}
      title="Aktivität eintragen"
      icon={Dumbbell}
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>Abbrechen</Button>
          <Button type="submit" form="activity-form" className="flex-1" loading={saving} disabled={!selectedType}>
            Speichern
          </Button>
        </>
      }
    >
      <form id="activity-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="Aktivität">
          <Select value={selectedType?._id || ''} onChange={e => handleTypeChange(e.target.value)}>
            {activityTypes.map(t => (
              <option key={t._id} value={t._id}>{t.label}</option>
            ))}
          </Select>
        </Field>

        <Field label="Datum">
          <Input type="date" value={form.date} onChange={e => setField('date', e.target.value)} required />
        </Field>

        {selectedType?.showDuration && (
          <Field label="Dauer (min)">
            <Input type="number" value={form.duration} onChange={e => setField('duration', e.target.value)} min="1" placeholder="z.B. 60" />
          </Field>
        )}

        {selectedType?.showDistance && (
          <Field label="Distanz (km)">
            <Input type="number" value={form.distance} onChange={e => setField('distance', e.target.value)} min="0" step="0.1" placeholder="z.B. 5.5" />
          </Field>
        )}

        {/* Custom fields */}
        {selectedType?.customFields?.map(field => (
          <Field
            key={field.key}
            label={<>{field.label}{field.unit && <span className="text-ink-300 ml-1 normal-case">({field.unit})</span>}</>}
          >
            <CustomFieldControl
              field={field}
              value={customValues[field.key]}
              onChange={v => setCustomField(field.key, v)}
            />
          </Field>
        ))}

        <Field label="Notizen">
          <Textarea rows={2} value={form.notes} onChange={e => setField('notes', e.target.value)} placeholder="Optional…" />
        </Field>
      </form>
    </Modal>
  );
}

// History chart

function ActivityChart({ typeId, typeLabel, onClose }) {
  const CHART = useChart();
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
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="display text-lg flex items-center gap-2">
          <TrendingUp size={15} className="text-brand-500" />
          Verlauf – {typeLabel}
        </h2>
        <IconButton icon={X} label="Schließen" onClick={onClose} />
      </div>
      {loading ? (
        <div className="flex items-center justify-center h-28">
          <Spinner size="md" />
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
            <XAxis dataKey="kw" tick={CHART.tick} tickLine={false} />
            <YAxis tick={CHART.tick} tickLine={false} axisLine={false} allowDecimals={false} width={20} />
            <Tooltip
              contentStyle={CHART.tooltip}
              cursor={{ fill: 'rgba(196, 98, 58, 0.06)' }}
              formatter={(v) => [`${v}x`, typeLabel]}
            />
            <Bar dataKey="Einheiten" fill={CHART.line} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// Edit activity

function EditActivityModal({ activity, onSave, onClose }) {
  // Use the CURRENT field definitions (not historical) so new fields appear
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
    <Modal
      onClose={onClose}
      title="Aktivität bearbeiten"
      subtitle={typeConfig.label || activity.activityType}
      icon={Pencil}
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>Abbrechen</Button>
          <Button type="submit" form="edit-activity-form" className="flex-1" loading={saving}>
            Speichern
          </Button>
        </>
      }
    >
      <form id="edit-activity-form" onSubmit={handleSubmit} className="space-y-4">
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

        {/* Current field definitions – including newly added fields */}
        {currentFields.map(field => (
          <Field
            key={field.key}
            label={<>{field.label}{field.unit && <span className="text-ink-300 ml-1 normal-case">({field.unit})</span>}</>}
          >
            <CustomFieldControl
              field={field}
              value={customValues[field.key]}
              onChange={v => setCustomField(field.key, v)}
            />
          </Field>
        ))}

        <Field label="Notizen">
          <Textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional…" />
        </Field>
      </form>
    </Modal>
  );
}

// Activity card

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

  const chipKey = activity.activityTypeRef?._id || activity.activityType;
  const tone = chipColorFor(chipKey);

  return (
    <>
      <div className={`card p-4 flex items-start gap-3.5 border-l-4 ${TONE_ACCENT_BORDER[tone]}`}>
        <div className="flex-shrink-0 mt-0.5">
          <Chip color={tone}>{displayLabel}</Chip>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink-800">
            {format(parseISO(activity.date.slice(0, 10)), 'EEEE, d. MMMM yyyy', { locale: de })}
          </p>

          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
            {activity.duration && (
              <span className="text-xs text-ink-500">{activity.duration} min</span>
            )}
            {activity.distance && (
              <span className="text-xs text-ink-500">{activity.distance} km</span>
            )}
            {currentFields.filter(f => f.showInPreview !== false).map(field => {
              const val = activity.customValues?.[field.key];
              if (!val && val !== 0) return null;
              // Use historical label/unit if the field was renamed
              const hist = histMap[field.key];
              const label = hist && historicalFields ? hist.label : field.label;
              const unit  = hist && historicalFields ? hist.unit  : field.unit;
              const display = Array.isArray(val) ? val.join(', ') : val;
              return (
                <span key={field.key} className="text-xs text-ink-500">
                  {label}: <span className="text-ink-700 font-medium">
                    {display}{unit && !Array.isArray(val) ? ` ${unit}` : ''}
                  </span>
                </span>
              );
            })}
            {!currentFields.length && activity.customValues && Object.entries(activity.customValues).map(([k, v]) => (
              <span key={k} className="text-xs text-ink-500">
                {k}: <span className="text-ink-700 font-medium">{Array.isArray(v) ? v.join(', ') : v}</span>
              </span>
            ))}
          </div>

          {activity.notes && (
            <p className="text-xs text-ink-400 mt-1 truncate">{activity.notes}</p>
          )}
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <IconButton icon={Pencil} label="Bearbeiten" tone="brand" size={14} onClick={() => setEditing(true)} />
          <IconButton icon={Trash2} label="Löschen" tone="danger" size={15} onClick={() => onDelete(activity._id)} />
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

// Main page

export default function Activities() {
  const [activityTypes, setActivityTypes] = useState([]);
  const [activities, setActivities] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showFirstTypeWizard, setShowFirstTypeWizard] = useState(false);
  const [showTypesModal, setShowTypesModal] = useState(false);
  const [filter, setFilter] = useState(''); // activityType._id
  const [showChart, setShowChart] = useState(false);
  const [page, setPage] = useState(0);
  const limit = 20;

  const loadTypes = useCallback(async () => {
    const res = await api.get('/activity-types');
    setActivityTypes(res.data);
  }, []);

  // Mutations refresh silently in place; filter/page changes show the
  // loader via the effect below.
  const loadActivities = useCallback(async () => {
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
  useEffect(() => { setLoading(true); loadActivities(); }, [loadActivities]);

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

  // Without any activity type the log form would be empty — guide the user
  // through creating the first type, then continue straight to logging.
  const handleOpenForm = () => {
    if (activityTypes.length === 0) {
      setShowFirstTypeWizard(true);
      return;
    }
    setShowForm(true);
  };

  const handleCreateFirstType = async (form) => {
    await api.post('/activity-types', form);
    await loadTypes();
    setShowFirstTypeWizard(false);
    setShowForm(true);
  };

  const filteredType = activityTypes.find(t => t._id === filter) || null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Aktivitäten"
        icon={Dumbbell}
        tone="clay"
        subtitle={`${total} Einheiten insgesamt`}
        action={
          <Button icon={Plus} onClick={handleOpenForm}>
            <span className="hidden sm:inline">Eintragen</span>
          </Button>
        }
      />

      {/* Filter chips (horizontally scrollable when many types) + management */}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 flex flex-nowrap items-center gap-2 overflow-x-auto no-scrollbar -my-1 py-1">
          <Chip
            color="stone"
            active={!filter}
            className="flex-shrink-0"
            onClick={() => { setFilter(''); setPage(0); setShowChart(false); }}
          >
            Alle
          </Chip>
          {activityTypes.map(t => (
            <Chip
              key={t._id}
              color={chipColorFor(t._id)}
              active={filter === t._id}
              className="flex-shrink-0"
              onClick={() => { setFilter(t._id); setPage(0); }}
            >
              {t.label}
            </Chip>
          ))}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {filteredType && (
            <Button
              variant="ghost"
              size="sm"
              icon={TrendingUp}
              onClick={() => setShowChart(v => !v)}
            >
              <span className="hidden sm:inline">{showChart ? 'Verlauf ausblenden' : 'Verlauf'}</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={SettingsIcon}
            onClick={() => setShowTypesModal(true)}
            title="Aktivitätstypen verwalten"
          >
            <span className="hidden sm:inline">Typen</span>
          </Button>
        </div>
      </div>

      {/* Chart for the filtered type */}
      {showChart && filteredType && (
        <ActivityChart
          typeId={filteredType._id}
          typeLabel={filteredType.label}
          onClose={() => setShowChart(false)}
        />
      )}

      {/* List */}
      {loading ? (
        <PageLoader />
      ) : activities.length === 0 ? (
        <EmptyState
          icon={Dumbbell}
          title="Noch keine Aktivitäten"
          text={activityTypes.length === 0
            ? 'Lege zuerst einen Aktivitätstyp an – z. B. Laufen, Krafttraining oder Yoga – und trage danach deine erste Einheit ein.'
            : 'Halte dein erstes Workout, deinen ersten Lauf oder deine erste Einheit fest.'}
          action={
            <Button icon={Plus} onClick={handleOpenForm}>
              {activityTypes.length === 0 ? 'Ersten Typ erstellen' : 'Erste Aktivität eintragen'}
            </Button>
          }
        />
      ) : (
        <div className="space-y-2.5 anim-list">
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
          <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
            Zurück
          </Button>
          <span className="text-ink-500 text-sm">Seite {page + 1} von {Math.ceil(total / limit)}</span>
          <Button variant="secondary" size="sm" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}>
            Weiter
          </Button>
        </div>
      )}

      {showForm && activityTypes.length > 0 && (
        <ActivityForm
          activityTypes={activityTypes}
          onSave={handleSave}
          onClose={() => setShowForm(false)}
        />
      )}

      {showFirstTypeWizard && (
        <ActivityTypeWizard
          title="Ersten Aktivitätstyp erstellen"
          submitLabel="Erstellen & eintragen"
          initialForm={{ label: '', showDuration: true, showDistance: false, customFields: [] }}
          onSubmit={handleCreateFirstType}
          onClose={() => setShowFirstTypeWizard(false)}
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
