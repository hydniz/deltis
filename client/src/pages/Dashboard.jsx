import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import { format, startOfWeek, endOfWeek, isToday, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { Dumbbell, Scale, Target, Calendar, Sparkles, TrendingUp } from 'lucide-react';

const ACTIVITY_LABELS = {
  gym: 'Gym', jogging: 'Joggen', cycling: 'Radfahren', swimming: 'Schwimmen',
  yoga: 'Yoga', hiking: 'Wandern', sports: 'Sport', other: 'Sonstiges'
};

// Erdfarbige Akzente – kein Blau/Violett
const ACCENT = {
  terracotta: 'text-brand-300   bg-brand-500/20',
  sage:       'text-green-300   bg-green-600/20',
  ocher:      'text-amber-300   bg-amber-500/20',
  rose:       'text-rose-300    bg-rose-500/20',
};

function StatCard({ icon: Icon, label, value, sub, accent = 'terracotta', to }) {
  const cls = ACCENT[accent];
  const inner = (
    <div className="card p-5 hover:bg-white/[.1] transition-all">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${cls}`}>
        <Icon size={18} />
      </div>
      <p className="text-xs text-white/40 uppercase tracking-wider font-medium">{label}</p>
      <p className="text-2xl font-semibold text-white mt-1">{value}</p>
      {sub && <p className="text-xs text-white/30 mt-1">{sub}</p>}
    </div>
  );
  return to ? <Link to={to} className="block">{inner}</Link> : inner;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState({ activities: [], weight: null, goals: [] });
  const [loading, setLoading] = useState(true);

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
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend';

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <div className="w-6 h-6 border-2 border-white/20 border-t-brand-400 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <p className="text-xs text-white/40 uppercase tracking-wider font-medium">
          {format(now, 'EEEE, d. MMMM yyyy', { locale: de })}
        </p>
        <h1 className="text-3xl font-bold text-white mt-1">
          {greeting},{' '}
          <span className="bg-gradient-to-r from-brand-300 via-amber-200 to-orange-200 bg-clip-text text-transparent">
            {user?.name?.split(' ')[0]}
          </span>
        </h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={Dumbbell}
          label="Diese Woche"
          value={data.activities.length}
          sub="Aktivitäten"
          accent="terracotta"
          to="/activities"
        />
        <StatCard
          icon={Scale}
          label="Gewicht"
          value={data.weight ? `${data.weight.weight} ${data.weight.unit}` : '–'}
          sub={data.weight ? format(parseISO(data.weight.date), 'd. MMM', { locale: de }) : 'Nicht eingetragen'}
          accent="sage"
          to="/weight"
        />
        <StatCard
          icon={Target}
          label="Ziele"
          value={data.goals.length}
          sub="Aktive Ziele"
          accent="ocher"
          to="/goals"
        />
        <StatCard
          icon={Calendar}
          label="Heute"
          value={todayActivities.length}
          sub="Aktivitäten heute"
          accent="rose"
        />
      </div>

      {/* Content grid */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-white/80 flex items-center gap-2">
              <TrendingUp size={15} className="text-brand-300" />
              Letzte Aktivitäten
            </h2>
            <Link to="/activities" className="text-xs text-brand-300/70 hover:text-brand-300 transition-colors">
              Alle →
            </Link>
          </div>
          {data.activities.length === 0 ? (
            <p className="text-white/30 text-sm py-6 text-center">Keine Aktivitäten diese Woche</p>
          ) : (
            <div className="divide-y divide-white/[.06]">
              {data.activities.slice(0, 5).map(a => (
                <div key={a._id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                  <div>
                    <p className="text-sm text-white/85">
                      {ACTIVITY_LABELS[a.activityType] || a.activityType}
                    </p>
                    <p className="text-xs text-white/35 mt-0.5">
                      {format(parseISO(a.date), 'E, d. MMM', { locale: de })}
                    </p>
                  </div>
                  <div className="text-right">
                    {a.duration && <p className="text-sm text-white/60">{a.duration} min</p>}
                    {a.distance && <p className="text-xs text-white/35">{a.distance} km</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-white/80 flex items-center gap-2">
              <Target size={15} className="text-amber-300" />
              Ziele
            </h2>
            <Link to="/goals" className="text-xs text-brand-300/70 hover:text-brand-300 transition-colors">
              Alle →
            </Link>
          </div>
          {data.goals.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-white/30 text-sm mb-4">Noch keine Ziele definiert</p>
              <Link to="/goals" className="btn-primary text-sm py-1.5 px-4 inline-block">
                Ziel erstellen
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-white/[.06]">
              {data.goals.slice(0, 4).map(g => (
                <div key={g._id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-white/85 truncate">{g.name}</p>
                    <span className={`badge flex-shrink-0 ${
                      g.type.startsWith('weekly')
                        ? 'bg-brand-500/20 text-brand-300'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}>
                      {g.type.startsWith('weekly') ? 'Wöchentlich' : 'Langfristig'}
                    </span>
                  </div>
                  <p className="text-xs text-white/30 mt-0.5">
                    {g.condition === 'min' ? 'Min.' : g.condition === 'max' ? 'Max.' : 'Genau'} {g.targetValue} {g.unitSymbol || ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Schnellzugriff */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-white/80 mb-4">Schnellzugriff</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { to: '/activities', label: 'Aktivität loggen',   icon: Dumbbell, color: 'text-brand-300' },
            { to: '/planner',    label: 'Plan erstellen',     icon: Calendar, color: 'text-amber-300' },
            { to: '/habits',     label: 'Gewohnheit tracken', icon: Sparkles, color: 'text-green-300' },
            { to: '/weight',     label: 'Gewicht eintragen',  icon: Scale,    color: 'text-rose-300' },
          ].map(({ to, label, icon: Icon, color }) => (
            <Link
              key={to}
              to={to}
              className="flex flex-col items-center gap-2 p-4 bg-white/[.05] hover:bg-white/[.1] rounded-xl transition-all text-center border border-white/[.06]"
            >
              <Icon size={20} className={color} />
              <span className="text-xs text-white/60 font-medium leading-tight">{label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
