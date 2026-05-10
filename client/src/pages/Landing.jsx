import { Link } from 'react-router-dom';
import { APP_NAME, APP_SLOGAN } from '../config/branding';
import {
  Activity, Dumbbell, Sparkles, Scale, Target, CalendarDays, ArrowRight
} from 'lucide-react';

const features = [
  { icon: Dumbbell,     label: 'Aktivitäten',    desc: 'Workouts, Läufe und benutzerdefinierte Sportarten mit eigenen Feldern erfassen.' },
  { icon: Sparkles,     label: 'Gewohnheiten',    desc: 'Tägliche Habits wie Schlaf, Wasser oder Bildschirmzeit im Blick behalten.' },
  { icon: CalendarDays, label: 'Wochenplaner',    desc: 'Aktivitäten und Habits für die Woche vorausplanen.' },
  { icon: Scale,        label: 'Gewichtsverlauf', desc: 'Gewichtskurve langfristig tracken und visualisieren.' },
  { icon: Target,       label: 'Ziele',           desc: 'Wochen- und Langzeitziele mit Meilensteinen und Fortschrittsanzeige.' },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800/60 max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-brand-600 rounded-xl flex items-center justify-center">
            <Activity size={16} className="text-white" />
          </div>
          <span className="font-semibold text-white text-lg">{APP_NAME}</span>
        </div>
        <Link
          to="/login"
          className="text-sm font-medium text-slate-400 hover:text-white transition-colors"
        >
          Anmelden →
        </Link>
      </header>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-brand-600 rounded-3xl mb-8 shadow-2xl shadow-brand-600/40">
          <Activity size={36} className="text-white" />
        </div>

        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight mb-4">
          {APP_NAME}
        </h1>
        <p className="text-xl text-slate-400 mb-10 max-w-sm">
          {APP_SLOGAN}
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            to="/login"
            className="btn-primary px-8 py-3 text-base flex items-center gap-2 justify-center"
          >
            Jetzt starten
            <ArrowRight size={18} />
          </Link>
        </div>
      </main>

      {/* ── Features ───────────────────────────────────────────── */}
      <section className="px-6 pb-20 max-w-5xl mx-auto w-full">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map(({ icon: Icon, label, desc }) => (
            <div key={label} className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <div className="w-10 h-10 bg-brand-600/15 rounded-xl flex items-center justify-center mb-4">
                <Icon size={20} className="text-brand-400" />
              </div>
              <h3 className="font-semibold text-white mb-1">{label}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="border-t border-slate-800/60 py-5 text-center text-xs text-slate-600">
        {APP_NAME} · {APP_SLOGAN}
      </footer>
    </div>
  );
}
