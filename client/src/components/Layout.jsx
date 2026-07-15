import { Outlet, NavLink } from 'react-router-dom';
import Sidebar from './Sidebar';
import UserMenu from './UserMenu';
import Logo from './Logo';
import {
  LayoutDashboard, Dumbbell, CalendarDays, Sparkles, Scale, Target,
} from 'lucide-react';

// All content pages are reachable from the mobile tab bar; Einstellungen and
// the admin area live in the avatar menu of the top bar.
const mobileNav = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Home', end: true },
  { to: '/activities', icon: Dumbbell, label: 'Sport' },
  { to: '/planner', icon: CalendarDays, label: 'Planer' },
  { to: '/habits', icon: Sparkles, label: 'Habits' },
  { to: '/weight', icon: Scale, label: 'Gewicht' },
  { to: '/goals', icon: Target, label: 'Ziele' },
];

export default function Layout({ children }) {
  return (
    <div className="min-h-screen">
      <Sidebar />

      {/* Top bar – mobile only */}
      <header className="lg:hidden sticky top-0 z-40 bg-paper/85 backdrop-blur-xl border-b hairline">
        <div className="flex items-center justify-between px-4 h-14">
          <Logo />
          <UserMenu direction="down" />
        </div>
      </header>

      <main className="lg:pl-64 pb-24 lg:pb-0 min-h-screen">
        <div className="max-w-4xl mx-auto px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          {children ?? <Outlet />}
        </div>
      </main>

      {/* Tab bar – mobile only */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-xl
        border-t hairline pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-stretch">
          {mobileNav.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-1 pt-2.5 pb-2 px-0.5 text-[10px] font-semibold transition-colors ${
                  isActive ? 'text-brand-600' : 'text-ink-300 hover:text-ink-500'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`px-3 py-0.5 rounded-full transition-colors ${isActive ? 'bg-brand-50' : ''}`}>
                    <Icon size={19} />
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
