import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import {
  Settings as SettingsIcon, Copy, Check, LogOut, User, Save,
  Plus, Trash2, Dumbbell, ChevronDown, ChevronUp, X, Pencil
} from 'lucide-react';

// ─── Aktivitätstyp-Editor ────────────────────────────────────────────────────

function CustomFieldEditor({ field, onChange, onRemove }) {
  return (
    <div className="bg-slate-800 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Feld</span>
        <button onClick={onRemove} className="text-slate-600 hover:text-red-400 transition-colors">
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
            <option value="select">Auswahl</option>
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
      {field.type === 'select' && (
        <div>
          <label className="label text-xs">Optionen (kommagetrennt)</label>
          <input
            className="input text-sm py-1.5"
            value={(field.options || []).join(', ')}
            onChange={e => onChange({
              ...field,
              options: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
            })}
            placeholder="z.B. Push, Pull, Legs"
          />
        </div>
      )}
    </div>
  );
}

function ActivityTypeCard({ type, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ ...type });
  const [saving, setSaving] = useState(false);

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addCustomField = () => {
    setForm(f => ({
      ...f,
      customFields: [...(f.customFields || []), { key: '', label: '', type: 'number', unit: '', options: [] }]
    }));
  };

  const updateCustomField = (i, updatedField) => {
    setForm(f => ({
      ...f,
      customFields: f.customFields.map((cf, idx) => idx === i ? updatedField : cf)
    }));
  };

  const removeCustomField = (i) => {
    setForm(f => ({ ...f, customFields: f.customFields.filter((_, idx) => idx !== i) }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/activity-types/${type._id}`, form);
      await onSave();
      setEditing(false);
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setForm({ ...type });
    setEditing(false);
  };

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <Dumbbell size={15} className="text-brand-400 flex-shrink-0" />
        <span className="flex-1 font-medium text-slate-200 text-sm">{type.label}</span>
        <div className="flex items-center gap-1">
          {type.customFields?.length > 0 && (
            <span className="badge bg-slate-700 text-slate-400 text-xs">
              {type.customFields.length} Feld{type.customFields.length !== 1 ? 'er' : ''}
            </span>
          )}
          {type.showDistance && <span className="badge bg-slate-700 text-slate-400 text-xs">Distanz</span>}
          <button
            onClick={() => setEditing(v => !v)}
            className="text-slate-500 hover:text-brand-400 transition-colors ml-1 p-1"
          >
            {editing ? <ChevronUp size={16} /> : <Pencil size={14} />}
          </button>
          <button
            onClick={() => onDelete(type._id)}
            className="text-slate-600 hover:text-red-400 transition-colors p-1"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {editing && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-700 pt-3">
          <div>
            <label className="label text-xs">Name des Aktivitätstyps</label>
            <input className="input text-sm" value={form.label} onChange={e => setField('label', e.target.value)} />
          </div>

          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.showDuration}
                onChange={e => setField('showDuration', e.target.checked)}
                className="w-4 h-4 accent-violet-600"
              />
              <span className="text-sm text-slate-300">Dauer-Feld</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.showDistance}
                onChange={e => setField('showDistance', e.target.checked)}
                className="w-4 h-4 accent-violet-600"
              />
              <span className="text-sm text-slate-300">Distanz-Feld</span>
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label text-xs mb-0">Eigene Felder</label>
              <button
                type="button"
                onClick={addCustomField}
                className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1"
              >
                <Plus size={12} /> Feld hinzufügen
              </button>
            </div>
            <div className="space-y-2">
              {(form.customFields || []).map((field, i) => (
                <CustomFieldEditor
                  key={i}
                  field={field}
                  onChange={updated => updateCustomField(i, updated)}
                  onRemove={() => removeCustomField(i)}
                />
              ))}
              {form.customFields?.length === 0 && (
                <p className="text-xs text-slate-600 py-1">Keine eigenen Felder</p>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={handleCancel} className="btn-secondary flex-1 text-sm py-1.5">Abbrechen</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 text-sm py-1.5">
              {saving ? 'Speichern...' : 'Speichern'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NewActivityTypeForm({ onSave, onClose }) {
  const [form, setForm] = useState({ label: '', showDuration: true, showDistance: false, customFields: [] });
  const [saving, setSaving] = useState(false);
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.label.trim()) return;
    setSaving(true);
    try {
      await api.post('/activity-types', form);
      onSave();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-800/80 border border-brand-700/50 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-white mb-3">Neuer Aktivitätstyp</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="label text-xs">Name</label>
          <input
            className="input text-sm"
            value={form.label}
            onChange={e => setField('label', e.target.value)}
            placeholder="z.B. Joggen 5k, Joggen Longrun, Klettern …"
            autoFocus
            required
          />
        </div>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.showDuration} onChange={e => setField('showDuration', e.target.checked)} className="w-4 h-4 accent-violet-600" />
            <span className="text-sm text-slate-300">Dauer</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.showDistance} onChange={e => setField('showDistance', e.target.checked)} className="w-4 h-4 accent-violet-600" />
            <span className="text-sm text-slate-300">Distanz</span>
          </label>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1 text-sm py-1.5">Abbrechen</button>
          <button type="submit" disabled={saving} className="btn-primary flex-1 text-sm py-1.5">
            {saving ? 'Erstellen...' : 'Erstellen'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Hauptseite ─────────────────────────────────────────────────────────────

export default function Settings() {
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();

  // Profil
  const [name, setName] = useState(user?.name || '');
  const [weightUnit, setWeightUnit] = useState(user?.weightUnit || 'kg');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // Aktivitätstypen
  const [activityTypes, setActivityTypes] = useState([]);
  const [showNewTypeForm, setShowNewTypeForm] = useState(false);

  const loadTypes = async () => {
    const res = await api.get('/activity-types');
    setActivityTypes(res.data);
  };

  useEffect(() => { loadTypes(); }, []);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.put('/auth/me', { name, weightUnit });
      updateUser(res.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      alert('Fehler beim Speichern: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const copyUuid = () => {
    navigator.clipboard.writeText(user?.uuid || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDeleteType = async (id) => {
    if (!confirm('Aktivitätstyp löschen? Bestehende Einträge bleiben erhalten.')) return;
    await api.delete(`/activity-types/${id}`);
    loadTypes();
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold text-white">Einstellungen</h1>
        <p className="text-slate-400 text-sm mt-0.5">Profil & Präferenzen</p>
      </div>

      {/* Profil */}
      <div className="card p-5">
        <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
          <User size={16} className="text-brand-400" />
          Profil
        </h2>
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Dein Name" />
          </div>
          <div>
            <label className="label">Gewichtseinheit</label>
            <select className="input" value={weightUnit} onChange={e => setWeightUnit(e.target.value)}>
              <option value="kg">Kilogramm (kg)</option>
              <option value="lbs">Pfund (lbs)</option>
            </select>
          </div>
          <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
            {saved ? <Check size={16} /> : <Save size={16} />}
            {saved ? 'Gespeichert!' : saving ? 'Speichern...' : 'Speichern'}
          </button>
        </form>
      </div>

      {/* Aktivitätstypen */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-white flex items-center gap-2">
            <Dumbbell size={16} className="text-brand-400" />
            Aktivitätstypen
          </h2>
          <button
            onClick={() => setShowNewTypeForm(v => !v)}
            className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5"
          >
            <Plus size={15} />
            Neu
          </button>
        </div>

        {showNewTypeForm && (
          <div className="mb-3">
            <NewActivityTypeForm
              onSave={() => { setShowNewTypeForm(false); loadTypes(); }}
              onClose={() => setShowNewTypeForm(false)}
            />
          </div>
        )}

        <div className="space-y-2">
          {activityTypes.map(type => (
            <ActivityTypeCard
              key={type._id}
              type={type}
              onSave={loadTypes}
              onDelete={handleDeleteType}
            />
          ))}
          {activityTypes.length === 0 && (
            <p className="text-sm text-slate-500 py-2">Noch keine Aktivitätstypen</p>
          )}
        </div>

        <p className="text-xs text-slate-600 mt-3">
          Tipp: Aktivitätstypen können eigene Felder haben, z.B. „Trainingsplan" (Auswahl) beim Gym oder „Gesamtgewicht" (Zahl in kg).
        </p>
      </div>

      {/* UUID */}
      <div className="card p-5">
        <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
          <SettingsIcon size={16} className="text-brand-400" />
          Zugang
        </h2>
        <div>
          <label className="label">Deine UUID (Zugangscode)</label>
          <div className="flex gap-2">
            <input className="input font-mono text-sm" value={user?.uuid || ''} readOnly />
            <button onClick={copyUuid} className="btn-secondary px-3 flex-shrink-0 flex items-center gap-1.5">
              {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
              {copied ? 'Kopiert' : 'Kopieren'}
            </button>
          </div>
          <p className="text-xs text-slate-600 mt-1.5">
            Bewahre diese UUID sicher auf – sie ist dein einziger Zugangscode.
          </p>
        </div>
      </div>

      {/* Konto */}
      <div className="card p-5">
        <h2 className="font-semibold text-white mb-2">Konto</h2>
        <p className="text-sm text-slate-400 mb-4">
          Mitglied seit {user?.createdAt ? new Date(user.createdAt).toLocaleDateString('de-DE') : '–'}
        </p>
        <button onClick={handleLogout} className="flex items-center gap-2 text-red-400 hover:text-red-300 font-medium text-sm transition-colors">
          <LogOut size={16} />
          Abmelden
        </button>
      </div>
    </div>
  );
}
