import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import { Settings, ShieldCheck, LogOut, ChevronsUpDown } from 'lucide-react';

// Polls the cached backend update check so admins see an "update available"
// dot on the Administration entry without opening the admin area.
export function useUpdateAvailable(isAdmin) {
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

export function Avatar({ name, size = 'md' }) {
  const sizeCls = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-9 h-9 text-sm';
  return (
    <div
      className={`${sizeCls} rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0`}
      style={{ background: 'linear-gradient(135deg, var(--brand-400), var(--brand-600))' }}
    >
      {name?.charAt(0)?.toUpperCase() || 'U'}
    </div>
  );
}

function MenuItem({ icon: Icon, children, onClick, tone = 'default', badge = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-xl transition-colors ${
        tone === 'danger'
          ? 'text-red-600 hover:bg-red-50'
          : 'text-ink-700 hover:bg-paper-100'
      }`}
    >
      <Icon size={16} className="flex-shrink-0" />
      <span className="flex-1 text-left">{children}</span>
      {badge && (
        <span
          className="w-2 h-2 rounded-full bg-ocher-400 animate-pulse flex-shrink-0"
          title="Update verfügbar"
          data-testid="update-badge"
        />
      )}
    </button>
  );
}

// Avatar button with popover menu. The admin area is deliberately reached
// only from here (Nextcloud-style) instead of the main navigation.
// `direction`: 'up' (sidebar bottom) | 'down' (mobile top bar).
export default function UserMenu({ direction = 'up', showName = false }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const updateAvailable = useUpdateAvailable(!!user?.isAdmin);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const go = (to) => { setOpen(false); navigate(to); };
  const handleLogout = () => {
    setOpen(false);
    logout();
    navigate('/login');
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label="Benutzermenü"
        aria-expanded={open}
        className={`flex items-center gap-3 rounded-full transition-colors ${
          showName
            ? 'w-full px-2.5 py-2 rounded-2xl hover:bg-paper-100'
            : 'p-0.5 hover:ring-2 hover:ring-brand-200'
        }`}
      >
        <Avatar name={user?.name} size={showName ? 'md' : 'sm'} />
        {showName && (
          <>
            <span className="flex-1 min-w-0 text-left">
              <span className="block text-sm font-semibold text-ink-800 truncate">{user?.name}</span>
              {user?.username && (
                <span className="block text-xs text-ink-400 truncate">@{user.username}</span>
              )}
            </span>
            <ChevronsUpDown size={14} className="text-ink-300 flex-shrink-0" />
          </>
        )}
        {!showName && user?.isAdmin && updateAvailable && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-ocher-400 border-2 border-white" />
        )}
      </button>

      {open && (
        <div
          className={`absolute ${direction === 'up' ? 'bottom-full mb-2 left-0' : 'top-full mt-2 right-0'}
            w-60 bg-white border hairline rounded-2xl shadow-pop p-1.5 z-50`}
          role="menu"
        >
          <div className="px-3.5 pt-2.5 pb-3 border-b hairline mb-1.5">
            <p className="text-sm font-semibold text-ink-900 truncate">{user?.name}</p>
            {user?.username && <p className="text-xs text-ink-400 truncate">@{user.username}</p>}
          </div>

          <MenuItem icon={Settings} onClick={() => go('/settings')}>Einstellungen</MenuItem>

          {user?.isAdmin && (
            <MenuItem icon={ShieldCheck} onClick={() => go('/admin/users')} badge={updateAvailable}>
              Administration
            </MenuItem>
          )}

          <div className="border-t hairline my-1.5" />
          <MenuItem icon={LogOut} tone="danger" onClick={handleLogout}>Abmelden</MenuItem>
        </div>
      )}
    </div>
  );
}
