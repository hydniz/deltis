// Full detail view of one synced Strava activity: all stored metrics, the
// heart-rate zone distribution and the recorded streams (heart rate, speed,
// elevation) as charts — the data is already in Deltis, no Strava call needed.
import { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { Activity, Heart, Clock, Route, Mountain, Flame, Zap, Gauge } from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import api from '../utils/api';
import { Modal, Spinner, Alert, useChart } from './ui';

const STRAVA_ORANGE = '#FC4C02';

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '–';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} h` : `${m}:${String(s).padStart(2, '0')} min`;
}

// Pace (min/km) reads more naturally than km/h for foot sports.
function isFootSport(activity) {
  return /run|walk|hike/i.test(activity?.sportType || activity?.type || '');
}

function formatSpeed(metersPerSecond, foot) {
  if (!metersPerSecond) return '–';
  if (foot) {
    const minPerKm = 1000 / metersPerSecond / 60;
    const min = Math.floor(minPerKm);
    const sec = Math.round((minPerKm - min) * 60);
    return `${min}:${String(sec).padStart(2, '0')} /km`;
  }
  return `${(metersPerSecond * 3.6).toFixed(1)} km/h`;
}

// Downsamples a stream to ≤ maxPoints for smooth rendering; x = minutes.
function buildSeries(streams, key, transform = v => v, maxPoints = 300) {
  const data = streams?.[key]?.data;
  if (!Array.isArray(data) || data.length === 0) return [];
  const time = streams?.time?.data;
  const hasTime = Array.isArray(time) && time.length === data.length;
  const step = Math.max(1, Math.ceil(data.length / maxPoints));

  const points = [];
  for (let i = 0; i < data.length; i += step) {
    if (data[i] == null) continue;
    const minutes = hasTime ? time[i] / 60 : (i / data.length) * 100;
    points.push({ min: Math.round(minutes * 10) / 10, value: transform(data[i]) });
  }
  return points;
}

// One recorded stream as a compact area chart (single series — the heading
// carries the identity, hover carries the exact values).
function StreamChart({ title, unit, data, color, valueFormatter }) {
  const CHART = useChart();
  if (data.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-ink-500 uppercase tracking-[0.09em] mb-1.5">{title}</p>
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
          <XAxis
            dataKey="min"
            type="number"
            domain={['dataMin', 'dataMax']}
            tick={CHART.tick}
            tickLine={false}
            tickFormatter={v => `${Math.round(v)}′`}
          />
          <YAxis tick={CHART.tick} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={CHART.tooltip}
            labelFormatter={v => `Minute ${Math.round(v)}`}
            formatter={value => [valueFormatter ? valueFormatter(value) : `${value} ${unit}`, title]}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={color}
            fillOpacity={0.12}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// Time share per Strava heart-rate zone as labeled horizontal bars.
function ZoneDistribution({ zones }) {
  const hrZones = (Array.isArray(zones) ? zones : []).find(z => z?.type === 'heartrate');
  const buckets = hrZones?.distribution_buckets;
  if (!Array.isArray(buckets) || buckets.length === 0) return null;
  const total = buckets.reduce((sum, b) => sum + (b?.time || 0), 0);
  if (total === 0) return null;

  return (
    <div>
      <p className="text-xs font-semibold text-ink-500 uppercase tracking-[0.09em] mb-2">Zeit in Herzfrequenz-Zonen</p>
      <div className="space-y-1.5">
        {buckets.map((bucket, i) => {
          const pct = ((bucket.time || 0) / total) * 100;
          return (
            <div key={i} className="flex items-center gap-2.5 text-xs">
              <span className="w-8 flex-shrink-0 font-semibold text-ink-500">Z{i + 1}</span>
              <div className="flex-1 h-3 rounded-full bg-paper-100 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(pct, bucket.time ? 1 : 0)}%`, backgroundColor: STRAVA_ORANGE, opacity: 0.35 + (i / buckets.length) * 0.65 }}
                />
              </div>
              <span className="w-24 flex-shrink-0 text-right text-ink-500">
                {formatDuration(bucket.time)} · {Math.round(pct)} %
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-ink-300 mt-1.5">
        Zonen {buckets.map((b, i) => `Z${i + 1}: ${Math.round(b.min)}–${b.max > 0 ? Math.round(b.max) : '∞'}`).join(' · ')} bpm
      </p>
    </div>
  );
}

