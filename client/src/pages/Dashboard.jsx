import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import { format, startOfWeek, endOfWeek, isToday, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { Dumbbell, Scale, Target, Calendar, Sparkles, TrendingUp, ArrowRight } from 'lucide-react';
import { Stat, Chip, PageLoader, Button } from '../components/ui';
import { getSessionGreeting, splitGreeting } from '../utils/greetings';

const ACTIVITY_LABELS = {
  gym: 'Gym', jogging: 'Joggen', cycling: 'Radfahren', swimming: 'Schwimmen',
  yoga: 'Yoga', hiking: 'Wandern', sports: 'Sport', other: 'Sonstiges'
};

function SectionCard({ icon: Icon, title, linkTo, linkLabel = 'Alle', children }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="display text-lg flex items-center gap-2">
          <Icon size={15} className="text-brand-500" />
          {title}
        </h2>
        {linkTo && (
          <Link
            to={linkTo}
            className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors"
          >
            {linkLabel} <ArrowRight size={12} />
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState({ activities: [], weight: null, goals: [] });
  const [loading, setLoading] = useState(true);
  // Stable for the whole browser-tab session; rotates in a new tab,
  // after logout, or when the time of day moves into the next slot.
  const [greeting] = useState(() => splitGreeting(getSessionGreeting(new Date())));

  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

  useEffect(() => {
    async function load() {
      try {
        const [actRes, weightRes, goalRes] = await Promise.all([
          api.get('/activities', {
            params: { startDate: weekStart.toISOString(), endDate: weekEnd.toISOString(), limit: 10 }
          }),
          api.get('/weight', { params: { limit: 1 } }),
          api.get('/goals'),
        ]);
        setData({
          activities: actRes.data.activities || [],
          weight: weightRes.data[0] || null,
          goals: goalRes.data || [],
        });
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const todayActivities = data.activities.filter(a => isToday(parseISO(a.date)));
  const { before, after } = greeting;

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-8">
      {/* Time-aware greeting — phrases rotate daily per time slot */}
      <header>
        <p className="text-[11px] text-ink-400 uppercase tracking-[0.14em] font-semibold mb-1.5">
          {format(now, 'EEEE, d. MMMM yyyy', { locale: de })}
        </p>
        <h1 className="display text-3xl sm:text-[2.5rem] sm:leading-tight">
          {before}
          <span className="italic font-normal text-brand-600">
            {user?.name?.split(' ')[0]}
          </span>
          {after}
        </h1>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          icon={Dumbbell}
          label="Diese Woche"
          value={data.activities.length}
          sub="Aktivitäten"
          tone="clay"
          to="/activities"
        />
        <Stat
          icon={Scale}
          label="Gewicht"
          value={data.weight ? `${data.weight.weight} ${data.weight.unit}` : '–'}
          sub={data.weight ? format(parseISO(data.weight.date), 'd. MMM', { locale: de }) : 'Nicht eingetragen'}
          tone="sage"
          to="/weight"
        />
        <Stat
          icon={Target}
          label="Ziele"
          value={data.goals.length}
          sub="Aktive Ziele"
          tone="amber"
          to="/goals"
        />
        <Stat
          icon={Calendar}
          label="Heute"
          value={todayActivities.length}
          sub="Aktivitäten heute"
          tone="rose"
        />
      </div>

      {/* Content grid */}
      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard icon={TrendingUp} title="Letzte Aktivitäten" linkTo="/activities">
          {data.activities.length === 0 ? (
            <p className="text-ink-400 text-sm py-6 text-center">Keine Aktivitäten diese Woche</p>
          ) : (
            <div className="divide-hairline">
              {data.activities.slice(0, 5).map(a => (
                <div key={a._id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                  <div>
                    <p className="text-sm font-medium text-ink-800">
                      {ACTIVITY_LABELS[a.activityType] || a.activityType}
                    </p>
                    <p className="text-xs text-ink-400 mt-0.5">
                      {format(parseISO(a.date), 'E, d. MMM', { locale: de })}
                    </p>
                  </div>
                  <div className="text-right">
                    {a.duration && <p className="text-sm text-ink-600">{a.duration} min</p>}
                    {a.distance && <p className="text-xs text-ink-400">{a.distance} km</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard icon={Target} title="Ziele" linkTo="/goals">
          {data.goals.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-ink-400 text-sm mb-4">Noch keine Ziele definiert</p>
              <Link to="/goals">
                <Button size="sm">Ziel erstellen</Button>
              </Link>
            </div>
          ) : (
            <div className="divide-hairline">
              {data.goals.slice(0, 4).map(g => (
                <div key={g._id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-ink-800 truncate">{g.name}</p>
                    <Chip variant="soft" color={g.type.startsWith('long-term') ? 'amber' : 'olive'} className="flex-shrink-0">
                      {g.type.startsWith('long-term') ? 'Langfristig' : 'Periodisch'}
                    </Chip>
                  </div>
                  <p className="text-xs text-ink-400 mt-0.5">
                    {g.condition === 'min' ? 'Min.' : g.condition === 'max' ? 'Max.' : 'Genau'} {g.targetValue} {g.unitSymbol || ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Quick access */}
      <div className="card p-5">
        <h2 className="display text-lg mb-4">Schnellzugriff</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {[
            { to: '/activities', label: 'Aktivität loggen',   icon: Dumbbell, tone: 'bg-brand-50 text-brand-600' },
            { to: '/planner',    label: 'Woche planen',       icon: Calendar, tone: 'bg-ocher-100 text-ocher-600' },
            { to: '/habits',     label: 'Gewohnheit tracken', icon: Sparkles, tone: 'bg-sage-100 text-sage-600' },
            { to: '/weight',     label: 'Gewicht eintragen',  icon: Scale,    tone: 'bg-rose-50 text-rose-600' },
          ].map(({ to, label, icon: Icon, tone }) => (
            <Link
              key={to}
              to={to}
              className="panel card-hover flex flex-col items-center gap-2.5 p-4 text-center"
            >
              <span className={`w-9 h-9 rounded-full flex items-center justify-center ${tone}`}>
                <Icon size={16} />
              </span>
              <span className="text-xs text-ink-600 font-medium leading-tight">{label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
