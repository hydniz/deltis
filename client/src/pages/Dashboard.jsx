import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import { format, startOfWeek, endOfWeek, isToday, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { Dumbbell, Scale, Target, ChevronRight, TrendingUp, Calendar, Sparkles } from 'lucide-react';

const ACTIVITY_LABELS = {
  gym: 'Gym', jogging: 'Joggen', cycling: 'Radfahren', swimming: 'Schwimmen',
  yoga: 'Yoga', hiking: 'Wandern', sports: 'Sport', other: 'Sonstiges'
};

function StatCard({ icon: Icon, label, value, sub, color = 'brand', to }) {
  const colorMap = {
    brand: 'text-brand-400 bg-brand-900/30',
    emerald: 'text-emerald-400 bg-emerald-900/30',
    amber: 'text-amber-400 bg-amber-900/30',
    rose: 'text-rose-400 bg-rose-900/30',
  };
  const card = (
    <div className="card p-5 flex items-center gap-4 hover:border-slate-700 transition-colors">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${colorMap[color]}`}>
        <Icon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold text-white mt-0.5">{value}</p>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      </div>
      {to && <ChevronRight size={16} className="text-slate-600" />}
    </div>
  );
  return to ? <Link to={to}>{card}</Link> : card;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState({ activities: [], weight: null, goals: [], habitsToday: [] });
  const [loading, setLoading] = useState(true);

  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

  useEffect(() => {
    async function load() {
      try {
        const [actRes, weightRes, goalRes] = await Promise.all([
          api.get('/activities', {
            params: {
              startDate: weekStart.toISOString(),
              endDate: weekEnd.toISOString(),
              limit: 10
            }
          }),
          api.get('/weight', { params: { limit: 1 } }),
          api.get('/goals'),
        ]);

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

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
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-8">
      <div>
        <p className="text-slate-400 text-sm">{format(now, 'EEEE, d. MMMM yyyy', { locale: de })}</p>
        <h1 className="text-3xl font-bold text-white mt-1">{greeting}, {user?.name?.split(' ')[0]} 👋</h1>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={Dumbbell}
          label="Diese Woche"
          value={`${data.activities.length} Aktivität${data.activities.length !== 1 ? 'en' : ''}`}
          sub="Einheiten trainiert"
          color="brand"
          to="/activities"
        />
        <StatCard
          icon={Scale}
          label="Aktuelles Gewicht"
          value={data.weight ? `${data.weight.weight} ${data.weight.unit}` : '–'}
          sub={data.weight ? format(parseISO(data.weight.date), 'd. MMM', { locale: de }) : 'Noch nicht eingetragen'}
          color="emerald"
          to="/weight"
        />
        <StatCard
          icon={Target}
          label="Aktive Ziele"
          value={data.goals.length}
          sub="Ziele im Blick"
          color="amber"
          to="/goals"
        />
        <StatCard
          icon={Calendar}
          label="Heute"
          value={`${todayActivities.length} Aktivität${todayActivities.length !== 1 ? 'en' : ''}`}
          sub="Heute absolviert"
          color="rose"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Dumbbell size={16} className="text-brand-400" />
              Letzte Aktivitäten
            </h2>
            <Link to="/activities" className="text-xs text-brand-400 hover:text-brand-300">Alle →</Link>
          </div>
          {data.activities.length === 0 ? (
            <p className="text-slate-500 text-sm py-4 text-center">Noch keine Aktivitäten diese Woche</p>
          ) : (
            <div className="space-y-2">
              {data.activities.slice(0, 5).map(a => (
                <div key={a._id} className="flex items-center justify-between py-2 border-b border-slate-800 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-slate-200">
                      {ACTIVITY_LABELS[a.activityType] || a.activityType}
                    </p>
                    <p className="text-xs text-slate-500">
                      {format(parseISO(a.date), 'E, d. MMM', { locale: de })}
                    </p>
                  </div>
                  <div className="text-right">
                    {a.duration && <p className="text-sm text-slate-300">{a.duration} min</p>}
                    {a.distance && <p className="text-xs text-slate-500">{a.distance} km</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Target size={16} className="text-amber-400" />
              Ziele
            </h2>
            <Link to="/goals" className="text-xs text-brand-400 hover:text-brand-300">Alle →</Link>
          </div>
          {data.goals.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-slate-500 text-sm mb-3">Noch keine Ziele definiert</p>
              <Link to="/goals" className="btn-primary text-sm py-1.5 px-4 inline-block">
                Ziel erstellen
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {data.goals.slice(0, 4).map(g => (
                <div key={g._id} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-200 truncate">{g.name}</p>
                    <span className={`badge ml-2 flex-shrink-0 ${
                      g.type.startsWith('weekly') ? 'bg-brand-900/50 text-brand-400' : 'bg-amber-900/50 text-amber-400'
                    }`}>
                      {g.type.startsWith('weekly') ? 'Wöchentlich' : 'Langfristig'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {g.condition === 'min' ? 'Mindestens' : g.condition === 'max' ? 'Maximal' : 'Genau'} {g.targetValue} {g.unitSymbol || ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-white flex items-center gap-2">
            <TrendingUp size={16} className="text-brand-400" />
            Schnellzugriff
          </h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { to: '/activities', label: 'Aktivität loggen', icon: Dumbbell, color: 'text-brand-400' },
            { to: '/planner', label: 'Plan erstellen', icon: Calendar, color: 'text-purple-400' },
            { to: '/habits', label: 'Gewohnheit tracken', icon: Sparkles, color: 'text-emerald-400' },
            { to: '/weight', label: 'Gewicht eintragen', icon: Scale, color: 'text-amber-400' },
          ].map(({ to, label, icon: Icon, color }) => (
            <Link
              key={to}
              to={to}
              className="flex flex-col items-center gap-2 p-4 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors text-center"
            >
              <Icon size={22} className={color} />
              <span className="text-xs text-slate-300 font-medium leading-tight">{label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
