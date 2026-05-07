import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { format, parseISO, subWeeks, startOfWeek, endOfWeek } from 'date-fns';
import { de } from 'date-fns/locale';
import { Plus, Trash2, Dumbbell, X, TrendingUp } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';

// ─── Aktivitätsformular ─────────────────────────────────────────────────────

function ActivityForm({ activityTypes, onSave, onClose }) {
  const today = new Date().toISOString().slice(0, 10);
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4">
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
                    <span className="flex items-center px-3 bg-slate-700 rounded-xl text-slate-400 text-sm whitespace-nowrap">
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

// ─── Verlauf-Chart ──────────────────────────────────────────────────────────

function ActivityChart({ typeLabel, onClose }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const now = new Date();
      const start = subWeeks(now, 11);
      try {
        const res = await api.get('/activities', {
          params: { type: typeLabel, startDate: start.toISOString(), endDate: now.toISOString(), limit: 500 }
        });
        const weeks = Array.from({ length: 12 }, (_, i) => {
          const ws = startOfWeek(subWeeks(now, 11 - i), { weekStartsOn: 1 });
          const we = endOfWeek(ws, { weekStartsOn: 1 });
          const count = res.data.activities.filter(a => {
            const d = parseISO(a.date);
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
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="kw" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} />
            <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} width={20} />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9' }}
              formatter={(v) => [`${v}x`, typeLabel]}
            />
            <Bar dataKey="Einheiten" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ─── Aktivitätskarte ────────────────────────────────────────────────────────

function ActivityCard({ activity, activityTypes, onDelete }) {
  const typeConfig = activityTypes.find(t => t.label === activity.activityType);

  return (
    <div className="card p-4 flex items-start gap-4 hover:border-slate-700 transition-colors">
      <div className="flex-shrink-0 mt-0.5">
        <span className="badge bg-brand-900/40 text-brand-400 py-1 px-2.5 whitespace-nowrap">
          {activity.activityType}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-200">
          {format(parseISO(activity.date), 'EEEE, d. MMMM yyyy', { locale: de })}
        </p>

        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
          {activity.duration && (
            <span className="text-xs text-slate-400">{activity.duration} min</span>
          )}
          {activity.distance && (
            <span className="text-xs text-slate-400">{activity.distance} km</span>
          )}
          {/* Custom values */}
          {typeConfig?.customFields?.map(field => {
            const val = activity.customValues?.[field.key];
            if (!val && val !== 0) return null;
            return (
              <span key={field.key} className="text-xs text-slate-400">
                {field.label}: <span className="text-slate-300 font-medium">
                  {val}{field.unit ? ` ${field.unit}` : ''}
                </span>
              </span>
            );
          })}
          {/* Fallback for old logs without type config */}
          {!typeConfig && activity.customValues && Object.entries(activity.customValues).map(([k, v]) => (
            <span key={k} className="text-xs text-slate-400">
              {k}: <span className="text-slate-300 font-medium">{v}</span>
            </span>
          ))}
        </div>

        {activity.notes && (
          <p className="text-xs text-slate-500 mt-1 truncate">{activity.notes}</p>
        )}
      </div>

      <button
        onClick={() => onDelete(activity._id)}
        className="flex-shrink-0 text-slate-600 hover:text-red-400 transition-colors mt-0.5"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

// ─── Hauptseite ─────────────────────────────────────────────────────────────

export default function Activities() {
  const [activityTypes, setActivityTypes] = useState([]);
  const [activities, setActivities] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('');
  const [chartType, setChartType] = useState(null);
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
        params: { type: filter || undefined, limit, skip: page * limit }
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

  const toggleChart = (label) => {
    setChartType(prev => prev === label ? null : label);
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

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => { setFilter(''); setPage(0); setChartType(null); }}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            !filter ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          Alle
        </button>
        {activityTypes.map(t => (
          <div key={t._id} className="flex items-center gap-0.5">
            <button
              onClick={() => { setFilter(t.label); setPage(0); }}
              className={`px-3 py-1.5 rounded-l-lg text-sm font-medium transition-colors ${
                filter === t.label ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
            <button
              onClick={() => toggleChart(t.label)}
              title="Verlauf anzeigen"
              className={`p-1.5 rounded-r-lg text-sm transition-colors border-l border-slate-700 ${
                chartType === t.label
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-800 text-slate-500 hover:text-brand-400'
              }`}
            >
              <TrendingUp size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Chart */}
      {chartType && (
        <ActivityChart typeLabel={chartType} onClose={() => setChartType(null)} />
      )}

      {/* List */}
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
            <ActivityCard
              key={a._id}
              activity={a}
              activityTypes={activityTypes}
              onDelete={handleDelete}
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
    </div>
  );
}
