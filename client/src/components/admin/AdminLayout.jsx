import { NavLink, Link, Outlet } from 'react-router-dom';
import UserMenu, { useUpdateAvailable } from '../UserMenu';
import { ArrowLeft, ShieldCheck, Users, SlidersHorizontal, RefreshCw } from 'lucide-react';

// The admin area is a deliberately separate shell (Nextcloud-style):
// dark top bar with a way back to the app, its own sub-navigation and an
// ocher accent so it never blends in with the user-facing pages.

const adminNav = [
  { to: '/admin/users', icon: Users, label: 'Benutzer' },
  { to: '/admin/config', icon: SlidersHorizontal, label: 'System' },
  { to: '/admin/updates', icon: RefreshCw, label: 'Updates' },
];

function RailItem({ to, icon: Icon, label, badge }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3.5 py-2.5 rounded-full text-sm font-medium transition-all ${
          isActive
            ? 'bg-ocher-100 text-ocher-700 font-semibold shadow-[inset_0_0_0_1px_rgba(184,137,42,0.25)]'
            : 'text-ink-500 hover:text-ink-900 hover:bg-ink-900/[.04]'
        }`
      }
    >
      <Icon size={16} />
      <span className="flex-1">{label}</span>
      {badge && (
        <span
          className="w-2 h-2 rounded-full bg-ocher-400 animate-pulse flex-shrink-0"
          title="Update verfügbar"
          data-testid="update-badge"
        />
      )}
    </NavLink>
  );
}

function TabItem({ to, icon: Icon, label, badge }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `relative flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
          isActive
            ? 'bg-white dark:bg-ink-200 text-ink-900 shadow-sm'
            : 'text-white/60 hover:text-white'
        }`
      }
    >
      <Icon size={13} />
      {label}
      {badge && <span className="w-1.5 h-1.5 rounded-full bg-ocher-300 animate-pulse" />}
    </NavLink>
  );
}

export default function AdminLayout({ children }) {
  const updateAvailable = useUpdateAvailable(true);

  return (
    <div className="min-h-screen">
      {/* Dark control bar — visually separates administration from the app */}
      <header className="sticky top-0 z-40 bg-charcoal shadow-md">
        <div className="flex items-center gap-3 px-4 sm:px-6 h-14 max-w-6xl mx-auto">
          <Link
            to="/dashboard"
            className="flex items-center gap-2 text-sm font-medium text-white/50 hover:text-white transition-colors -ml-1 pr-1"
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">Zurück zur App</span>
          </Link>
          <div className="w-px h-5 bg-white/15" />
          <div className="flex items-center gap-2.5">
            <ShieldCheck size={17} className="text-ocher-300" />
            <span className="font-display font-semibold text-white tracking-tight">
              Administration
            </span>
          </div>
          <div className="ml-auto">
            <UserMenu direction="down" />
          </div>
        </div>

        {/* Sub-navigation tabs – mobile & tablet */}
        <div className="lg:hidden px-4 sm:px-6 pb-3 -mt-1 max-w-6xl mx-auto">
          <div className="flex gap-1.5 bg-white/[.08] rounded-full p-1 overflow-x-auto">
            {adminNav.map(item => (
              <TabItem
                key={item.to}
                {...item}
                badge={item.to === '/admin/updates' && updateAvailable}
              />
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto lg:grid lg:grid-cols-[230px_1fr] lg:gap-10 px-4 sm:px-6 py-6 lg:py-10">
        {/* Rail – desktop */}
        <nav className="hidden lg:block space-y-1 self-start sticky top-24">
          <p className="text-[11px] text-ink-400 uppercase tracking-[0.14em] font-semibold px-3.5 mb-3">
            Verwaltung
          </p>
          {adminNav.map(item => (
            <RailItem
              key={item.to}
              {...item}
              badge={item.to === '/admin/updates' && updateAvailable}
            />
          ))}
        </nav>

        <main className="min-w-0">
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  );
}
