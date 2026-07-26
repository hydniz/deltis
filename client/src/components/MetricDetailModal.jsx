// Full-size detail view for one metric, opened by tapping a metric card's
// sparkline. Shows a large labelled chart, summary statistics, and lets the
// user overlay a second metric on the same time axis (dual Y-axes) to spot
// correlations — e.g. resting heart rate against sleep duration.
import { useState, useEffect, useMemo } from 'react';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { Modal, Select, Spinner, useChart } from './ui';
import api from '../utils/api';
import { formatValueUnit, formatNumber, isHoursUnit, formatHoursMinutes } from '../utils/metricFormat';

// Distinct colour for the overlaid (second) metric so the two lines never
// read as the same series. The primary line uses the theme's brand colour.
const OVERLAY_LIGHT = '#3b7f8c';
const OVERLAY_DARK = '#5fb3c2';

const RANGES = [
  { value: 30, label: '30 Tage' },
  { value: 90, label: '90 Tage' },
  { value: 365, label: '1 Jahr' },
  { value: 0, label: 'Alles' },
];

// "value unit" as a single string, hour units collapsed to "7 h 30 min".
function labelValue(value, metric) {
  const { text, unit } = formatValueUnit(value, { unit: metric.unit, decimals: metric.decimals });
  return text + (unit ? ` ${unit}` : '');
}

// Descriptive stats over the primary metric's readings in the current range.
function statsFor(logs) {
  if (!logs.length) return null;
  const values = logs.map(l => l.value);
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    count: logs.length,
    min: Math.min(...values),
    max: Math.max(...values),
    avg: sum / values.length,
    first: logs[0].date,
    last: logs[logs.length - 1].date,
  };
}

