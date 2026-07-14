import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Activities from './pages/Activities';
import Planner from './pages/Planner';
import Habits from './pages/Habits';
import Weight from './pages/Weight';
import Goals from './pages/Goals';
import Settings from './pages/Settings';
import AdminUsers from './pages/AdminUsers';
import AdminConfig from './pages/AdminConfig';
import AdminUpdates from './pages/AdminUpdates';
import AdminSetup from './pages/AdminSetup';
import api from './utils/api';
import { User, AlertCircle, Lock, Eye, EyeOff, KeyRound, AlertTriangle } from 'lucide-react';
import { REQUIRED_API_VERSION } from './config/compatibility';


// CompatibilityCheck
// Fetches backend API version on mount, logs the result, and renders a
// persistent warning banner if frontend and backend are incompatible.

function CompatibilityCheck({ children }) {
  const [mismatch, setMismatch] = useState(null); // null | { backendV: number }
  const [emergency, setEmergency] = useState(false);
  const [updateFailed, setUpdateFailed] = useState(false);

  useEffect(() => {
    api.get('').then(res => {
      // Emergency / failed-update flags come first – they matter even in setup mode.
      setEmergency(!!res.data.emergencyMode);
      setUpdateFailed(!!res.data.updateFailed && !res.data.emergencyMode);

      // Skip compatibility check in setup mode – API version is irrelevant then.
      if (res.data.setupMode) return;
      const backendV = res.data.apiVersion ?? 1;
      const compatible = backendV === REQUIRED_API_VERSION;
      if (!compatible) setMismatch({ backendV });
      console.log(
        `[Deltis] Compatibility check — client requires API v${REQUIRED_API_VERSION} | ` +
        `backend reports API v${backendV} | ${compatible ? '✓ compatible' : '✗ INCOMPATIBLE'}`
      );
    }).catch(() => {
      // Backend unreachable — auth flow will handle this, skip compat warning.
      console.warn('[Deltis] Compatibility check skipped — backend unreachable.');
    });
  }, []);

  return (
    <>
      {emergency && (
        <div className="fixed top-0 left-0 right-0 z-[210] flex items-center justify-center gap-2.5 px-4 py-2.5 bg-red-500/20 backdrop-blur-sm border-b border-red-500/40">
          <AlertTriangle size={15} className="text-red-400 flex-shrink-0" />
          <span className="text-red-200 text-sm">
            Notfallbetrieb: Ein Update ist fehlgeschlagen. Als Admin anmelden und unter{' '}
            <a href="/admin/updates" className="underline font-semibold">Admin&nbsp;→&nbsp;Updates</a>{' '}
            den Rollback starten.
          </span>
        </div>
      )}
      {!emergency && updateFailed && (
        <div className="fixed top-0 left-0 right-0 z-[205] flex items-center justify-center gap-2.5 px-4 py-2.5 bg-red-500/15 backdrop-blur-sm border-b border-red-500/30">
          <AlertTriangle size={15} className="text-red-400 flex-shrink-0" />
          <span className="text-red-200 text-sm">
            Das letzte Update ist fehlgeschlagen – die vorherige Version läuft weiter. Details unter{' '}
            <a href="/admin/updates" className="underline font-semibold">Admin&nbsp;→&nbsp;Updates</a>.
          </span>
        </div>
      )}
      {mismatch && (
        <div className="fixed top-0 left-0 right-0 z-[200] flex items-center justify-center gap-2.5 px-4 py-2.5 bg-amber-500/15 backdrop-blur-sm border-b border-amber-500/30">
          <AlertTriangle size={15} className="text-amber-400 flex-shrink-0" />
          <span className="text-amber-200 text-sm">
            Versions-Konflikt: Frontend erwartet API&nbsp;v{REQUIRED_API_VERSION}, Backend meldet API&nbsp;v{mismatch.backendV}. Bitte Frontend oder Backend aktualisieren.
          </span>
        </div>
      )}
      {children}
    </>
  );
}

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-white/20 border-t-brand-400 rounded-full animate-spin" />
    </div>
  );
}

