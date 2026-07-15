import { useState, useEffect } from 'react';
import api from '../utils/api';
import { format, parseISO, subMonths } from 'date-fns';
import { de } from 'date-fns/locale';
import { Scale, Plus, Trash2, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine
} from 'recharts';
import {
  PageHeader, Button, Field, Input, Select, IconButton, EmptyState, Stat, CHART,
} from '../components/ui';

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
  const trendColor = trend < -0.2 ? 'text-emerald-600' : trend > 0.2 ? 'text-red-600' : 'text-ink-400';

  return (
    <div className="space-y-6">
      <PageHeader title="Gewicht" subtitle="Verlauf & Tracking" icon={Scale} tone="rose" />

      {/* Entry form */}
      <div className="card p-5">
        <h2 className="display text-lg mb-4 flex items-center gap-2">
          <Plus size={15} className="text-brand-500" /> Eintragen
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-3">
          <Field label="Datum" className="flex-1 min-w-32">
            <Input
              type="date"
              value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              required
            />
          </Field>
          <Field label="Gewicht" className="flex-1 min-w-24">
            <Input
              type="number"
              value={form.weight}
              onChange={e => setForm(f => ({ ...f, weight: e.target.value }))}
              min="20"
              max="300"
              step="0.1"
              placeholder="75.5"
              required
            />
          </Field>
          <Field label="Einheit" className="w-24">
            <Select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
              <option value="kg">kg</option>
              <option value="lbs">lbs</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" loading={saving} disabled={!form.weight}>
              Speichern
            </Button>
          </div>
        </form>
      </div>

      {logs.length > 0 && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Aktuell', value: current ? `${current} ${unit}` : '–', icon: Scale, tone: 'rose' },
              { label: 'Minimum', value: min ? `${min} ${unit}` : '–', icon: TrendingDown, tone: 'sage' },
              { label: 'Maximum', value: max ? `${max} ${unit}` : '–', icon: TrendingUp, tone: 'clay' },
              { label: 'Durchschnitt', value: avg ? `${avg} ${unit}` : '–', icon: Minus, tone: 'amber' },
            ].map(({ label, value, icon, tone }) => (
              <Stat key={label} icon={icon} label={label} value={value} tone={tone} />
            ))}
          </div>

          {/* Chart */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="display text-lg">Verlauf</h2>
              {trend !== 0 && (
                <div className={`flex items-center gap-1 text-sm font-semibold ${trendColor}`}>
                  <TrendIcon size={16} />
                  {Math.abs(trend).toFixed(1)} {unit}
                </div>
              )}
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                <XAxis dataKey="date" tick={CHART.tickLg} tickLine={false} />
                <YAxis
                  tick={CHART.tickLg}
                  tickLine={false}
                  axisLine={false}
                  domain={['auto', 'auto']}
                  width={40}
                />
                <Tooltip
                  contentStyle={CHART.tooltip}
                  formatter={(v) => [`${v} ${unit}`, 'Gewicht']}
                />
                {avg && <ReferenceLine y={+avg} stroke={CHART.lineMuted} strokeDasharray="4 2" />}
                <Line type="monotone" dataKey="weight" stroke={CHART.line} strokeWidth={2.5} dot={{ fill: CHART.line, r: 4 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Entries */}
          <div className="card p-5">
            <h2 className="display text-lg mb-3">Einträge</h2>
            <div className="divide-hairline">
              {[...logs].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 20).map(l => (
                <div key={l._id} className="flex items-center justify-between py-2.5">
                  <p className="text-sm text-ink-600">{format(parseISO(l.date), 'EEEE, d. MMMM yyyy', { locale: de })}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-ink-900">{l.weight} {l.unit}</p>
                    <IconButton icon={Trash2} label="Löschen" tone="danger" size={14} onClick={() => handleDelete(l._id)} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {!loading && logs.length === 0 && (
        <EmptyState
          icon={Scale}
          tone="rose"
          title="Noch kein Gewicht eingetragen"
          text="Trage dein erstes Gewicht oben ein – die Kurve entsteht von ganz allein."
        />
      )}
    </div>
  );
}
