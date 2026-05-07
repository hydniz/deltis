import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Sidebar from './Sidebar';
import {
  LayoutDashboard, Dumbbell, CalendarDays, Sparkles,
  Scale, Target, Settings
} from 'lucide-react';

const mobileNav = [
  { to: '/', icon: LayoutDashboard, label: 'Home', end: true },
  { to: '/activities', icon: Dumbbell, label: 'Sport' },
  { to: '/habits', icon: Sparkles, label: 'Habits' },
  { to: '/weight', icon: Scale, label: 'Gewicht' },
  { to: '/goals', icon: Target, label: 'Ziele' },
];

export default function Layout() {
  return (
    <div className="min-h-screen bg-slate-950">
      <Sidebar />

      <main className="lg:pl-60 pb-20 lg:pb-0 min-h-screen">
        <div className="max-w-5xl mx-auto p-4 lg:p-8">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom navigation */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 z-30">
        <div className="flex items-stretch">
          {mobileNav.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-1 py-3 px-1 text-xs font-medium transition-colors ${
                  isActive ? 'text-brand-400' : 'text-slate-500'
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
                isActive ? 'text-brand-400' : 'text-slate-500'
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