function UsernameSetupModal() {
  const { user, setUsername } = useAuth();
  const [username, setUsernameValue] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!user || user.username) return null;

  // Password required only when user has no credentials yet
  const needsPassword = !user.hasPassword;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmedName = username.trim();
    if (trimmedName.length < 3) {
      setError('Benutzername muss mindestens 3 Zeichen lang sein.');
      return;
    }
    if (needsPassword) {
      if (password.length < 8) {
        setError('Passwort muss mindestens 8 Zeichen lang sein.');
        return;
      }
      if (password !== passwordConfirm) {
        setError('Passwörter stimmen nicht überein.');
        return;
      }
    }
    setLoading(true);
    setError('');
    try {
      await setUsername(trimmedName, needsPassword ? password : null);
    } catch (err) {
      setError(err.response?.data?.error || 'Fehler beim Speichern.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-md flex items-center justify-center p-4">
      <div className="card p-6 w-full max-w-sm space-y-5">
        <div>
          <h2 className="text-white font-semibold text-lg">Zugangsdaten einrichten</h2>
          <p className="text-white/45 text-sm mt-0.5">Einmalige Einrichtung erforderlich</p>
        </div>

        <p className="text-white/45 text-sm">
          Wähle einen Benutzernamen{needsPassword ? ' und ein Passwort' : ''}.
          {' '}Danach ist deine UUID dauerhaft gesperrt.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="label">Benutzername</label>
            <input
              type="text"
              value={username}
              onChange={e => { setUsernameValue(e.target.value); setError(''); }}
              className="input"
              placeholder="Mindestens 3 Zeichen (a–z, 0–9, .-_)"
              autoFocus
              autoComplete="username"
              minLength={3}
              maxLength={30}
            />
          </div>

          {needsPassword && (
            <>
              <div>
                <label className="label">Passwort</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(''); }}
                    className="input pr-10"
                    placeholder="Mindestens 8 Zeichen"
                    autoComplete="new-password"
                    minLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70 transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="label">Passwort bestätigen</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={passwordConfirm}
                  onChange={e => { setPasswordConfirm(e.target.value); setError(''); }}
                  className="input"
                  placeholder="Passwort wiederholen"
                  autoComplete="new-password"
                />
              </div>
            </>
          )}

          {error && (
            <div className="flex items-center gap-2 text-red-300 text-sm bg-red-500/10 border border-red-400/20 rounded-xl px-3 py-2.5">
              <AlertCircle size={14} className="flex-shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={
              loading ||
              username.trim().length < 3 ||
              (needsPassword && (password.length < 8 || password !== passwordConfirm))
            }
            className="btn-primary w-full py-2.5 flex items-center justify-center gap-2"
          >
            {loading && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            Zugangsdaten speichern
          </button>
        </form>
      </div>
    </div>
  );
}

function MustChangePasswordModal() {
  const { user, forceChangePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!user || !user.mustChangePassword) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 8) { setError('Passwort muss mindestens 8 Zeichen lang sein.'); return; }
    if (password !== confirm) { setError('Passwörter stimmen nicht überein.'); return; }
    setLoading(true);
    setError('');
    try {
      await forceChangePassword(password);
    } catch (err) {
      setError(err.response?.data?.error || 'Fehler beim Speichern.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-md flex items-center justify-center p-4">
      <div className="card p-6 w-full max-w-sm space-y-5">
        <div>
          <h2 className="text-white font-semibold text-lg">Passwort ändern</h2>
          <p className="text-white/45 text-sm mt-0.5">Bitte wähle jetzt ein neues Passwort.</p>
        </div>

        <p className="text-white/45 text-sm">
          Wähle ein neues persönliches Passwort (mindestens 8 Zeichen).
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="label">Neues Passwort</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                className="input pr-10"
                placeholder="Mindestens 8 Zeichen"
                autoFocus
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70 transition-colors"
                tabIndex={-1}
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          <div>
            <label className="label">Passwort bestätigen</label>
            <input
              type={showPw ? 'text' : 'password'}
              value={confirm}
              onChange={e => { setConfirm(e.target.value); setError(''); }}
              className="input"
              placeholder="Passwort wiederholen"
              autoComplete="new-password"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-300 text-sm bg-red-500/10 border border-red-400/20 rounded-xl px-3 py-2.5">
              <AlertCircle size={14} className="flex-shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || password.length < 8 || password !== confirm}
            className="btn-primary w-full py-2.5 flex items-center justify-center gap-2"
          >
            {loading && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            Passwort speichern
          </button>
        </form>
      </div>
    </div>
  );
}

// Root route: Landing page for guests, redirect to /dashboard for logged-in users
function RootRoute() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <Landing />;
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  return user ? children : <Navigate to="/login" replace />;
}

// Admin area: handles auth check, setup redirect, and nested sub-routes.
function AdminArea() {
  const { user, loading } = useAuth();
  const [setupNeeded, setSetupNeeded] = useState(null);

  useEffect(() => {
    if (!loading && !user?.isAdmin) {
      api.get('/admin/setup-status')
        .then(res => setSetupNeeded(res.data.setupNeeded))
        .catch(() => setSetupNeeded(false));
    }
  }, [loading, user]);

  if (loading || (!user?.isAdmin && setupNeeded === null)) return <Spinner />;
  if (!user?.isAdmin) {
    if (setupNeeded) return <Navigate to="/admin/setup" replace />;
    return <Navigate to="/login" replace />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="users"   element={<AdminUsers />} />
        <Route path="config"  element={<AdminConfig />} />
        <Route path="updates" element={<AdminUpdates />} />
        <Route path="*"       element={<Navigate to="users" replace />} />
      </Routes>
    </Layout>
  );
}

function AppInner() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <UsernameSetupModal />
        <MustChangePasswordModal />
        <Routes>
          {/* Public routes */}
          <Route path="/"            element={<RootRoute />} />
          <Route path="/login"       element={<Login />} />
          <Route path="/admin/setup" element={<AdminSetup />} />

          {/* Admin sub-routes */}
          <Route path="/admin/*" element={<AdminArea />} />

          {/* Protected app routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="dashboard"  element={<Dashboard />} />
            <Route path="activities" element={<Activities />} />
            <Route path="planner"    element={<Planner />} />
            <Route path="habits"     element={<Habits />} />
            <Route path="weight"     element={<Weight />} />
            <Route path="goals"      element={<Goals />} />
            <Route path="settings"   element={<Settings />} />
          </Route>

          {/* Catch-all: redirect unknown paths to home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <CompatibilityCheck>
      <AppInner />
    </CompatibilityCheck>
  );
}
