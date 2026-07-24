// "Messwerte" — the generic measurement page. Lists the user's metrics as
// cards (current value, trend, sparkline, quick add) and hosts the manage
// modal for creating/editing/removing them. Backed by /api/metrics.
import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { Activity, Plus, TrendingUp, TrendingDown, Minus, Settings2 } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, Tooltip } from 'recharts';
import { PageHeader, Button, Input, EmptyState, Spinner, useChart, TONE_BUBBLE } from '../components/ui';
import ManageMetricsModal from '../components/ManageMetricsModal';

// Formats a value to the metric's precision, with thousands grouping.
export function formatValue(value, decimals = 1) {
  if (value == null || !Number.isFinite(value)) return '–';
  return value.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// The trend between the two most recent readings, coloured by the metric's
// direction (for "down is better" a fall is good → emerald).
export function trendFor(logs, direction) {
  if (!Array.isArray(logs) || logs.length < 2) return { icon: 'flat', delta: null, good: null };
  const sorted = [...logs].sort((a, b) => new Date(a.date) - new Date(b.date));
  const delta = sorted[sorted.length - 1].value - sorted[sorted.length - 2].value;
  if (delta === 0) return { icon: 'flat', delta: 0, good: null };
  const rising = delta > 0;
  const good = direction === 'none' ? null : (direction === 'up' ? rising : !rising);
  return { icon: rising ? 'up' : 'down', delta, good };
}

function TrendBadge({ trend, unit }) {
  if (trend.icon === 'flat') return <span className="text-ink-400 text-sm flex items-center gap-1"><Minus size={14} /></span>;
  const Icon = trend.icon === 'up' ? TrendingUp : TrendingDown;
  const color = trend.good == null ? 'text-ink-500' : trend.good ? 'text-emerald-600' : 'text-rose-500';
  return (
    <span className={`text-sm flex items-center gap-1 ${color}`}>
      <Icon size={14} />
      {Math.abs(trend.delta).toLocaleString('de-DE', { maximumFractionDigits: 1 })}{unit ? ` ${unit}` : ''}
    </span>
  );
}

function MetricCard({ metric, onChanged }) {
  const CHART = useChart();
  const [logs, setLogs] = useState(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadLogs = useCallback(async () => {
    try {
      const res = await api.get(`/metrics/${metric._id}/logs`, { params: { limit: 60 } });
      setLogs(res.data);
    } catch {
      setLogs([]);
    }
  }, [metric._id]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const add = async (e) => {
    e.preventDefault();
    if (value === '') return;
    setSaving(true);
    setError('');
    try {
      await api.post(`/metrics/${metric._id}/logs`, { value: +value });
      setValue('');
      await loadLogs();
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const sorted = logs ? [...logs].sort((a, b) => new Date(a.date) - new Date(b.date)) : [];
  const current = sorted.length ? sorted[sorted.length - 1].value : metric.latest?.value ?? null;
  const trend = trendFor(logs || [], metric.direction);
  const spark = sorted.slice(-30).map(l => ({ v: l.value }));

  return (
    <div className="card p-5 flex flex-col gap-3" data-testid="metric-card">
      <div className="flex items-start gap-3">
        <span className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${TONE_BUBBLE[metric.color] || TONE_BUBBLE.rose}`}>
          <Activity size={15} />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-ink-800 truncate">{metric.name}</h3>
          <div className="flex items-baseline gap-2">
            <span className="display text-2xl text-ink-900 tabular-nums">
              {formatValue(current, metric.decimals)}
            </span>
            {metric.unit && <span className="text-sm text-ink-400">{metric.unit}</span>}
          </div>
        </div>
        <TrendBadge trend={trend} unit={metric.unit} />
      </div>

      {spark.length >= 2 && (
        <div className="h-12 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={spark}>
              <Tooltip
                contentStyle={CHART.tooltip}
                formatter={v => [formatValue(v, metric.decimals) + (metric.unit ? ` ${metric.unit}` : ''), metric.name]}
                labelFormatter={() => ''}
              />
              <Line type="monotone" dataKey="v" stroke={CHART.line} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <form onSubmit={add} className="flex gap-2 mt-auto">
        <Input
          type="number" step="any" inputMode="decimal"
          value={value} onChange={e => { setValue(e.target.value); setError(''); }}
          placeholder="Wert eintragen" aria-label={`${metric.name} eintragen`}
          className="flex-1"
        />
        <Button type="submit" icon={Plus} loading={saving} disabled={value === ''}>Eintragen</Button>
      </form>
      {error && <p className="text-xs text-rose-500">{error}</p>}
      {logs && logs.length > 0 && (
        <p className="text-[11px] text-ink-300">
          Zuletzt: {format(parseISO(sorted[sorted.length - 1].date), 'd. MMM yyyy', { locale: de })} · {logs.length} Einträge
        </p>
      )}
    </div>
  );
}

export default function Metrics() {
  const [metrics, setMetrics] = useState(null);
  const [manage, setManage] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/metrics');
      setMetrics(res.data);
    } catch {
      setMetrics([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        icon={Activity}
        title="Messwerte"
        subtitle="Verfolge alles, was sich messen lässt — vom Ruhepuls bis zum Wasser."
        tone="rose"
        action={
          <Button variant="secondary" icon={Settings2} onClick={() => setManage(true)}>
            Verwalten
          </Button>
        }
      />

      {metrics === null ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : metrics.length === 0 ? (
        <EmptyState
          icon={Activity}
          tone="rose"
          title="Noch keine Messwerte"
          text="Lege Messwerte an — aus der Vorlage (Körperfett, Ruhepuls, Schlaf, Blutdruck …) oder ganz eigene. Health Connect füllt sie automatisch."
          action={<Button icon={Plus} onClick={() => setManage(true)}>Messwert anlegen</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {metrics.map(m => (
            <MetricCard key={m._id} metric={m} onChanged={load} />
          ))}
        </div>
      )}

      {manage && (
        <ManageMetricsModal
          onClose={() => setManage(false)}
          onChanged={load}
        />
      )}
    </div>
  );
}

export { MetricCard };
