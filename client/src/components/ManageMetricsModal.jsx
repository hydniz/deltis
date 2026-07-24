// Create, edit and remove metrics. Three ways in: one-tap catalog templates
// (health-backed and manual), a custom-built metric, and inline editing of the
// ones that already exist. Backed by /api/metrics.
import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { Plus, Check, Trash2, Pencil, Sparkles, Cloud } from 'lucide-react';
import { Button, Field, Input, Select, Toggle, Modal, IconButton, Spinner, Alert } from './ui';

const VALUE_TYPES = [
  { value: 'number', label: 'Zahl' },
  { value: 'duration', label: 'Dauer' },
  { value: 'percent', label: 'Prozent' },
  { value: 'scale', label: 'Skala' },
];
const DIRECTIONS = [
  { value: 'none', label: 'Neutral' },
  { value: 'up', label: 'Höher ist besser' },
  { value: 'down', label: 'Niedriger ist besser' },
];

const EMPTY = { name: '', unit: '', valueType: 'number', direction: 'none', min: '', max: '' };

export default function ManageMetricsModal({ onClose, onChanged }) {
  const [metrics, setMetrics] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [showCustom, setShowCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // id being edited
  const [editForm, setEditForm] = useState({ name: '', unit: '' });

  const load = useCallback(async () => {
    try {
      const [m, c] = await Promise.all([api.get('/metrics'), api.get('/metrics/catalog')]);
      setMetrics(m.data);
      setCatalog(c.data);
    } catch {
      setMetrics([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => { await load(); onChanged?.(); };

  const addFromCatalog = async (key) => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/metrics/catalog/${key}`);
      await refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Anlegen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const createCustom = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = {
        name: form.name, unit: form.unit, valueType: form.valueType, direction: form.direction,
        min: form.min === '' ? null : +form.min,
        max: form.max === '' ? null : +form.max,
      };
      await api.post('/metrics', payload);
      setForm(EMPTY);
      setShowCustom(false);
      await refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Anlegen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (m) => { setEditing(m._id); setEditForm({ name: m.name, unit: m.unit || '' }); };

  const saveEdit = async (id) => {
    setBusy(true);
    setError('');
    try {
      await api.put(`/metrics/${id}`, { name: editForm.name, unit: editForm.unit });
      setEditing(null);
      await refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const toggleDashboard = async (m) => {
    await api.put(`/metrics/${m._id}`, { showOnDashboard: !m.showOnDashboard });
    await refresh();
  };

  const remove = async (m) => {
    if (!confirm(`„${m.name}“ entfernen? Die Einträge bleiben erhalten.`)) return;
    await api.delete(`/metrics/${m._id}`);
    await refresh();
  };

  return (
    <Modal onClose={onClose} title="Messwerte verwalten" subtitle="Aus Vorlagen wählen oder eigene anlegen.">
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}

      {/* Existing metrics */}
      <section className="mb-6">
        <h3 className="text-sm font-semibold text-ink-700 mb-2">Deine Messwerte</h3>
        {metrics === null ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : metrics.length === 0 ? (
          <p className="text-sm text-ink-400">Noch keine — füge unten welche hinzu.</p>
        ) : (
          <ul className="space-y-2">
            {metrics.map(m => (
              <li key={m._id} className="panel px-3 py-2.5 flex items-center gap-3" data-testid="managed-metric">
                {editing === m._id ? (
                  <>
                    <Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className="flex-1" aria-label="Name" />
                    <Input value={editForm.unit} onChange={e => setEditForm(f => ({ ...f, unit: e.target.value }))} placeholder="Einheit" className="w-24" aria-label="Einheit" />
                    <Button size="sm" loading={busy} onClick={() => saveEdit(m._id)}>Sichern</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Abbrechen</Button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-ink-800">{m.name}</span>
                      {m.unit && <span className="text-xs text-ink-400"> · {m.unit}</span>}
                      {m.healthType && <Cloud size={12} className="inline ml-1.5 -mt-0.5 text-sage-500" aria-label="Health Connect" />}
                    </span>
                    <label className="flex items-center gap-1.5 text-xs text-ink-500">
                      Dashboard
                      <Toggle value={!!m.showOnDashboard} onChange={() => toggleDashboard(m)} label={`${m.name} auf dem Dashboard`} />
                    </label>
                    <IconButton icon={Pencil} label="Bearbeiten" onClick={() => startEdit(m)} />
                    <IconButton icon={Trash2} label="Entfernen" onClick={() => remove(m)} />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Catalog */}
      <section className="mb-6">
        <h3 className="text-sm font-semibold text-ink-700 mb-2 flex items-center gap-1.5">
          <Sparkles size={14} /> Aus Vorlage
        </h3>
        <div className="flex flex-wrap gap-2">
          {catalog.map(t => (
            <button
              key={t.key}
              type="button"
              disabled={t.added || busy}
              onClick={() => addFromCatalog(t.key)}
              className={`text-sm px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 ${
                t.added
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 cursor-default'
                  : 'border-ink-900/10 hover:border-brand-300 hover:bg-brand-50 text-ink-600'
              }`}
            >
              {t.added ? <Check size={13} /> : <Plus size={13} />}
              {t.name}
              {t.importable && !t.added && <Cloud size={12} className="text-sage-500" aria-label="Health Connect" />}
            </button>
          ))}
        </div>
      </section>

      {/* Custom */}
      <section>
        {!showCustom ? (
          <Button variant="secondary" icon={Plus} onClick={() => setShowCustom(true)}>Eigenen Messwert anlegen</Button>
        ) : (
          <form onSubmit={createCustom} className="panel p-4 space-y-3">
            <Field label="Bezeichnung">
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="z. B. Ruhepuls" autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Einheit">
                <Input value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} placeholder="bpm, %, ml …" />
              </Field>
              <Field label="Werttyp">
                <Select value={form.valueType} onChange={e => setForm(f => ({ ...f, valueType: e.target.value }))}>
                  {VALUE_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Zielrichtung">
              <Select value={form.direction} onChange={e => setForm(f => ({ ...f, direction: e.target.value }))}>
                {DIRECTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Minimum" optional>
                <Input type="number" step="any" value={form.min} onChange={e => setForm(f => ({ ...f, min: e.target.value }))} />
              </Field>
              <Field label="Maximum" optional>
                <Input type="number" step="any" value={form.max} onChange={e => setForm(f => ({ ...f, max: e.target.value }))} />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button type="submit" loading={busy} disabled={!form.name.trim()}>Anlegen</Button>
              <Button type="button" variant="ghost" onClick={() => { setShowCustom(false); setForm(EMPTY); }}>Abbrechen</Button>
            </div>
          </form>
        )}
      </section>
    </Modal>
  );
}
