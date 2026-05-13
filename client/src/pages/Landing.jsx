import { Link } from 'react-router-dom';
import { APP_NAME, APP_SLOGAN } from '../config/branding';
import {
  Activity, Dumbbell, Sparkles, Scale, Target, CalendarDays
} from 'lucide-react';

const features = [
  { icon: Dumbbell,     label: 'Aktivitäten',    desc: 'Workouts, Läufe und benutzerdefinierte Sportarten mit eigenen Feldern erfassen.',   color: 'text-brand-300  bg-brand-500/15' },
  { icon: Sparkles,     label: 'Gewohnheiten',    desc: 'Tägliche Habits wie Schlaf, Wasser oder Bildschirmzeit im Blick behalten.',          color: 'text-green-300  bg-green-600/15' },
  { icon: CalendarDays, label: 'Wochenplaner',    desc: 'Aktivitäten und Habits für die Woche vorausplanen.',                                 color: 'text-amber-300  bg-amber-500/15' },
  { icon: Scale,        label: 'Gewichtsverlauf', desc: 'Gewichtskurve langfristig tracken und visualisieren.',                               color: 'text-rose-300   bg-rose-500/15'  },
  { icon: Target,       label: 'Ziele',           desc: 'Wochen- und Langzeitziele mit Meilensteinen und Fortschrittsanzeige.',               color: 'text-orange-300 bg-orange-500/15'},
];

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col">

      <header className="flex items-center justify-between px-6 py-5 max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-md shadow-brand-900/40">
            <Activity size={16} className="text-white" />
          </div>
          <span className="font-semibold text-white">{APP_NAME}</span>
        </div>
        <Link to="/login" className="text-sm text-white/50 hover:text-white transition-colors">
          Anmelden →
        </Link>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-24 text-center">
        <p className="text-xs text-white/40 uppercase tracking-widest font-medium mb-6">
          Lifestyle · Tracking · Wellness
        </p>
        <h1 className="text-6xl sm:text-7xl font-bold tracking-tight mb-4 leading-none">
          <span className="bg-gradient-to-r from-brand-300 via-amber-200 to-orange-300 bg-clip-text text-transparent">
            {APP_NAME}
          </span>
        </h1>
        <p className="text-base text-white/50 mb-10 max-w-xs leading-relaxed">
          {APP_SLOGAN}
        </p>
        <Link to="/login" className="btn-primary px-10 py-3 text-base">
          Jetzt starten
        </Link>
      </main>

      <section className="px-6 pb-20 max-w-5xl mx-auto w-full">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map(({ icon: Icon, label, desc, color }) => (
            <div key={label} className="card p-6 hover:bg-white/[.09] transition-all">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${color}`}>
                <Icon size={18} />
              </div>
              <h3 className="font-semibold text-white mb-2">{label}</h3>
              <p className="text-sm text-white/45 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-white/[.07] py-5 text-center text-xs text-white/25">
        {APP_NAME} · {APP_SLOGAN}
      </footer>
    </div>
  );
}
