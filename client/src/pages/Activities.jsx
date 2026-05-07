import { useState, useEffect } from 'react';
import api from '../utils/api';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { Plus, Trash2, Dumbbell, X } from 'lucide-react';

const ACTIVITY_TYPES = [
  { value: 'gym', label: 'Gym' },
  { value: 'jogging', label: 'Joggen' },
  { value: 'cycling', label: 'Radfahren' },
  { value: 'swimming', label: 'Schwimmen' },
  { value: 'yoga', label: 'Yoga' },
  { value: 'hiking', label: 'Wandern' },
  { value: 'sports', label: 'Sport' },
  { value: 'other', label: 'Sonstiges' },
];

const TYPE_COLORS = {
  gym: 'bg-brand-900/40 text-brand-400',
  jogging: 'bg-emerald-900/40 text-emerald-400',
  cycling: 'bg-amber-900/40 text-amber-400',
  swimming: 'bg-sky-900/40 text-sky-400',
  yoga: 'bg-purple-900/40 text-purple-400',
  hiking: 'bg-lime-900/40 text-lime-400',
  sports: 'bg-orange-900/40 text-orange-400',
  other: 'bg-slate-700 text-slate-300',
};

function ActivityForm({ onSave, onClose }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ activityType: 'gym', date: today, duration: '', distance: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/activities', {
        ...form,
        duration: form.duration ? +form.duration : undefined,
        distance: form.distance ? +form.distance : undefined,
      });
      onSave();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white">Aktivität eintragen</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Aktivität</label>
            <select
              className="input"
              value={form.activityType}
              onChange={e => set('activityType', e.target.value)}
            >
              {ACTIVITY_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Datum</label>
            <input type="date" className="input" value={form.date} onChange={e => set('date', e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Dauer (min)</label>
              <input type="number" className="input" value={form.duration} onChange={e => set('duration', e.target.value)} min="1" placeholder="z.B. 60" />
            </div>
            <div>
              <label className="label">Distanz (km)</label>
              <input type="number" className="input" value={form.distance} onChange={e => set('distance', e.target.value)} min="0" step="0.1" placeholder="z.B. 5.5" />
            </div>
          </div>
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

export default function Activities() {
  const [activities, setActivities] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const limit = 20;

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/activities', {
        params: { type: filter || undefined, limit, skip: page * limit }
      });
      setActivities(res.data.activities);
      setTotal(res.data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filter, page]);

  const handleDelete = async (id) => {
    if (!confirm('Aktivität löschen?')) return;
    await api.delete(`/activities/${id}`);
    load();
  };

  const handleSave = () => {
    setShowForm(false);
    setPage(0);
    load();
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

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => { setFilter(''); setPage(0); }}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${!filter ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
        >
          Alle
        </button>
        {ACTIVITY_TYPES.map(t => (
          <button
            key={t.value}
            onClick={() => { setFilter(t.value); setPage(0); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === t.value ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : activities.length === 0 ? (
        <div className="card p-12 text-center">
          <Dumbbell size={36} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">Noch keine Aktivitäten eingetragen</p>
          <button onClick={() => setShowForm(true)} className="btn-primary mt-4 inline-flex items-center gap-2">
            <Plus size={16} /> Erste Aktivität eintragen
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {activities.map(a => (
            <div key={a._id} className="card p-4 flex items-center gap-4 hover:border-slate-700 transition-colors">
              <span className={`badge ${TYPE_COLORS[a.activityType] || TYPE_COLORS.other} py-1 px-2.5`}>
                {ACTIVITY_TYPES.find(t => t.value === a.activityType)?.label || a.activityType}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200">
                  {format(parseISO(a.date), 'EEEE, d. MMMM yyyy', { locale: de })}
                </p>
                {a.notes && <p className="text-xs text-slate-500 truncate mt-0.5">{a.notes}</p>}
              </div>
              <div className="text-right flex-shrink-0">
                {a.duration && <p className="text-sm text-slate-300">{a.duration} min</p>}
                {a.distance && <p className="text-xs text-slate-500">{a.distance} km</p>}
              </div>
              <button onClick={() => handleDelete(a._id)} className="text-slate-600 hover:text-red-400 transition-colors ml-1">
                <Trash2 size={16} />
              </button>
            </div>
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

      {showForm && <ActivityForm onSave={handleSave} onClose={() => setShowForm(false)} />}
    </div>
  );
}
