import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import {
  Check, LogOut, User, Save, Download, Upload, AtSign, Lock, Server, Monitor,
  Settings as SettingsIcon,
} from 'lucide-react';
import {
  PageHeader, Button, Field, Input, Select, PasswordInput, Alert, TONE_BUBBLE,
} from '../components/ui';

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
      a.download = `habit-tracker-export-${new Date().toISOString().slice(0, 10)}.zip`;
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
        Exportiert Gewicht, Gewohnheiten und Aktivitäten als ZIP mit CSV-Dateien.
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

// Main page

export default function Settings() {
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

  // Backend version
  const [backendVersion, setBackendVersion] = useState(null);

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setWeightUnit(user.weightUnit || 'kg');
    }
  }, [user]);

  useEffect(() => {
    api.get('').then(res => setBackendVersion(res.data.version)).catch(() => setBackendVersion('–'));
  }, []);

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
    <div className="space-y-6">
      <PageHeader title="Einstellungen" subtitle="Profil & Präferenzen" icon={SettingsIcon} tone="stone" />

      {/* Desktop: 2-column grid; mobile: single column */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">

        {/* Left column */}
        <div className="space-y-5">

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

        {/* Right column */}
        <div className="space-y-5">

          {/* Password */}
          {user?.username && user?.hasPassword && (
            <UserPasswordForm changePassword={changePassword} />
          )}

          {/* Export / Import */}
          <ExportImport />

        </div>
      </div>

      {/* Full-width footer row: account + versions */}
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

        <div className="mt-4 pt-4 border-t hairline grid grid-cols-2 sm:grid-cols-4 gap-3">
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
      </div>
    </div>
  );
}
