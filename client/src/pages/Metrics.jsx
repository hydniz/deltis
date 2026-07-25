// "Messwerte" — the generic measurement page. Lists the user's metrics as
// cards (current value, trend, sparkline, quick add) and hosts the manage
// modal for creating/editing/removing them. Backed by /api/metrics.
import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { de } from 'date-fns/locale';
import { Activity, Plus, TrendingUp, TrendingDown, Minus, Settings2, Maximize2, Clock } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeader, Button, Input, EmptyState, Spinner, HelpTip, useChart, TONE_BUBBLE } from '../components/ui';
import ManageMetricsModal from '../components/ManageMetricsModal';
import MetricDetailModal from '../components/MetricDetailModal';
import MetricSourceHelp from '../components/MetricSourceHelp';
import { formatNumber, formatValueUnit, isHoursUnit, formatHoursMinutes } from '../utils/metricFormat';

// A short, human "from when" label for the shown value, plus whether it is
// stale (not from today). Prominent staleness matters — a metric card shows
// the LATEST reading, which may be days old and easy to misread as current.
function freshnessOf(date) {
  if (!date) return null;
  const daysAgo = differenceInCalendarDays(new Date(), new Date(date));
  const stale = daysAgo >= 1;
  const label = daysAgo <= 0 ? 'heute'
    : daysAgo === 1 ? 'gestern'
    : daysAgo < 7 ? `vor ${daysAgo} Tagen`
    : `vom ${format(new Date(date), 'd. MMM yyyy', { locale: de })}`;
  return { label, stale };
}

// Formats a value to the metric's precision, with thousands grouping.
// (Kept for callers/tests; hour-based values go through metricFormat.)
export function formatValue(value, decimals = 1) {
  return formatNumber(value, decimals);
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
  const delta = isHoursUnit(unit)
    ? formatHoursMinutes(Math.abs(trend.delta))
    : `${Math.abs(trend.delta).toLocaleString('de-DE', { maximumFractionDigits: 1 })}${unit ? ` ${unit}` : ''}`;
  return (
    <span className={`text-sm flex items-center gap-1 flex-shrink-0 ${color}`}>
      <Icon size={14} />
      {delta}
    </span>
  );
}

function MetricCard({ metric, allMetrics = [], onChanged }) {
  const CHART = useChart();
  const [logs, setLogs] = useState(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(false);

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
  const latest = sorted.length ? sorted[sorted.length - 1] : metric.latest ?? null;
  const current = latest?.value ?? null;
  const trend = trendFor(logs || [], metric.direction);
  const spark = sorted.slice(-30).map(l => ({ v: l.value, date: l.date }));
  const fresh = freshnessOf(latest?.date);
  // Zoom the sparkline to the data's own range (with a little padding) instead
  // of anchoring at 0, so small day-to-day fluctuations are actually visible.
  const sparkDomain = (() => {
    if (spark.length < 2) return [0, 1];
    const vals = spark.map(s => s.v);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.05 || 1;
    return [lo - pad, hi + pad];
  })();

  return (
    <div className="card p-5 flex flex-col gap-3 anim-item" data-testid="metric-card">
      <div className="flex items-start gap-3">
        <span className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${TONE_BUBBLE[metric.color] || TONE_BUBBLE.rose}`}>
          <Activity size={15} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 min-w-0">
            <h3 className="font-semibold text-ink-800 truncate">{metric.name}</h3>
            <MetricSourceHelp metric={metric} />
          </div>
          <div className="flex items-baseline gap-2">
            {(() => {
              const { text, unit } = formatValueUnit(current, { unit: metric.unit, decimals: metric.decimals });
              return (<>
                <span className="display text-2xl text-ink-900 tabular-nums">{text}</span>
                {unit && <span className="text-sm text-ink-400">{unit}</span>}
              </>);
            })()}
          </div>
          {/* From WHEN the shown value is — subtle for today, a prominent amber
              pill when the reading is older, so a stale value can't be mistaken
              for a current one. */}
          {fresh && (
            fresh.stale ? (
              <span className="mt-1 inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-ocher-100 text-ocher-700 px-2 py-0.5 text-[11px] font-semibold">
                <Clock size={11} className="flex-shrink-0" /> {fresh.label}
              </span>
            ) : (
              <span className="mt-1 inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-ink-400">
                <Clock size={11} className="flex-shrink-0" /> {fresh.label}
              </span>
            )
          )}
        </div>
        <TrendBadge trend={trend} unit={metric.unit} />
      </div>

      {spark.length >= 2 && (
        <button
          type="button"
          onClick={() => setDetail(true)}
          aria-label={`${metric.name} – Verlauf vergrößern`}
          className="group relative h-16 -mx-1 rounded-lg hover:bg-paper-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          <Maximize2 size={13} className="absolute top-1 right-1.5 text-ink-300 opacity-0 group-hover:opacity-100 transition-opacity z-10" />
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={spark} margin={{ top: 6, right: 6, bottom: 0, left: 6 }}>
              <YAxis hide domain={sparkDomain} />
              <XAxis
                dataKey="date"
                tickFormatter={d => format(parseISO(d), 'd.M.', { locale: de })}
                tick={{ ...CHART.tick, fontSize: 9 }}
                tickLine={false} axisLine={false}
                minTickGap={32} height={14}
                interval="preserveStartEnd"
              />
              <Tooltip
                contentStyle={CHART.tooltip}
                formatter={v => {
                  const { text, unit } = formatValueUnit(v, { unit: metric.unit, decimals: metric.decimals });
                  return [text + (unit ? ` ${unit}` : ''), metric.name];
                }}
                labelFormatter={d => format(parseISO(d), 'd. MMM yyyy', { locale: de })}
              />
              <Line
                type="monotone" dataKey="v" stroke={CHART.line} strokeWidth={2} dot={false}
                isAnimationActive animationDuration={750} animationEasing="ease-out"
              />
            </LineChart>
          </ResponsiveContainer>
        </button>
      )}

      <form onSubmit={add} className="flex gap-2 mt-auto">
        <Input
          type="number" step="any" inputMode="decimal"
          value={value} onChange={e => { setValue(e.target.value); setError(''); }}
          placeholder="Wert eintragen" aria-label={`${metric.name} eintragen`}
          className="flex-1 min-w-0"
        />
        <Button type="submit" icon={Plus} loading={saving} disabled={value === ''} className="flex-shrink-0">Eintragen</Button>
      </form>
      {error && <p className="text-xs text-rose-500">{error}</p>}
      {logs && logs.length > 0 && (
        <p className="text-[11px] text-ink-300">{logs.length} Einträge</p>
      )}

      {detail && (
        <MetricDetailModal metric={metric} allMetrics={allMetrics} onClose={() => setDetail(false)} />
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
    <div className="space-y-6 anim-list">
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 anim-list anim-skip">
          {metrics.map(m => (
            <MetricCard key={m._id} metric={m} allMetrics={metrics} onChanged={load} />
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
