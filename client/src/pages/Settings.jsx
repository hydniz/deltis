import { useState, useEffect } from 'react';
import { useNavigate, NavLink, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import api from '../utils/api';
import {
  Check, LogOut, User, Save, Download, Upload, AtSign, Lock, Server, Monitor,
  Settings as SettingsIcon, Sun, Moon, MonitorSmartphone, SunMoon, UserRound, Plug, Database,
  Sparkles,
} from 'lucide-react';
import {
  PageHeader, Button, Field, Input, Select, PasswordInput, Alert, TONE_BUBBLE,
} from '../components/ui';
import StravaCard from '../components/StravaCard';
import TrainingTypesCard from '../components/TrainingTypesCard';

// Sub-sections — each is its own route below /settings.
const SECTIONS = [
  { path: 'account', label: 'Konto', icon: UserRound },
  { path: 'appearance', label: 'Erscheinungsbild', icon: SunMoon },
  { path: 'integrations', label: 'Integrationen', icon: Plug },
  { path: 'data', label: 'Daten & App', icon: Database },
];

// VersionBadge

function VersionBadge({ icon, label, version }) {
  return (
    <div className="panel px-3 py-2.5">
      <p className="text-xs text-ink-400 flex items-center gap-1.5 mb-1">
        {icon}
        {label}
      </p>
      <p
        className="text-xs font-mono text-ink-700 truncate"
        title={version ?? '…'}
      >
        {version ?? '…'}
      </p>
    </div>
  );
}

// Card with serif heading and tinted icon bubble — each section has its own
// accent colour so the page doesn't feel monochrome.
function SettingsCard({ icon: Icon, tone = 'clay', title, children }) {
  return (
    <div className="card p-5">
      <h2 className="display text-lg mb-4 flex items-center gap-2.5">
        {Icon && (
          <span className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${TONE_BUBBLE[tone]}`}>
            <Icon size={14} />
          </span>
        )}
        {title}
      </h2>
      {children}
    </div>
  );
}

// Appearance — theme picker with miniature app previews

const THEME_OPTIONS = [
  { value: 'light', label: 'Hell', icon: Sun },
  { value: 'dark', label: 'Dunkel', icon: Moon },
  { value: 'system', label: 'System', icon: MonitorSmartphone },
];

// Colours are intentionally hard-coded here: each tile always previews its
// own theme, regardless of the currently active one.
const PREVIEW_THEMES = {
  light: {
    bg: '#faf7f2', card: '#ffffff', border: '#ece4d6', line: '#dbd2c4',
    orb: 'rgba(232, 158, 112, 0.55)', accent: '#c4623a',
  },
  dark: {
    bg: '#17110d', card: '#241c16', border: '#382c21', line: '#453e33',
    orb: 'rgba(224, 137, 90, 0.30)', accent: '#e0895a',
  },
};

function MiniTheme({ t }) {
  return (
    <div className="absolute inset-0" style={{ background: t.bg }}>
      <div
        className="absolute -top-3 -right-3 w-12 h-12 rounded-full"
        style={{ background: t.orb, filter: 'blur(10px)' }}
      />
      <div
        className="absolute left-2 right-2 top-4 bottom-2 rounded-md border"
        style={{ background: t.card, borderColor: t.border }}
      >
        <div className="mx-2 mt-2 h-1 w-1/2 rounded-full" style={{ background: t.accent }} />
        <div className="mx-2 mt-1.5 h-1 rounded-full" style={{ background: t.line }} />
        <div className="mx-2 mt-1 h-1 w-2/3 rounded-full" style={{ background: t.line }} />
      </div>
    </div>
  );
}

function MiniPreview({ variant }) {
  return (
    <div className="relative h-16 rounded-lg overflow-hidden" aria-hidden="true">
      <MiniTheme t={variant === 'dark' ? PREVIEW_THEMES.dark : PREVIEW_THEMES.light} />
      {variant === 'system' && (
        <div
          className="absolute inset-0"
          style={{ clipPath: 'polygon(60% 0, 100% 0, 100% 100%, 40% 100%)' }}
        >
          <MiniTheme t={PREVIEW_THEMES.dark} />
        </div>
      )}
    </div>
  );
}

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  return (
    <SettingsCard icon={SunMoon} tone="olive" title="Erscheinungsbild">
      <p className="text-xs text-ink-400 -mt-2 mb-4">
        „System“ folgt automatisch der Einstellung deines Geräts.
      </p>
      <div className="grid grid-cols-3 gap-3">
        {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
          const active = theme === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              aria-pressed={active}
              className={`rounded-xl border p-1.5 pb-2 text-left transition-all ${
                active
                  ? 'border-brand-400 ring-2 ring-brand-400/30'
                  : 'hairline hover:border-ink-300'
              }`}
            >
              <MiniPreview variant={value} />
              <span className={`mt-2 px-1 flex items-center gap-1.5 text-xs font-semibold ${
                active ? 'text-brand-600' : 'text-ink-500'
              }`}>
                <Icon size={13} />
                {label}
                {active && <Check size={12} className="ml-auto" />}
              </span>
            </button>
          );
        })}
      </div>
    </SettingsCard>
  );
}

// ExportImport

function ExportImport() {
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleExport = async () => {
    setExporting(true);
    setError('');
    try {
      const res = await api.get('/data/export', { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `deltis-export-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Export fehlgeschlagen.');
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true);
    setResult(null);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post('/data/import', form);
      setResult(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Import fehlgeschlagen.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <SettingsCard icon={Download} tone="sage" title="Daten exportieren & importieren">
      <p className="text-xs text-ink-400 -mt-2 mb-4">
        Exportiert alle persönlichen Daten – Gewicht, Gewohnheiten, Aktivitäten,
        Planer, Ziele, Trainingsarten und Strava-Aktivitäten – als ZIP-Archiv.
        Das Archiv kann vollständig in eine andere Deltis-Instanz importiert
        werden; nur die Strava-Verbindung muss dort neu hergestellt werden.
      </p>

      <div className="flex flex-wrap gap-3">
        <Button icon={Download} loading={exporting} onClick={handleExport}>
          Exportieren
        </Button>

        <label className={`btn-secondary cursor-pointer ${importing ? 'opacity-50 pointer-events-none' : ''}`}>
          <Upload size={15} />
          Importieren
          <input type="file" accept=".zip" className="hidden" onChange={handleImport} />
        </label>
      </div>

      {error && <Alert tone="error" className="mt-3">{error}</Alert>}

      {result && (
        <Alert tone="success" title="Import abgeschlossen!" className="mt-3">
          <ul className="text-xs space-y-0.5 mt-1">
            <li>• {result.weight} Gewichtseinträge</li>
            <li>• {result.habits} Gewohnheitseinträge</li>
            <li>• {result.activities} Aktivitäten</li>
            <li>• {result.plans} Planereinträge</li>
            <li>• {result.goals} Ziele</li>
            {result.habitDefinitions > 0 && <li>• {result.habitDefinitions} Gewohnheits-Definitionen</li>}
            {result.activityTypes > 0 && <li>• {result.activityTypes} Aktivitätstypen</li>}
            {result.trainingTypes > 0 && <li>• {result.trainingTypes} Trainingsarten</li>}
            {result.stravaActivities > 0 && <li>• {result.stravaActivities} Strava-Aktivitäten</li>}
            {result.settings && <li>• Einstellungen wiederhergestellt</li>}
          </ul>
          {result.errors?.length > 0 && (
            <details className="mt-2">
              <summary className="text-ocher-600 text-xs cursor-pointer">
                {result.errors.length} Fehler
              </summary>
              <ul className="mt-1 text-xs space-y-0.5">
                {result.errors.map((e, i) => <li key={i}>• {e}</li>)}
              </ul>
            </details>
          )}
        </Alert>
      )}
    </SettingsCard>
  );
}

// UserPasswordForm

function UserPasswordForm({ changePassword }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (next.length < 8) { setError('Neues Passwort muss mindestens 8 Zeichen haben.'); return; }
    if (next !== confirm) { setError('Passwörter stimmen nicht überein.'); return; }
    setLoading(true);
    setError('');
    setSuccess(false);
    try {
      await changePassword(current, next);
      setSuccess(true);
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setError(err.response?.data?.error || 'Fehler beim Ändern.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SettingsCard icon={Lock} tone="rose" title="Passwort ändern">
      <form onSubmit={handleSubmit} className="space-y-3.5">
        <Field label="Aktuelles Passwort">
          <PasswordInput
            value={current}
            onChange={e => setCurrent(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <Field label="Neues Passwort">
          <PasswordInput
            value={next}
            onChange={e => setNext(e.target.value)}
            placeholder="Mindestens 8 Zeichen"
            autoComplete="new-password"
          />
        </Field>
        <Field label="Neues Passwort bestätigen">
          <PasswordInput
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </Field>

        {error && <p className="text-red-600 text-sm">{error}</p>}
        {success && (
          <p className="text-emerald-600 text-sm flex items-center gap-1.5">
            <Check size={14} /> Passwort erfolgreich geändert.
          </p>
        )}

        <Button
          type="submit"
          icon={Save}
          loading={loading}
          disabled={!current || !next || !confirm}
        >
          Passwort ändern
        </Button>
      </form>
    </SettingsCard>
  );
}

// Section: Konto (profile, username, password, account footer)

function AccountSection() {
  const { user, logout, updateUser, setUsername, changePassword } = useAuth();
  const navigate = useNavigate();

  // Profile
  const [name, setName] = useState(user?.name || '');
  const [weightUnit, setWeightUnit] = useState(user?.weightUnit || 'kg');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Username
  const [newUsername, setNewUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [usernameSaved, setUsernameSaved] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setWeightUnit(user.weightUnit || 'kg');
    }
  }, [user]);

  // Check-in reminder times (HH:MM). Saved separately from the profile form.
  const [checkinTimes, setCheckinTimes] = useState(user?.checkinTimes || []);
  const [checkinSaving, setCheckinSaving] = useState(false);
  const [checkinSaved, setCheckinSaved] = useState(false);
  useEffect(() => { if (user) setCheckinTimes(user.checkinTimes || []); }, [user]);

  const handleSaveCheckin = async (e) => {
    e.preventDefault();
    setCheckinSaving(true);
    try {
      const res = await api.put('/auth/me', {
        checkinTimes: checkinTimes.filter(Boolean),
      });
      updateUser(res.data);
      setCheckinSaved(true);
      setTimeout(() => setCheckinSaved(false), 2000);
    } catch (err) {
      alert('Fehler beim Speichern: ' + (err.response?.data?.error || err.message));
    } finally {
      setCheckinSaving(false);
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.put('/auth/me', { name, weightUnit });
      updateUser(res.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      alert('Fehler beim Speichern: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveUsername = async (e) => {
    e.preventDefault();
    const trimmed = newUsername.trim();
    if (trimmed.length < 3) {
      setUsernameError('Benutzername muss mindestens 3 Zeichen lang sein.');
      return;
    }
    setUsernameSaving(true);
    setUsernameError('');
    try {
      await setUsername(trimmed);
      setNewUsername('');
      setUsernameSaved(true);
      setTimeout(() => setUsernameSaved(false), 2000);
    } catch (err) {
      setUsernameError(err.response?.data?.error || 'Fehler beim Speichern.');
    } finally {
      setUsernameSaving(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* Profile */}
        <SettingsCard icon={User} tone="clay" title="Profil">
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <Field label="Name">
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Dein Name"
              />
            </Field>
            <Field label="Gewichtseinheit">
              <Select value={weightUnit} onChange={e => setWeightUnit(e.target.value)}>
                <option value="kg">Kilogramm (kg)</option>
                <option value="lbs">Pfund (lbs)</option>
              </Select>
            </Field>
            <Button type="submit" icon={saved ? Check : Save} loading={saving}>
              {saved ? 'Gespeichert!' : 'Speichern'}
            </Button>
          </form>
        </SettingsCard>

        {/* Daily check-in reminder times */}
        <SettingsCard icon={Sparkles} tone="sage" title="Täglicher Check-in">
          <form onSubmit={handleSaveCheckin} className="space-y-3">
            <p className="text-xs text-ink-400">
              Beim ersten Öffnen der App nach einer dieser Uhrzeiten fragt dich
              ein kurzer Fragebogen nach den noch offenen Gewohnheiten des Tages
              (überspringbar).
            </p>
            {checkinTimes.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  type="time"
                  value={t}
                  onChange={e => setCheckinTimes(ts => ts.map((v, j) => j === i ? e.target.value : v))}
                  className="!w-32"
                  required
                />
                <button
                  type="button"
                  onClick={() => setCheckinTimes(ts => ts.filter((_, j) => j !== i))}
                  className="text-xs font-semibold text-red-500 hover:text-red-600 transition-colors"
                >
                  Entfernen
                </button>
              </div>
            ))}
            {checkinTimes.length < 6 && (
              <button
                type="button"
                onClick={() => setCheckinTimes(ts => [...ts, '20:00'])}
                className="text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors"
              >
                + Uhrzeit hinzufügen
              </button>
            )}
            <div>
              <Button type="submit" icon={checkinSaved ? Check : Save} loading={checkinSaving}>
                {checkinSaved ? 'Gespeichert!' : 'Speichern'}
              </Button>
            </div>
          </form>
        </SettingsCard>

        <div className="space-y-5">
          {/* Username */}
          <SettingsCard icon={AtSign} tone="amber" title="Benutzername">
            {user?.username && (
              <p className="text-sm text-ink-500 mb-4">
                Aktuell: <span className="text-ink-900 font-mono">{user.username}</span>
              </p>
            )}
            <form onSubmit={handleSaveUsername} className="space-y-3.5">
              <Field label={user?.username ? 'Neuer Benutzername' : 'Benutzername wählen'}>
                <Input
                  value={newUsername}
                  onChange={e => { setNewUsername(e.target.value); setUsernameError(''); }}
                  placeholder="Mindestens 3 Zeichen"
                  minLength={3}
                  maxLength={30}
                  autoComplete="username"
                />
              </Field>
              {usernameError && <Alert tone="error">{usernameError}</Alert>}
              <Button
                type="submit"
                icon={usernameSaved ? Check : Save}
                loading={usernameSaving}
                disabled={newUsername.trim().length < 3}
              >
                {usernameSaved ? 'Gespeichert!' : 'Benutzernamen speichern'}
              </Button>
            </form>
          </SettingsCard>
        </div>

        {/* Password */}
        {user?.username && user?.hasPassword && (
          <UserPasswordForm changePassword={changePassword} />
        )}
      </div>

      {/* Account footer */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="display text-lg mb-1">Konto</h2>
            <p className="text-sm text-ink-500">
              Mitglied seit {user?.createdAt ? new Date(user.createdAt).toLocaleDateString('de-DE') : '–'}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-red-600 hover:text-red-700 font-semibold text-sm transition-colors"
          >
            <LogOut size={16} />
            Abmelden
          </button>
        </div>
      </div>
    </div>
  );
}

// Section: Erscheinungsbild

function AppearanceSection() {
  return (
    <div className="max-w-xl">
      <AppearanceCard />
    </div>
  );
}

// Section: Integrationen

function IntegrationsSection() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
      <StravaCard />
      <TrainingTypesCard />
    </div>
  );
}

// Section: Daten & App

function DataSection() {
  const [backendVersion, setBackendVersion] = useState(null);

  useEffect(() => {
    api.get('').then(res => setBackendVersion(res.data.version)).catch(() => setBackendVersion('–'));
  }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
      <ExportImport />

      <SettingsCard icon={Monitor} tone="stone" title="App-Version">
        <div className="grid grid-cols-2 gap-3">
          <VersionBadge
            icon={<Monitor size={13} />}
            label="Frontend"
            version={__APP_VERSION__}
          />
          <VersionBadge
            icon={<Server size={13} />}
            label="Backend"
            version={backendVersion}
          />
        </div>
      </SettingsCard>
    </div>
  );
}

// Sub-navigation: horizontal pills on mobile, sticky vertical rail on desktop.

function SectionNav() {
  return (
    <nav
      aria-label="Einstellungsbereiche"
      className="flex lg:flex-col gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 py-1 lg:m-0 lg:p-0 lg:overflow-visible lg:sticky lg:top-24 lg:self-start"
    >
      {SECTIONS.map(({ path, label, icon: Icon }) => (
        <NavLink
          key={path}
          to={path}
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-3.5 py-2.5 rounded-full text-sm font-medium whitespace-nowrap flex-shrink-0 transition-all ${
              isActive
                ? 'bg-brand-50 text-brand-700 font-semibold shadow-[inset_0_0_0_1px_rgba(196,98,58,0.25)]'
                : 'text-ink-500 hover:text-ink-900 hover:bg-ink-900/[.04]'
            }`
          }
        >
          <Icon size={16} className="flex-shrink-0" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

// /settings → first section; a Strava OAuth callback (…?strava=…) lands on
// the integrations section so its status message is shown.
function IndexRedirect() {
  const location = useLocation();
  const target = location.search.includes('strava=') ? 'integrations' : 'account';
  return <Navigate to={`${target}${location.search}`} replace />;
}

// Main page

export default function Settings() {
  return (
    <div className="space-y-6">
      <PageHeader title="Einstellungen" subtitle="Konto, Darstellung & Integrationen" icon={SettingsIcon} tone="stone" />

      <div className="lg:grid lg:grid-cols-[210px_1fr] lg:gap-8 space-y-4 lg:space-y-0">
        <SectionNav />

        <main className="min-w-0">
          <Routes>
            <Route index element={<IndexRedirect />} />
            <Route path="account" element={<AccountSection />} />
            <Route path="appearance" element={<AppearanceSection />} />
            <Route path="integrations" element={<IntegrationsSection />} />
            <Route path="data" element={<DataSection />} />
            <Route path="*" element={<Navigate to="account" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