function StatTile({ icon: Icon, label, value }) {
  if (value == null || value === '–') return null;
  return (
    <div className="panel px-3 py-2.5">
      <p className="text-[11px] text-ink-400 flex items-center gap-1.5 mb-0.5">
        <Icon size={11} />
        {label}
      </p>
      <p className="text-sm font-semibold text-ink-800">{value}</p>
    </div>
  );
}

export default function StravaActivityDetailModal({ activityId, onClose }) {
  const CHART = useChart();
  const [activity, setActivity] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/strava/activities/${activityId}?streams=1`)
      .then(res => setActivity(res.data))
      .catch(err => setError(err.response?.data?.error || 'Aktivität konnte nicht geladen werden.'));
  }, [activityId]);

  const foot = isFootSport(activity);
  const streams = activity?.streams;
  const hrSeries = buildSeries(streams, 'heartrate');
  const speedSeries = buildSeries(streams, 'velocity_smooth', v => Math.round(v * 3.6 * 10) / 10);
  const altitudeSeries = buildSeries(streams, 'altitude', v => Math.round(v));

  const date = activity?.startDateLocal || activity?.startDate;

  return (
    <Modal
      onClose={onClose}
      title={activity?.name || 'Aktivität'}
      subtitle={date ? `${activity.sportType || ''} · ${format(parseISO(date), 'EEEE, d. MMMM yyyy · HH:mm', { locale: de })}` : undefined}
      icon={Activity}
      size="lg"
    >
      {error && <Alert tone="error">{error}</Alert>}

      {!activity && !error && (
        <div className="flex items-center justify-center py-12"><Spinner size="md" /></div>
      )}

      {activity && (
        <div className="space-y-5">
          {/* Key metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <StatTile icon={Route} label="Distanz" value={activity.distance ? `${(activity.distance / 1000).toFixed(2)} km` : null} />
            <StatTile icon={Clock} label="Dauer (in Bewegung)" value={formatDuration(activity.movingTime)} />
            <StatTile icon={Clock} label="Dauer (gesamt)" value={formatDuration(activity.elapsedTime)} />
            <StatTile icon={Gauge} label={foot ? 'Ø Pace' : 'Ø Geschwindigkeit'} value={formatSpeed(activity.averageSpeed, foot)} />
            <StatTile icon={Heart} label="Ø Herzfrequenz" value={activity.averageHeartrate ? `${Math.round(activity.averageHeartrate)} bpm` : null} />
            <StatTile icon={Heart} label="Max. Herzfrequenz" value={activity.maxHeartrate ? `${Math.round(activity.maxHeartrate)} bpm` : null} />
            <StatTile icon={Mountain} label="Höhenmeter" value={activity.totalElevationGain ? `${Math.round(activity.totalElevationGain)} m` : null} />
            <StatTile icon={Flame} label="Kalorien" value={activity.calories ? `${Math.round(activity.calories)} kcal` : null} />
            <StatTile icon={Zap} label="Ø Leistung" value={activity.averageWatts ? `${Math.round(activity.averageWatts)} W` : null} />
            <StatTile icon={Activity} label="Relative Anstrengung" value={activity.sufferScore ?? null} />
          </div>

          {/* Streams */}
          <StreamChart
            title="Herzfrequenz"
            unit="bpm"
            data={hrSeries}
            color={STRAVA_ORANGE}
            valueFormatter={v => `${Math.round(v)} bpm`}
          />
          <StreamChart
            title="Geschwindigkeit"
            unit="km/h"
            data={speedSeries}
            color={CHART.line}
            valueFormatter={v => foot ? formatSpeed(v / 3.6, true) : `${v} km/h`}
          />
          <StreamChart
            title="Höhenprofil"
            unit="m"
            data={altitudeSeries}
            color={CHART.lineMuted}
            valueFormatter={v => `${v} m`}
          />

          {hrSeries.length === 0 && speedSeries.length === 0 && altitudeSeries.length === 0 && (
            <p className="text-xs text-ink-400">Für diese Aktivität wurden keine Verlaufsdaten (Streams) aufgezeichnet.</p>
          )}

          {/* Zones */}
          <ZoneDistribution zones={activity.zones} />

          {activity.detail?.description && (
            <div>
              <p className="text-xs font-semibold text-ink-500 uppercase tracking-[0.09em] mb-1">Beschreibung</p>
              <p className="text-sm text-ink-600 whitespace-pre-wrap">{activity.detail.description}</p>
            </div>
          )}

          <p className="text-[11px] text-ink-300">Powered by Strava</p>
        </div>
      )}
    </Modal>
  );
}
