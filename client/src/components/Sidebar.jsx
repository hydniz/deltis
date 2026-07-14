import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { APP_NAME } from '../config/branding';
import api from '../utils/api';
import {
  LayoutDashboard, Dumbbell, CalendarDays, Sparkles,
  Scale, Target, Settings, LogOut, Activity,
  Users, SlidersHorizontal, RefreshCw, ShieldAlert,
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

const adminNavItems = [
  { to: '/admin/users',   icon: Users,             label: 'Nutzerverwaltung' },
  { to: '/admin/config',  icon: SlidersHorizontal, label: 'Systemkonfiguration' },
  { to: '/admin/updates', icon: RefreshCw,         label: 'Updates (OTA)' },
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

function AdminNavItem({ to, icon: Icon, label, badge }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
          isActive
            ? 'bg-amber-500/15 text-amber-300 border border-amber-500/25'
            : 'text-amber-500/70 hover:text-amber-300 hover:bg-amber-500/10'
        }`
      }
    >
      <Icon size={17} />
      <span className="flex-1">{label}</span>
      {badge && (
        <span
          className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0"
          title="Update verfügbar"
          data-testid="update-badge"
        />
      )}
    </NavLink>
  );
}

// Polls the cached backend update check so admins see an "update available"
// dot on the Updates nav item without opening the page.
function useUpdateAvailable(isAdmin) {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let cancelled = false;
    const fetchCheck = () => {
      api.get('/admin/update/check')
        .then(res => { if (!cancelled) setAvailable(res.data?.updateAvailable === true); })
        .catch(() => { /* badge is best-effort */ });
    };
    fetchCheck();
    const timer = setInterval(fetchCheck, 30 * 60 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [isAdmin]);

  return available;
}

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const updateAvailable = useUpdateAvailable(!!user?.isAdmin);

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
            style={{ background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))', boxShadow: '0 2px 8px var(--logo-shadow)' }}>
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
            {/* Admin section separator */}
            <div className="mx-1 mt-4 mb-2">
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-amber-500/20" />
                <span className="flex items-center gap-1 text-[10px] font-semibold tracking-widest uppercase text-amber-500/60">
                  <ShieldAlert size={10} />
                  Administration
                </span>
                <div className="h-px flex-1 bg-amber-500/20" />
              </div>
            </div>
            {adminNavItems.map(item => (
              <AdminNavItem
                key={item.to}
                {...item}
                badge={item.to === '/admin/updates' && updateAvailable}
              />
            ))}
          </>
        )}
      </nav>

      {/* User + Logout */}
      <div className="px-3 py-4 border-t border-white/[.07]">
        <div className="flex items-center gap-3 px-3 py-2 mb-1">
          <div
            className="w-8 h-8 rounded-full border border-white/15 flex items-center justify-center text-sm font-semibold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--avatar-bg-from), var(--avatar-bg-to))' }}
          >
            {user?.name?.charAt(0)?.toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white/90 truncate">{user?.name}</p>
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
