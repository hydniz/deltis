import { useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import UserMenu from './UserMenu';
import Logo from './Logo';
import {
  LayoutDashboard, Dumbbell, CalendarDays, Sparkles, Scale, Target,
  MoreHorizontal,
} from 'lucide-react';

// Mobile keeps only the daily-use tabs; everything else lives behind "Mehr".
// The desktop sidebar still shows all pages. Einstellungen and the admin
// area stay in the avatar menu of the top bar.
const mobilePrimary = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Home', end: true },
  { to: '/activities', icon: Dumbbell, label: 'Sport' },
  { to: '/planner', icon: CalendarDays, label: 'Planer' },
  { to: '/habits', icon: Sparkles, label: 'Habits' },
];

const mobileMore = [
  { to: '/weight', icon: Scale, label: 'Gewicht' },
  { to: '/goals', icon: Target, label: 'Ziele' },
];

function TabItem({ icon: Icon, label, isActive, ...props }) {
  return (
    <>
      <span className={`px-3 py-0.5 rounded-full transition-colors ${isActive ? 'bg-brand-50' : ''}`}>
        <Icon size={19} />
      </span>
      {label}
    </>
  );
}

// Bottom sheet listing the secondary pages, opened from the "Mehr" tab.
function MoreSheet({ onClose }) {
  return (
    <>
      <div
        className="lg:hidden fixed inset-0 z-40 bg-scrim/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="lg:hidden fixed left-3 right-3 z-50 card rounded-2xl p-1.5 shadow-pop
          bottom-[calc(4.8rem+env(safe-area-inset-bottom))]"
        role="menu"
      >
        {mobileMore.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onClose}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-3 text-sm font-medium rounded-xl transition-colors ${
                isActive ? 'text-brand-700 bg-brand-50' : 'text-ink-700 hover:bg-paper-100'
              }`
            }
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </div>
    </>
  );
}

export default function Layout({ children }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const moreActive = mobileMore.some(item => location.pathname.startsWith(item.to));

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

      {moreOpen && <MoreSheet onClose={() => setMoreOpen(false)} />}

      {/* Tab bar – mobile only */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface/90 backdrop-blur-xl
        border-t hairline pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-stretch">
          {mobilePrimary.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-1 pt-2.5 pb-2 px-0.5 text-[10px] font-semibold transition-colors ${
                  isActive ? 'text-brand-600' : 'text-ink-300 hover:text-ink-500'
                }`
              }
            >
              {({ isActive }) => <TabItem icon={Icon} label={label} isActive={isActive} />}
            </NavLink>
          ))}

          <button
            type="button"
            onClick={() => setMoreOpen(v => !v)}
            aria-expanded={moreOpen}
            className={`flex-1 flex flex-col items-center gap-1 pt-2.5 pb-2 px-0.5 text-[10px] font-semibold transition-colors ${
              moreActive || moreOpen ? 'text-brand-600' : 'text-ink-300 hover:text-ink-500'
            }`}
          >
            <TabItem icon={MoreHorizontal} label="Mehr" isActive={moreActive || moreOpen} />
          </button>
        </div>
      </nav>
    </div>
  );
}
