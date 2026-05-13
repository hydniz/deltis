import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { APP_NAME } from '../config/branding';
import {
  LayoutDashboard, Dumbbell, CalendarDays, Sparkles,
  Scale, Target, Settings, LogOut, Activity, ShieldCheck
} from 'lucide-react';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/activities', icon: Dumbbell, label: 'Aktivitäten' },
  { to: '/planner', icon: CalendarDays, label: 'Planer' },
  { to: '/habits', icon: Sparkles, label: 'Gewohnheiten' },
  { to: '/weight', icon: Scale, label: 'Gewicht' },
  { to: '/goals', icon: Target, label: 'Ziele' },
  { to: '/settings', icon: Settings, label: 'Einstellungen' },
];

function NavItem({ to, icon: Icon, label, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
          isActive
            ? 'nav-active'
            : 'text-white/50 hover:text-white/80 hover:bg-white/[.06]'
        }`
      }
    >
      <Icon size={17} />
      {label}
    </NavLink>
  );
}

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside className="hidden lg:flex flex-col w-60 bg-white/[.04] backdrop-blur-xl border-r border-white/[.07] min-h-screen fixed left-0 top-0 bottom-0 z-30">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/[.07]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #c4623a, #8a3c1e)', boxShadow: '0 2px 8px rgba(60,22,10,0.4)' }}>
            <Activity size={16} className="text-white" />
          </div>
          <span className="font-semibold text-white tracking-tight">{APP_NAME}</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-0.5">
        {navItems.map(item => (
          <NavItem key={item.to} {...item} />
        ))}

        {user?.isAdmin && (
          <>
            <div className="mx-2 my-2 border-t border-white/[.07]" />
            <NavItem to="/admin" icon={ShieldCheck} label="Nutzerverwaltung" />
          </>
        )}
      </nav>

      {/* User + Logout */}
      <div className="px-3 py-4 border-t border-white/[.07]">
        <div className="flex items-center gap-3 px-3 py-2 mb-1">
          <div
            className="w-8 h-8 rounded-full border border-white/15 flex items-center justify-center text-sm font-semibold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, rgba(196,98,58,0.6), rgba(138,60,30,0.6))' }}
          >
            {user?.name?.charAt(0)?.toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white/90 truncate">{user?.name}</p>
            <p className="text-xs text-white/35 truncate">{user?.uuid?.slice(0, 8)}...</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-sm font-medium text-white/40 hover:text-red-300 hover:bg-red-500/10 transition-colors"
        >
          <LogOut size={16} />
          Abmelden
        </button>
      </div>
    </aside>
  );
}
