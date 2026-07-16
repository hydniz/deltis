// Read-only list of synced Strava activities with sport-type filter and
// pagination. Data is synced from Strava — editing happens there, not here.
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { Activity, Clock, Route, Heart, Mountain } from 'lucide-react';
import api from '../utils/api';
import { Chip, EmptyState, PageLoader, Button } from './ui';

const STRAVA_ORANGE = '#FC4C02';

function formatDuration(seconds) {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function StravaActivityCard({ activity }) {
  const date = activity.startDateLocal || activity.startDate;
  const stats = [
    { icon: Clock, value: formatDuration(activity.movingTime) },
    { icon: Route, value: activity.distance ? `${(activity.distance / 1000).toFixed(2)} km` : null },
    { icon: Heart, value: activity.averageHeartrate ? `Ø ${Math.round(activity.averageHeartrate)} bpm` : null },
    { icon: Mountain, value: activity.totalElevationGain ? `${Math.round(activity.totalElevationGain)} hm` : null },
  ].filter(s => s.value);

  return (
    <div className="card p-4 flex items-start gap-3.5 border-l-4" style={{ borderLeftColor: STRAVA_ORANGE }}>
      <div className="flex-shrink-0 mt-0.5">
        <Chip color="clay">{activity.sportType || activity.type || 'Aktivität'}</Chip>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink-800 truncate">{activity.name || 'Ohne Titel'}</p>
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

export default function StravaActivityList({ connected }) {
  const [activities, setActivities] = useState([]);
  const [sportTypes, setSportTypes] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const limit = 20;

  useEffect(() => {
    api.get('/strava/sport-types').then(res => setSportTypes(res.data)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/strava/activities', {
        params: { sportType: filter || undefined, limit, skip: page * limit },
      });
      setActivities(res.data.activities);
      setTotal(res.data.total);
    } catch {
      setActivities([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => { load(); }, [load]);

  if (loading && activities.length === 0) return <PageLoader />;

  if (!loading && total === 0 && !filter) {
    return (
      <EmptyState
        icon={Activity}
        tone="clay"
        title="Noch keine Strava-Aktivitäten"
        text={connected
          ? 'Sobald du bei Strava eine Aktivität aufzeichnest, taucht sie hier automatisch auf.'
          : 'Verbinde dein Strava-Konto in den Einstellungen, um Aktivitäten automatisch zu synchronisieren.'}
        action={!connected && (
          <Link to="/settings" className="btn-primary">Zu den Einstellungen</Link>
        )}
      />
    );
  }

  return (
    <div className="space-y-4">
      {sportTypes.length > 0 && (
        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto no-scrollbar -my-1 py-1">
          <Chip
            color="stone"
            active={!filter}
            className="flex-shrink-0"
            onClick={() => { setFilter(''); setPage(0); }}
          >
            Alle
          </Chip>
          {sportTypes.map(type => (
            <Chip
              key={type}
              color="clay"
              active={filter === type}
              className="flex-shrink-0"
              onClick={() => { setFilter(type); setPage(0); }}
            >
              {type}
            </Chip>
          ))}
        </div>
      )}

      {loading ? (
        <PageLoader />
      ) : (
        <div className="space-y-2.5 anim-list">
          {activities.map(a => <StravaActivityCard key={a._id} activity={a} />)}
        </div>
      )}

      {total > limit && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
            Zurück
          </Button>
          <span className="text-ink-500 text-sm">Seite {page + 1} von {Math.ceil(total / limit)}</span>
          <Button variant="secondary" size="sm" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}>
            Weiter
          </Button>
        </div>
      )}

      <p className="text-[11px] text-ink-300">Powered by Strava</p>
    </div>
  );
}
