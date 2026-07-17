import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import Layout from './components/Layout';
import Onboarding from './components/Onboarding';
import AdminLayout from './components/admin/AdminLayout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Activities from './pages/Activities';
import Planner from './pages/Planner';
import Habits from './pages/Habits';
import Weight from './pages/Weight';
import Goals from './pages/Goals';
import Settings from './pages/Settings';
import AdminUsers from './pages/AdminUsers';
import AdminConfig from './pages/AdminConfig';
import AdminIntegrations from './pages/AdminIntegrations';
import AdminUpdates from './pages/AdminUpdates';
import Init from './pages/Init';
import api from './utils/api';
import { AlertTriangle } from 'lucide-react';
import { REQUIRED_API_VERSION } from './config/compatibility';
import { Button, Field, Input, PasswordInput, Alert, Spinner } from './components/ui';


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
        <div className="fixed top-0 left-0 right-0 z-[210] flex items-center justify-center gap-2.5 px-4 py-2.5 bg-red-600 shadow-md">
          <AlertTriangle size={15} className="text-white flex-shrink-0" />
          <span className="text-white text-sm">
            Notfallbetrieb: Ein Update ist fehlgeschlagen. Als Admin anmelden und unter{' '}
            <a href="/admin/updates" className="underline font-semibold">Administration&nbsp;→&nbsp;Updates</a>{' '}
            den Rollback starten.
          </span>
        </div>
      )}
      {!emergency && updateFailed && (
        <div className="fixed top-0 left-0 right-0 z-[205] flex items-center justify-center gap-2.5 px-4 py-2.5 bg-red-50 border-b border-red-200">
          <AlertTriangle size={15} className="text-red-500 flex-shrink-0" />
          <span className="text-red-800 text-sm">
            Das letzte Update ist fehlgeschlagen – die vorherige Version läuft weiter. Details unter{' '}
            <a href="/admin/updates" className="underline font-semibold">Administration&nbsp;→&nbsp;Updates</a>.
          </span>
        </div>
      )}
      {mismatch && (
        <div className="fixed top-0 left-0 right-0 z-[200] flex items-center justify-center gap-2.5 px-4 py-2.5 bg-amber-50 border-b border-amber-200">
          <AlertTriangle size={15} className="text-amber-500 flex-shrink-0" />
          <span className="text-amber-900 text-sm">
            Versions-Konflikt: Frontend erwartet API&nbsp;v{REQUIRED_API_VERSION}, Backend meldet API&nbsp;v{mismatch.backendV}. Bitte Frontend oder Backend aktualisieren.
          </span>
        </div>
      )}
      {children}
    </>
  );
}

function CenteredSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Spinner size="md" />
    </div>
  );
}

function UsernameSetupModal() {
  const { user, setUsername } = useAuth();
  const [username, setUsernameValue] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
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
    <div className="fixed inset-0 z-50 bg-scrim/40 dark:bg-scrim/60 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="card shadow-pop rounded-3xl p-6 sm:p-7 w-full max-w-sm space-y-5">
        <div>
          <h2 className="display text-xl">Zugangsdaten einrichten</h2>
          <p className="text-ink-400 text-sm mt-1">Einmalige Einrichtung erforderlich</p>
        </div>

        <p className="text-ink-500 text-sm leading-relaxed">
          Wähle einen Benutzernamen{needsPassword ? ' und ein Passwort' : ''}.
          {' '}Danach ist deine UUID dauerhaft gesperrt.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Benutzername">
            <Input
              type="text"
              value={username}
              onChange={e => { setUsernameValue(e.target.value); setError(''); }}
              placeholder="Mindestens 3 Zeichen (a–z, 0–9, .-_)"
              autoFocus
              autoComplete="username"
              minLength={3}
              maxLength={30}
            />
          </Field>

          {needsPassword && (
            <>
              <Field label="Passwort">
                <PasswordInput
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(''); }}
                  placeholder="Mindestens 8 Zeichen"
                  autoComplete="new-password"
                  minLength={8}
                />
              </Field>
              <Field label="Passwort bestätigen">
                <PasswordInput
                  value={passwordConfirm}
                  onChange={e => { setPasswordConfirm(e.target.value); setError(''); }}
                  placeholder="Passwort wiederholen"
                  autoComplete="new-password"
                />
              </Field>
            </>
          )}

          {error && <Alert tone="error">{error}</Alert>}

          <Button
            type="submit"
            loading={loading}
            disabled={
              username.trim().length < 3 ||
              (needsPassword && (password.length < 8 || password !== passwordConfirm))
            }
            className="w-full"
          >
            Zugangsdaten speichern
          </Button>
        </form>
      </div>
    </div>
  );
}

