import { Outlet, NavLink } from 'react-router-dom';
import Sidebar from './Sidebar';
import {
  LayoutDashboard, Dumbbell, Sparkles,
  Scale, Target, Settings
} from 'lucide-react';

const mobileNav = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Home', end: true },
  { to: '/activities', icon: Dumbbell, label: 'Sport' },
  { to: '/habits', icon: Sparkles, label: 'Habits' },
  { to: '/weight', icon: Scale, label: 'Gewicht' },
  { to: '/goals', icon: Target, label: 'Ziele' },
];

export default function Layout({ children }) {
  return (
    <div className="min-h-screen">
      <Sidebar />

      <main className="lg:pl-60 pb-24 lg:pb-0 min-h-screen">
        <div className="max-w-4xl mx-auto p-4 lg:p-8">
          {children ?? <Outlet />}
        </div>
      </main>

      {/* Glass bottom nav – mobile */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white/[.08] backdrop-blur-xl border-t border-white/[.1] z-30 safe-area-inset-bottom">
        <div className="flex items-stretch">
          {mobileNav.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-1 py-3 px-1 text-xs font-medium transition-colors ${
                  isActive ? 'text-brand-300' : 'text-white/30 hover:text-white/55'
                }`
              }
            >
              <Icon size={20} />
              {label}
            </NavLink>
          ))}
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-1 py-3 px-1 text-xs font-medium transition-colors ${
                isActive ? 'text-brand-300' : 'text-white/30 hover:text-white/55'
              }`
            }
          >
            <Settings size={20} />
            Mehr
          </NavLink>
        </div>
      </nav>
    </div>
  );
}