function StatTile({ label, value }) {
  return (
    <div className="rounded-xl bg-paper-50 border hairline px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.08em] text-ink-400 font-semibold">{label}</div>
      <div className="text-sm font-semibold text-ink-800 tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

export default function MetricDetailModal({ metric, allMetrics = [], onClose }) {
  const CHART = useChart();
  const overlayColor = CHART === undefined ? OVERLAY_LIGHT : (CHART.line === '#e0895a' ? OVERLAY_DARK : OVERLAY_LIGHT);

  const [range, setRange] = useState(90);
  const [overlayId, setOverlayId] = useState('');
  const [logsA, setLogsA] = useState(null);
  const [logsB, setLogsB] = useState([]);
  const [truncated, setTruncated] = useState(false);

  const overlayMetric = allMetrics.find(m => m._id === overlayId) || null;
  const others = allMetrics.filter(m => m._id !== metric._id);

  // One point PER DAY, aggregated server-side. Raw readings would not do: a
  // Health-Connect-backed metric like steps stores hundreds of interval buckets
  // per day, so a raw fetch returned a day or two of buckets rather than a
  // history. Refetched per range so the server only aggregates what is shown.
  useEffect(() => {
    let alive = true;
    api.get(`/metrics/${metric._id}/series`, { params: { days: range } })
      .then(r => { if (!alive) return; setLogsA(r.data.series); setTruncated(!!r.data.truncated); })
      .catch(() => { if (alive) { setLogsA([]); setTruncated(false); } });
    return () => { alive = false; };
  }, [metric._id, range]);

  // Overlay series: (re)fetched whenever the chosen metric changes.
  useEffect(() => {
    if (!overlayId) { setLogsB([]); return; }
    let alive = true;
    api.get(`/metrics/${overlayId}/series`, { params: { days: range } })
      .then(r => { if (alive) setLogsB(r.data.series); })
      .catch(() => { if (alive) setLogsB([]); });
    return () => { alive = false; };
  }, [overlayId, range]);

  const inRange = useMemo(() => {
    const filter = (logs) => {
      const sorted = [...(logs || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
      if (range === 0) return sorted;
      const limit = new Date();
      limit.setDate(limit.getDate() - range);
      return sorted.filter(l => new Date(l.date) >= limit);
    };
    return { a: filter(logsA), b: filter(logsB) };
  }, [logsA, logsB, range]);

  // Merge both series into one day-keyed dataset for a shared time axis.
  const data = useMemo(() => {
    const byDate = new Map();
    const add = (logs, key) => {
      for (const l of logs) {
        const d = l.date.slice(0, 10);
        const rec = byDate.get(d) || { date: d };
        rec[key] = l.value;
        byDate.set(d, rec);
      }
    };
    add(inRange.a, 'a');
    add(inRange.b, 'b');
    return [...byDate.values()].sort((x, y) => x.date.localeCompare(y.date));
  }, [inRange]);

  const stats = statsFor(inRange.a);

  const tickDate = (d) => format(parseISO(d), 'd. MMM', { locale: de });
  const yTick = (metricDef) => (v) => (
    isHoursUnit(metricDef.unit) ? formatHoursMinutes(v) : formatNumber(v, metricDef.decimals ?? 1)
  );

  return (
    <Modal onClose={onClose} title={metric.name} subtitle="Verlauf & Statistik" size="lg">
      <div className="space-y-4">
        {/* Controls: time range + overlay picker */}
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={range} onChange={e => setRange(+e.target.value)} className="!w-auto">
            {RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
          <Select
            value={overlayId}
            onChange={e => setOverlayId(e.target.value)}
            className="!w-auto flex-1 min-w-0"
            aria-label="Zweiten Messwert überlagern"
          >
            <option value="">Überlagern mit … (optional)</option>
            {others.map(m => <option key={m._id} value={m._id}>{m.name}</option>)}
          </Select>
        </div>

        {/* Chart */}
        {logsA === null ? (
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        ) : data.length < 2 ? (
          <p className="text-sm text-ink-400 text-center py-16">
            Noch zu wenige Einträge in diesem Zeitraum für einen Verlauf.
          </p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: overlayMetric ? 12 : 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                <XAxis dataKey="date" tickFormatter={tickDate} tick={CHART.tick} tickLine={false} minTickGap={28} />
                <YAxis
                  yAxisId="a"
                  domain={['auto', 'auto']}
                  tick={CHART.tick}
                  tickLine={false}
                  axisLine={false}
                  width={46}
                  tickFormatter={yTick(metric)}
                  label={{ value: metric.unit || metric.name, angle: -90, position: 'insideLeft', style: { fill: CHART.tick.fill, fontSize: 11, textAnchor: 'middle' } }}
                />
                {overlayMetric && (
                  <YAxis
                    yAxisId="b"
                    orientation="right"
                    domain={['auto', 'auto']}
                    tick={{ ...CHART.tick, fill: overlayColor }}
                    tickLine={false}
                    axisLine={false}
                    width={46}
                    tickFormatter={yTick(overlayMetric)}
                    label={{ value: overlayMetric.unit || overlayMetric.name, angle: 90, position: 'insideRight', style: { fill: overlayColor, fontSize: 11, textAnchor: 'middle' } }}
                  />
                )}
                <Tooltip
                  contentStyle={CHART.tooltip}
                  labelFormatter={d => format(parseISO(d), 'EEEE, d. MMM yyyy', { locale: de })}
                  formatter={(value, name) => {
                    const m = name === metric.name ? metric : overlayMetric;
                    return [labelValue(value, m || metric), name];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  yAxisId="a" type="monotone" dataKey="a" name={metric.name}
                  stroke={CHART.line} strokeWidth={2.5} dot={{ r: 2 }} activeDot={{ r: 4 }}
                  connectNulls isAnimationActive animationDuration={800} animationEasing="ease-out"
                />
                {overlayMetric && (
                  <Line
                    yAxisId="b" type="monotone" dataKey="b" name={overlayMetric.name}
                    stroke={overlayColor} strokeWidth={2} strokeDasharray="5 3" dot={{ r: 2 }} activeDot={{ r: 4 }}
                    connectNulls isAnimationActive animationDuration={800} animationEasing="ease-out"
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Statistics for the primary metric */}
        {stats && (
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatTile label="Aktuell" value={labelValue(inRange.a[inRange.a.length - 1].value, metric)} />
              <StatTile label="Ø" value={labelValue(stats.avg, metric)} />
              <StatTile label="Minimum" value={labelValue(stats.min, metric)} />
              <StatTile label="Maximum" value={labelValue(stats.max, metric)} />
            </div>
            <p className="text-[11px] text-ink-300 mt-2">
              {stats.count} Tage · {tickDate(stats.first)} – {tickDate(stats.last)}
            </p>
            {truncated && (
              <p className="text-[11px] text-amber-600 mt-1">
                Sehr viele Einzelmessungen — ältere Tage fehlen in diesem Zeitraum.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