function MustChangePasswordModal() {
  const { user, forceChangePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
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
    <div className="fixed inset-0 z-50 bg-scrim/40 dark:bg-scrim/60 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="card shadow-pop rounded-3xl p-6 sm:p-7 w-full max-w-sm space-y-5">
        <div>
          <h2 className="display text-xl">Passwort ändern</h2>
          <p className="text-ink-400 text-sm mt-1">Bitte wähle jetzt ein neues Passwort.</p>
        </div>

        <p className="text-ink-500 text-sm leading-relaxed">
          Wähle ein neues persönliches Passwort (mindestens 8 Zeichen).
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Neues Passwort">
            <PasswordInput
              value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              placeholder="Mindestens 8 Zeichen"
              autoFocus
              autoComplete="new-password"
            />
          </Field>
          <Field label="Passwort bestätigen">
            <PasswordInput
              value={confirm}
              onChange={e => { setConfirm(e.target.value); setError(''); }}
              placeholder="Passwort wiederholen"
              autoComplete="new-password"
            />
          </Field>

          {error && <Alert tone="error">{error}</Alert>}

          <Button
            type="submit"
            loading={loading}
            disabled={password.length < 8 || password !== confirm}
            className="w-full"
          >
            Passwort speichern
          </Button>
        </form>
      </div>
    </div>
  );
}

// First-login setup wizard — shown once credentials are settled (username
// chosen, forced password change done) and until the user completes it.
function OnboardingGate() {
  const { user } = useAuth();
  if (!user?.onboardingPending) return null;
  if (!user.username || user.mustChangePassword) return null;
  return <Onboarding />;
}

// First-installation gate for guest entry points: as long as no admin
// account exists, every visitor is funnelled into the /init wizard.
// Errors fail open (initialized) — the auth flow reports connection problems.
function InitCheck({ children }) {
  const [initNeeded, setInitNeeded] = useState(null);

  useEffect(() => {
    api.get('/init/status')
      .then(res => setInitNeeded(!!res.data.initNeeded))
      .catch(() => setInitNeeded(false));
  }, []);

  if (initNeeded === null) return <CenteredSpinner />;
  if (initNeeded) return <Navigate to="/init" replace />;
  return children;
}

// Root route: Landing page for guests, redirect to /dashboard for logged-in users
function RootRoute() {
  const { user, loading } = useAuth();
  if (loading) return <CenteredSpinner />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <InitCheck><Landing /></InitCheck>;
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <CenteredSpinner />;
  return user ? children : <Navigate to="/login" replace />;
}

// Admin area: handles auth check, setup redirect, and nested sub-routes.
// Rendered in its own AdminLayout — deliberately separate from the app shell.
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

  if (loading || (!user?.isAdmin && setupNeeded === null)) return <CenteredSpinner />;
  if (!user?.isAdmin) {
    if (setupNeeded) return <Navigate to="/init" replace />;
    return <Navigate to="/login" replace />;
  }

  return (
    <AdminLayout>
      <Routes>
        <Route path="users"        element={<AdminUsers />} />
        <Route path="config"       element={<AdminConfig />} />
        <Route path="integrations" element={<AdminIntegrations />} />
        <Route path="updates"      element={<AdminUpdates />} />
        <Route path="*"       element={<Navigate to="users" replace />} />
      </Routes>
    </AdminLayout>
  );
}

function AppInner() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <UsernameSetupModal />
        <MustChangePasswordModal />
        <OnboardingGate />
        <Routes>
          {/* Public routes */}
          <Route path="/"            element={<RootRoute />} />
          <Route path="/login"       element={<InitCheck><Login /></InitCheck>} />
          <Route path="/register"    element={<Register />} />
          <Route path="/init"        element={<Init />} />
          {/* Legacy setup URL — the /init wizard covers everything now */}
          <Route path="/admin/setup" element={<Navigate to="/init" replace />} />

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
            {/* The Heute view merged into the dashboard feed — keep old links working */}
            <Route path="today"      element={<Navigate to="/dashboard" replace />} />
            <Route path="activities" element={<Activities />} />
            <Route path="planner"    element={<Planner />} />
            <Route path="habits"     element={<Habits />} />
            <Route path="weight"     element={<Weight />} />
            <Route path="goals"      element={<Goals />} />
            <Route path="settings/*" element={<Settings />} />
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
    <ThemeProvider>
      <CompatibilityCheck>
        <AppInner />
      </CompatibilityCheck>
    </ThemeProvider>
  );
}
