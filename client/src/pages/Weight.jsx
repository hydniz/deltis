import { useState, useEffect } from 'react';
import api from '../utils/api';
import { format, parseISO, subMonths } from 'date-fns';
import { de } from 'date-fns/locale';
import { Scale, Plus, Trash2, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine
} from 'recharts';

export default function Weight() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    weight: '',
    unit: 'kg'
  });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const start = subMonths(new Date(), 6);
      const res = await api.get('/weight', { params: { startDate: start.toISOString() } });
      setLogs(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/weight', { ...form, weight: +form.weight });
      setForm(f => ({ ...f, weight: '' }));
      load();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Eintrag löschen?')) return;
    await api.delete(`/weight/${id}`);
    load();
  };

  const chartData = [...logs]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map(l => ({
      date: format(parseISO(l.date), 'd. MMM', { locale: de }),
      weight: l.weight
    }));

  const weights = logs.map(l => l.weight);
  const current = weights.length > 0 ? weights[0] : null;
  const min = weights.length > 0 ? Math.min(...weights) : null;
  const max = weights.length > 0 ? Math.max(...weights) : null;
  const avg = weights.length > 0 ? (weights.reduce((a, b) => a + b, 0) / weights.length).toFixed(1) : null;
  const unit = logs[0]?.unit || 'kg';

  const trend = logs.length >= 2 ? logs[0].weight - logs[logs.length - 1].weight : 0;
  const TrendIcon = trend < -0.2 ? TrendingDown : trend > 0.2 ? TrendingUp : Minus;
  const trendColor = trend < -0.2 ? 'text-emerald-400' : trend > 0.2 ? 'text-red-400' : 'text-slate-400';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Gewicht</h1>
          <p className="text-slate-400 text-sm mt-0.5">Verlauf & Tracking</p>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
          <Plus size={16} className="text-brand-400" /> Eintragen
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-32">
            <label className="label">Datum</label>
            <input type="date" className="input" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required />
          </div>
          <div className="flex-1 min-w-24">
            <label className="label">Gewicht</label>
            <input
              type="number"
              className="input"
              value={form.weight}
              onChange={e => setForm(f => ({ ...f, weight: e.target.value }))}
              min="20"
              max="300"
              step="0.1"
              placeholder="75.5"
              required
            />
          </div>
          <div className="w-24">
            <label className="label">Einheit</label>
            <select className="input" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
              <option value="kg">kg</option>
              <option value="lbs">lbs</option>
            </select>
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={saving || !form.weight} className="btn-primary h-10 px-5">
              {saving ? '...' : 'Speichern'}
            </button>
          </div>
        </form>
      </div>

      {logs.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Aktuell', value: current ? `${current} ${unit}` : '–', icon: Scale },
              { label: 'Minimum', value: min ? `${min} ${unit}` : '–', icon: TrendingDown },
              { label: 'Maximum', value: max ? `${max} ${unit}` : '–', icon: TrendingUp },
              { label: 'Durchschnitt', value: avg ? `${avg} ${unit}` : '–', icon: Minus },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="card p-4">
                <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
                <p className="text-xl font-bold text-white mt-1">{value}</p>
              </div>
            ))}
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-white">Verlauf</h2>
              {trend !== 0 && (
                <div className={`flex items-center gap-1 text-sm font-medium ${trendColor}`}>
                  <TrendIcon size={16} />
                  {Math.abs(trend).toFixed(1)} {unit}
                </div>
              )}
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} />
                <YAxis
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  domain={['auto', 'auto']}
                  width={40}
                />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9' }}
                  formatter={(v) => [`${v} ${unit}`, 'Gewicht']}
                />
                {avg && <ReferenceLine y={+avg} stroke="#334155" strokeDasharray="4 2" />}
                <Line type="monotone" dataKey="weight" stroke="#8b5cf6" strokeWidth={2.5} dot={{ fill: '#8b5cf6', r: 4 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="card p-5">
            <h2 className="font-semibold text-white mb-4">Einträge</h2>
            <div className="space-y-2">
              {[...logs].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 20).map(l => (
                <div key={l._id} className="flex items-center justify-between py-2 border-b border-slate-800 last:border-0">
                  <p className="text-sm text-slate-300">{format(parseISO(l.date), 'EEEE, d. MMMM yyyy', { locale: de })}</p>
                  <div className="flex items-center gap-4">
                    <p className="text-sm font-semibold text-white">{l.weight} {l.unit}</p>
                    <button onClick={() => handleDelete(l._id)} className="text-slate-600 hover:text-red-400 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {!loading && logs.length === 0 && (
        <div className="card p-12 text-center">
          <Scale size={36} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">Noch kein Gewicht eingetragen</p>
          <p className="text-slate-600 text-sm mt-1">Trage dein erstes Gewicht oben ein</p>
        </div>
      )}
    </div>
  );
}
