import { useState, useEffect } from 'react';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { format, parseISO, subMonths, addDays, differenceInCalendarDays } from 'date-fns';
import { de } from 'date-fns/locale';
import { Scale, Plus, Trash2, TrendingDown, TrendingUp, Minus, Target } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine
} from 'recharts';
import {
  PageHeader, Button, Field, Input, Select, IconButton, EmptyState, Stat, useChart,
} from '../components/ui';

export default function Weight() {
  const CHART = useChart();
  const { user, updateUser } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    weight: '',
    unit: 'kg'
  });
  const [saving, setSaving] = useState(false);
  // Weight goal (target value + optional date) lives on the user profile.
  const [goalForm, setGoalForm] = useState({
    weight: user?.weightGoal?.weight ?? '',
    date: user?.weightGoal?.date ? String(user.weightGoal.date).slice(0, 10) : '',
  });
  const [goalSaving, setGoalSaving] = useState(false);

  const handleSaveGoal = async (e) => {
    e.preventDefault();
    setGoalSaving(true);
    try {
      const res = await api.put('/auth/me', {
        weightGoal: goalForm.weight === ''
          ? null
          : { weight: +goalForm.weight, date: goalForm.date || null },
      });
      updateUser(res.data);
    } catch (err) {
      alert('Fehler: ' + (err.response?.data?.error || err.message));
    } finally {
      setGoalSaving(false);
    }
  };

  // Add/delete refresh silently in place — only the mount shows the loader.
  const load = async () => {
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

  // Chronological order is the single source for chart, stats and trend —
  // "Aktuell" is the NEWEST entry, not whatever the API listed first.
  const sorted = [...logs].sort((a, b) => new Date(a.date) - new Date(b.date));
  const chartData = sorted.map(l => ({
    date: format(parseISO(l.date), 'd. MMM', { locale: de }),
    weight: l.weight,
  }));

  const weights = sorted.map(l => l.weight);
  const newest = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  const current = newest ? newest.weight : null;
  const min = weights.length > 0 ? Math.min(...weights) : null;
  const max = weights.length > 0 ? Math.max(...weights) : null;
  const avg = weights.length > 0 ? (weights.reduce((a, b) => a + b, 0) / weights.length).toFixed(1) : null;
  const unit = newest?.unit || 'kg';

  // Positive = gained since the oldest visible entry.
  const trend = sorted.length >= 2 ? current - sorted[0].weight : 0;
  const TrendIcon = trend < -0.2 ? TrendingDown : trend > 0.2 ? TrendingUp : Minus;
  const trendColor = trend < -0.2 ? 'text-emerald-600' : trend > 0.2 ? 'text-red-600' : 'text-ink-400';

  // 14-day projection: a straight dashed line continuing the slope of the
  // newest segment (last two entries). Rendered as its own series that
  // starts exactly at the newest real point.
  let projectionData = chartData;
  if (sorted.length >= 2) {
    const prev = sorted[sorted.length - 2];
    const spanDays = Math.max(1, differenceInCalendarDays(parseISO(newest.date), parseISO(prev.date)));
    const slopePerDay = (newest.weight - prev.weight) / spanDays;
    const projected = Math.round((newest.weight + slopePerDay * 14) * 10) / 10;
    projectionData = [
      ...chartData.slice(0, -1),
      { ...chartData[chartData.length - 1], prognose: newest.weight },
      {
        date: format(addDays(parseISO(newest.date), 14), 'd. MMM', { locale: de }),
        prognose: projected,
      },
    ];
  }

  const goal = user?.weightGoal?.weight ? user.weightGoal : null;
  const goalDelta = goal && current != null ? Math.round((goal.weight - current) * 10) / 10 : null;

  return (
    <div className="space-y-6 anim-list">
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

      {/* Weight goal: target value + optional end date */}
      <div className="card p-5">
        <h2 className="display text-lg mb-4 flex items-center gap-2">
          <Target size={15} className="text-rose-500" /> Zielgewicht
        </h2>
        <form onSubmit={handleSaveGoal} className="flex flex-wrap gap-3">
          <Field label="Zielgewicht" className="flex-1 min-w-24">
            <Input
              type="number"
              value={goalForm.weight}
              onChange={e => setGoalForm(f => ({ ...f, weight: e.target.value }))}
              min="20"
              max="300"
              step="0.1"
              placeholder="z.B. 72"
            />
          </Field>
          <Field label="Bis wann" className="flex-1 min-w-32">
            <Input
              type="date"
              value={goalForm.date}
              onChange={e => setGoalForm(f => ({ ...f, date: e.target.value }))}
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="secondary" loading={goalSaving}>
              {goalForm.weight === '' && user?.weightGoal?.weight ? 'Ziel entfernen' : 'Ziel speichern'}
            </Button>
          </div>
        </form>
        <p className="text-xs text-ink-400 mt-2">
          Das Ziel erscheint als Linie im Verlauf. Feld leeren und speichern entfernt das Ziel.
        </p>
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
              <LineChart data={projectionData}>
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
                  formatter={(v, name) => [`${v} ${unit}`, name === 'prognose' ? 'Prognose' : 'Gewicht']}
                />
                {avg && <ReferenceLine y={+avg} stroke={CHART.lineMuted} strokeDasharray="4 2" />}
                {goal && (
                  <ReferenceLine
                    y={goal.weight}
                    stroke="#e11d48"
                    strokeDasharray="6 3"
                    label={{ value: `Ziel ${goal.weight} ${unit}`, position: 'insideTopRight', fill: '#e11d48', fontSize: 11 }}
                  />
                )}
                <Line type="monotone" dataKey="weight" stroke={CHART.line} strokeWidth={2.5} dot={{ fill: CHART.line, r: 4 }} connectNulls />
                {/* Dashed continuation: how the weight is likely to develop
                    over the next two weeks at the current slope */}
                <Line type="linear" dataKey="prognose" stroke={CHART.lineMuted} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
            {goal && (
              <p className="text-xs text-ink-400 mt-2">
                Zielgewicht: <span className="font-semibold text-ink-600">{goal.weight} {unit}</span>
                {goal.date && <> bis {format(parseISO(String(goal.date)), 'd. MMMM yyyy', { locale: de })}</>}
                {goalDelta != null && (
                  <> · noch <span className="font-semibold text-ink-600">{Math.abs(goalDelta)} {unit}</span> {goalDelta < 0 ? 'abzunehmen' : 'zuzunehmen'}</>
                )}
              </p>
            )}
          </div>

          {/* Entries */}
          <div className="card p-5">
            <h2 className="display text-lg mb-3">Einträge</h2>
            <div className="divide-hairline anim-list">
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
