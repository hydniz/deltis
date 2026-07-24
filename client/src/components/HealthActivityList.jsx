// Read-only list of exercise sessions synced from Android Health Connect.
// Data comes from the companion app; editing happens on the phone, not here.
// Duplicates of Strava activities are hidden server-side (only canonical
// sessions are returned).
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { HeartPulse, Clock, Route, Heart, Mountain, Zap, Footprints } from 'lucide-react';
import api from '../utils/api';
import { Chip, EmptyState, PageLoader } from './ui';
import WeekDivider from './WeekDivider';
import { markWeekStarts } from '../utils/weekGroups';

function formatDuration(seconds) {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

// EXERCISE_TYPE_RUNNING_TREADMILL → "Running Treadmill"
function prettyType(session) {
  const raw = session.sportType || session.exerciseType || '';
  if (!raw.startsWith('EXERCISE_TYPE_')) return raw || 'Aktivität';
  return raw.slice('EXERCISE_TYPE_'.length).toLowerCase().replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function HealthActivityCard({ activity }) {
  const date = activity.startDateLocal || activity.startDate;
  const stats = [
    { icon: Clock, value: formatDuration(activity.movingTime || activity.elapsedTime) },
    { icon: Route, value: activity.distance ? `${(activity.distance / 1000).toFixed(2)} km` : null },
    { icon: Heart, value: activity.averageHeartrate ? `Ø ${Math.round(activity.averageHeartrate)} bpm` : null },
    { icon: Zap, value: activity.averageWatts ? `Ø ${Math.round(activity.averageWatts)} W` : null },
    { icon: Footprints, value: activity.steps ? `${activity.steps.toLocaleString('de-DE')} Schritte` : null },
    { icon: Mountain, value: activity.totalElevationGain ? `${Math.round(activity.totalElevationGain)} hm` : null },
  ].filter(s => s.value);

  return (
    <div className="card p-4 w-full flex items-start gap-3.5 border-l-4 border-l-rose-400">
      <div className="flex-shrink-0 mt-0.5">
        <Chip color="rose">{prettyType(activity)}</Chip>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink-800 truncate">{activity.title || 'Ohne Titel'}</p>
        <p className="text-xs text-ink-400 mt-0.5">
          {date ? format(parseISO(date), 'EEEE, d. MMMM yyyy · HH:mm', { locale: de }) : '–'}
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
          {stats.map(({ icon: Icon, value }, i) => (
            <span key={i} className="text-xs text-ink-500 flex items-center gap-1">
              <Icon size={11} className="flex-shrink-0" />
              {value}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function HealthActivityList({ connected }) {
  const [activities, setActivities] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/health/activities', { params: { limit: 100 } });
      setActivities(res.data);
    } catch {
      setActivities([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (activities === null) return <PageLoader />;

  if (activities.length === 0) {
    return (
      <EmptyState
        icon={HeartPulse}
        tone="rose"
        title="Noch keine Health-Connect-Aktivitäten"
        text={connected
          ? 'Sobald dein Handy eine Trainingseinheit aufzeichnet, erscheint sie hier automatisch.'
          : 'Verbinde die Deltis-Companion-App auf deinem Android-Gerät, um Trainingseinheiten aus Health Connect zu übertragen.'}
        action={!connected && (
          <Link to="/settings/integrations" className="btn-primary">Zu den Einstellungen</Link>
        )}
      />
    );
  }

  return (
    <div className="space-y-2.5 anim-list">
      {markWeekStarts(activities, a => a.startDateLocal || a.startDate).map(({ item: a, newWeek, weekLabel }) => (
        <div key={a._id}>
          {newWeek && <WeekDivider label={weekLabel} />}
          <HealthActivityCard activity={a} />
        </div>
      ))}
    </div>
  );
}
