import { Link } from 'react-router-dom';
import { APP_NAME } from '../config/branding';
import Logo from '../components/Logo';
import ThemeToggle from '../components/ThemeToggle';
import Chip from '../components/ui/Chip';
import {
  Dumbbell, Sparkles, Scale, Target, CalendarDays, ArrowRight,
} from 'lucide-react';

const features = [
  { icon: Dumbbell,     label: 'Aktivitäten',     desc: 'Workouts, Läufe und benutzerdefinierte Sportarten mit eigenen Feldern erfassen.', tone: 'bg-brand-50 text-brand-600' },
  { icon: Sparkles,     label: 'Gewohnheiten',    desc: 'Tägliche Habits wie Schlaf, Wasser oder Bildschirmzeit im Blick behalten.',        tone: 'bg-sage-100 text-sage-600' },
  { icon: CalendarDays, label: 'Wochenplaner',    desc: 'Aktivitäten und Habits für die Woche vorausplanen.',                               tone: 'bg-ocher-100 text-ocher-600' },
  { icon: Scale,        label: 'Gewichtsverlauf', desc: 'Gewichtskurve langfristig tracken und visualisieren.',                             tone: 'bg-rose-50 text-rose-600' },
  { icon: Target,       label: 'Ziele',           desc: 'Wochen- und Langzeitziele mit Meilensteinen und Fortschrittsanzeige.',             tone: 'bg-lime-50 text-lime-700' },
];

export default function Landing() {
  return (
    // overflow-hidden sits on the page root, not on sections — the blurred
    // orbs must fade out naturally instead of being clipped mid-page.
    <div className="min-h-screen flex flex-col relative overflow-hidden">

      <header className="relative flex items-center justify-between px-5 sm:px-8 py-5 max-w-6xl mx-auto w-full">
        <Logo />
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <Link
            to="/login"
            className="flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-900 transition-colors"
          >
            Anmelden <ArrowRight size={14} />
          </Link>
        </div>
      </header>

      <main className="relative flex-1 flex flex-col items-center justify-center px-5 py-20 sm:py-28 text-center">
        {/* Blurred colour circles with a bright core behind the hero */}
        <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
          <div className="orb w-[24rem] h-[24rem] sm:w-[38rem] sm:h-[38rem] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white/90 dark:bg-brand-400/[.12]" />
          <div className="orb w-56 h-56 sm:w-80 sm:h-80 left-[6%] top-[6%] bg-brand-200/60" />
          <div className="orb w-56 h-56 sm:w-80 sm:h-80 right-[4%] top-[18%] bg-rose-200/60" />
          <div className="orb w-52 h-52 sm:w-72 sm:h-72 left-[14%] bottom-[2%] bg-ocher-200/70" />
          <div className="orb w-44 h-44 sm:w-64 sm:h-64 right-[14%] bottom-[8%] bg-sage-200/60" />
        </div>

        <div className="relative">
        <p className="text-[11px] text-ink-400 uppercase tracking-[0.22em] font-semibold mb-7">
          Selbst gehostet · Privat · Werbefrei
        </p>

        <h1 className="display text-5xl sm:text-7xl leading-[1.05] mb-8 max-w-3xl">
          Dranbleiben,
          <br />
          <span className="italic font-normal">leicht gemacht.</span>
        </h1>

        <p className="text-base sm:text-lg text-ink-500 max-w-xl leading-relaxed mb-10">
          Alle deine{' '}
          <Chip color="clay" className="align-middle mx-0.5">Aktivitäten</Chip>{' '}
          <Chip color="sage" className="align-middle mx-0.5">Gewohnheiten</Chip>{' '}
          <Chip color="amber" className="align-middle mx-0.5">Ziele</Chip>{' '}
          und{' '}
          <Chip color="rose" className="align-middle mx-0.5">Fortschritte</Chip>{' '}
          an einem einzigen, privaten Ort.
        </p>

        <Link to="/login" className="btn-primary !px-10 !py-3.5 !text-base">
          Jetzt starten
        </Link>
        </div>
      </main>

      <section className="relative px-5 sm:px-8 pb-24 max-w-5xl mx-auto w-full">
        {/* Soft colour accents behind the feature cards */}
        <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
          <div className="orb w-96 h-96 -left-32 top-1/4 bg-ocher-200/50" />
          <div className="orb w-80 h-80 -right-24 top-1/2 bg-rose-200/40" />
          <div className="orb w-72 h-72 left-1/3 -bottom-16 bg-sage-200/45" />
        </div>
        <div className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map(({ icon: Icon, label, desc, tone }) => (
            <div key={label} className="card card-hover p-6">
              <div className={`w-11 h-11 rounded-full flex items-center justify-center mb-4 ${tone}`}>
                <Icon size={18} />
              </div>
              <h3 className="display text-lg mb-1.5">{label}</h3>
              <p className="text-sm text-ink-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="relative border-t hairline py-6 text-center text-xs text-ink-300 bg-paper/60 backdrop-blur-sm">
        {APP_NAME} · Data-driven Habit tracking
      </footer>
    </div>
  );
}
