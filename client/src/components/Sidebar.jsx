import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard, Dumbbell, CalendarDays, Sparkles,
  Scale, Target, Settings, LogOut, Activity
} from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/activities', icon: Dumbbell, label: 'Aktivitäten' },
  { to: '/planner', icon: CalendarDays, label: 'Planer' },
  { to: '/habits', icon: Sparkles, label: 'Gewohnheiten' },
  { to: '/weight', icon: Scale, label: 'Gewicht' },
  { to: '/goals', icon: Target, label: 'Ziele' },
  { to: '/settings', icon: Settings, label: 'Einstellungen' },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside className="hidden lg:flex flex-col w-60 bg-slate-900 border-r border-slate-800 min-h-screen fixed left-0 top-0 bottom-0 z-30">
      <div className="p-5 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-600 rounded-xl flex items-center justify-center">
            <Activity size={18} className="text-white" />
          </div>
          <span className="font-semibold text-white">Habit Tracker</span>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {navItems.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-slate-800">
        <div className="flex items-center gap-3 px-3 py-2 mb-1">
          <div className="w-8 h-8 bg-slate-700 rounded-full flex items-center justify-center text-sm font-semibold text-slate-300">
            {user?.name?.charAt(0)?.toUpperCase() || 'N'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-200 truncate">{user?.name}</p>
            <p className="text-xs text-slate-500 truncate">{user?.uuid?.slice(0, 8)}...</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
        >
          <LogOut size={18} />
          Abmelden
        </button>
      </div>
    </aside>
  );
}
