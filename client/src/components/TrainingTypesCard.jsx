// Settings card: manage the user's training types — named, reusable criteria
// bundles ("Zone 2", …) usable in goals and the weekly planner. Criteria are
// defined per integration; currently Strava is the only one, the layout is
// ready for more (each integration gets its own section in the editor).
import { useState, useEffect, useCallback } from 'react';
import { Dumbbell, Plus, Pencil, Trash2, Activity } from 'lucide-react';
import api from '../utils/api';
import { Button, Field, Input, Modal, Alert, IconButton, TONE_BUBBLE } from './ui';
import StravaCriteriaBuilder, {
  normalizeCriteria, criteriaSummary, emptyGroup,
} from './StravaCriteriaBuilder';

const STRAVA_ORANGE = '#FC4C02';

function TrainingTypeEditor({ type, sportTypes, onSave, onClose }) {
  const [name, setName] = useState(type?.name || '');
  const [description, setDescription] = useState(type?.description || '');
  const [stravaTree, setStravaTree] = useState(type?.criteria?.strava || emptyGroup());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        // Criteria per integration — additional integrations (Garmin, …) get
        // their own key here once they exist.
        criteria: { strava: normalizeCriteria(stravaTree) },
      };
      if (type?._id) {
        await api.put(`/training-types/${type._id}`, payload);
      } else {
        await api.post('/training-types', payload);
      }
      onSave();
    } catch (err) {
      setError(err.response?.data?.error || 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={type ? 'Trainingstyp bearbeiten' : 'Neuer Trainingstyp'}
      subtitle="Wiederverwendbare Kriterien für Ziele und den Wochenplan"
      icon={Dumbbell}
      size="lg"
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>Abbrechen</Button>
          <Button type="submit" form="training-type-form" className="flex-1" loading={saving} disabled={!name.trim()}>
            Speichern
          </Button>
        </>
      }
    >
      <form id="training-type-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="Name">
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="z.B. Zone 2"
            maxLength={60}
            autoFocus
          />
        </Field>
        <Field label="Beschreibung" optional>
          <Input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="z.B. Ruhiges Ausdauertraining"
            maxLength={300}
          />
        </Field>

        {/* Per-integration criteria — one section per connected service */}
        <div>
          <p className="text-xs font-semibold text-ink-700 flex items-center gap-1.5 mb-2">
            <Activity size={13} style={{ color: STRAVA_ORANGE }} />
            Strava-Kriterien
          </p>
          <StravaCriteriaBuilder
            criteria={stravaTree}
            onChange={setStravaTree}
            sportTypes={sportTypes}
          />
        </div>

        {error && <Alert tone="error">{error}</Alert>}
      </form>
    </Modal>
  );
}

export default function TrainingTypesCard() {
  const [types, setTypes] = useState(null); // null = loading
  const [sportTypes, setSportTypes] = useState([]);
  const [editing, setEditing] = useState(null); // null | 'new' | type object
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/training-types');
      setTypes(res.data);
    } catch {
      setTypes([]);
    }
  }, []);

  useEffect(() => {
    load();
    api.get('/strava/sport-types').then(res => setSportTypes(res.data)).catch(() => {});
  }, [load]);

  const handleDelete = async (type) => {
    if (!confirm(`Trainingstyp „${type.name}“ löschen?`)) return;
    setError('');
    try {
      await api.delete(`/training-types/${type._id}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Löschen fehlgeschlagen.');
    }
  };

  return (
    <div className="card p-5" data-testid="training-types-card">
      <h2 className="display text-lg mb-1 flex items-center gap-2.5">
        <span className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${TONE_BUBBLE.olive}`}>
          <Dumbbell size={14} />
        </span>
        Trainingstypen
      </h2>
      <p className="text-xs text-ink-400 mb-4">
        Definiere einmal, was z.&nbsp;B. ein „Zone-2-Training“ ist — und nutze es in
        Zielen und im Wochenplan. Die Kriterien gelten pro Integration (aktuell Strava).
      </p>

      {error && <Alert tone="error" className="mb-3">{error}</Alert>}

      {types === null ? null : types.length === 0 ? (
        <p className="text-sm text-ink-400 mb-4">Noch keine Trainingstypen definiert.</p>
      ) : (
        <div className="space-y-2 mb-4">
          {types.map(type => (
            <div key={type._id} className="panel px-3.5 py-2.5 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink-800">{type.name}</p>
                {type.description && <p className="text-xs text-ink-400 mt-0.5">{type.description}</p>}
                <p className="text-xs text-ink-500 mt-0.5 flex items-center gap-1">
                  <Activity size={10} style={{ color: STRAVA_ORANGE }} className="flex-shrink-0" />
                  {criteriaSummary(type.criteria?.strava)}
                </p>
              </div>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <IconButton icon={Pencil} label="Bearbeiten" tone="brand" size={14} onClick={() => setEditing(type)} />
                <IconButton icon={Trash2} label="Löschen" tone="danger" size={14} onClick={() => handleDelete(type)} />
              </div>
            </div>
          ))}
        </div>
      )}

      <Button icon={Plus} onClick={() => setEditing('new')}>
        Neuer Trainingstyp
      </Button>

      {editing && (
        <TrainingTypeEditor
          type={editing === 'new' ? null : editing}
          sportTypes={sportTypes}
          onSave={() => { setEditing(null); load(); }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
