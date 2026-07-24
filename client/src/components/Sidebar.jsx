import { NavLink } from 'react-router-dom';
import UserMenu from './UserMenu';
import Logo from './Logo';
import {
  LayoutDashboard, Dumbbell, CalendarDays, Sparkles, Scale, Activity, Target,
} from 'lucide-react';

// Main navigation shows content pages only. Einstellungen and the admin
// area live in the user menu (avatar) — Nextcloud-style separation.
const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/activities', icon: Dumbbell, label: 'Aktivitäten' },
  { to: '/planner', icon: CalendarDays, label: 'Planer' },
  { to: '/habits', icon: Sparkles, label: 'Gewohnheiten' },
  { to: '/weight', icon: Scale, label: 'Gewicht' },
  { to: '/metrics', icon: Activity, label: 'Messwerte' },
  { to: '/goals', icon: Target, label: 'Ziele' },
];

function NavItem({ to, icon: Icon, label, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3.5 py-2.5 rounded-full text-sm font-medium transition-all ${
          isActive
            ? 'nav-active font-semibold'
            : 'text-ink-500 hover:text-ink-900 hover:bg-ink-900/[.04]'
        }`
      }
    >
      <Icon size={17} />
      {label}
    </NavLink>
  );
}

export default function Sidebar() {
  return (
    <aside className="hidden lg:flex flex-col w-64 fixed left-0 top-0 bottom-0 z-30
      bg-paper-50/70 backdrop-blur-xl border-r hairline">
      {/* Wordmark */}
      <div className="px-6 pt-7 pb-6">
        <Logo />
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3.5 overflow-y-auto space-y-1">
        {navItems.map(item => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>

      {/* User menu — includes Einstellungen, Administration and Abmelden */}
      <div className="px-3.5 py-4 border-t hairline">
        <UserMenu direction="up" showName />
      </div>
    </aside>
  );
}
