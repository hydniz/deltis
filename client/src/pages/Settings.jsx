import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import {
  Check, LogOut, User, Save, Eye, EyeOff,
  Download, Upload, AlertCircle, AtSign, Lock, Server, Monitor
} from 'lucide-react';

// VersionBadge

function VersionBadge({ icon, label, version }) {
  return (
    <div className="bg-white/[.05] border border-white/[.08] rounded-xl px-3 py-2.5">
      <p className="text-xs text-slate-500 flex items-center gap-1.5 mb-1">
        {icon}
        {label}
      </p>
      <p
        className="text-xs font-mono text-slate-300 truncate"
        title={version ?? '…'}
      >
        {version ?? '…'}
      </p>
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
    <div className="card p-5">
      <h2 className="font-semibold text-white mb-1 flex items-center gap-2">
        <Download size={16} className="text-brand-400" />
        Daten exportieren & importieren
      </h2>
      <p className="text-xs text-slate-500 mb-4">
        Exportiert Gewicht, Gewohnheiten und Aktivitäten als ZIP mit CSV-Dateien.
      </p>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleExport}
          disabled={exporting}
          className="btn-primary flex items-center gap-2"
        >
          {exporting
            ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : <Download size={15} />}
          Exportieren
        </button>

        <label className={`btn-secondary flex items-center gap-2 cursor-pointer ${importing ? 'opacity-50 pointer-events-none' : ''}`}>
          {importing
            ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            : <Upload size={15} />}
          Importieren
          <input type="file" accept=".zip" className="hidden" onChange={handleImport} />
        </label>
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 text-red-400 text-sm bg-red-900/20 border border-red-900/50 rounded-xl px-3 py-2">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {result && (
        <div className="mt-3 bg-green-900/20 border border-green-700/50 rounded-xl px-4 py-3 space-y-1">
          <p className="text-green-400 text-sm font-medium">Import abgeschlossen!</p>
          <ul className="text-slate-400 text-xs space-y-0.5">
            <li>• {result.weight} Gewichtseinträge</li>
            <li>• {result.habits} Gewohnheitseinträge</li>
            <li>• {result.activities} Aktivitäten</li>
            <li>• {result.plans} Planereinträge</li>
            <li>• {result.goals} Ziele</li>
            {result.settings && <li>• Einstellungen wiederhergestellt</li>}
          </ul>
          {result.errors?.length > 0 && (
            <details className="mt-2">
              <summary className="text-yellow-500 text-xs cursor-pointer">
                {result.errors.length} Fehler
              </summary>
              <ul className="mt-1 text-xs text-slate-500 space-y-0.5">
                {result.errors.map((e, i) => <li key={i}>• {e}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// UserPasswordForm

function UserPasswordForm({ changePassword }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
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
    <div className="card p-5">
      <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
        <Lock size={16} className="text-brand-400" />
        Passwort ändern
      </h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="label">Aktuelles Passwort</label>
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              value={current}
              onChange={e => setCurrent(e.target.value)}
              className="input pr-10"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPw(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
              tabIndex={-1}
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <div>
          <label className="label">Neues Passwort</label>
          <input
            type={showPw ? 'text' : 'password'}
            value={next}
            onChange={e => setNext(e.target.value)}
            className="input"
            placeholder="Mindestens 8 Zeichen"
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="label">Neues Passwort bestätigen</label>
          <input
            type={showPw ? 'text' : 'password'}
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            className="input"
            autoComplete="new-password"
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}
        {success && (
          <p className="text-green-400 text-sm flex items-center gap-1.5">
            <Check size={14} /> Passwort erfolgreich geändert.
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !current || !next || !confirm}
          className="btn-primary flex items-center gap-2"
        >
          {loading
            ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : <Save size={15} />}
          Passwort ändern
        </button>
      </form>
    </div>
  );
}

// Main page

export default function Settings() {
  const { user, logout, updateUser, setUsername, changePassword } = useAuth();
  const navigate = useNavigate();

  // Profil
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
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Einstellungen</h1>
        <p className="text-slate-400 text-sm mt-0.5">Profil & Präferenzen</p>
      </div>

      {/* Desktop: 2-column grid; mobile: single column */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

        {/* Left column */}
        <div className="space-y-6">

          {/* Profil */}
          <div className="card p-5">
            <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
              <User size={16} className="text-brand-400" />
              Profil
            </h2>
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
                <label className="label">Name</label>
                <input
                  className="input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Dein Name"
                />
              </div>
              <div>
                <label className="label">Gewichtseinheit</label>
                <select
                  className="input"
                  value={weightUnit}
                  onChange={e => setWeightUnit(e.target.value)}
                >
                  <option value="kg">Kilogramm (kg)</option>
                  <option value="lbs">Pfund (lbs)</option>
                </select>
              </div>
              <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
                {saved ? <Check size={16} /> : <Save size={16} />}
                {saved ? 'Gespeichert!' : saving ? 'Speichern...' : 'Speichern'}
              </button>
            </form>
          </div>

          {/* Benutzername */}
          <div className="card p-5">
            <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
              <AtSign size={16} className="text-brand-400" />
              Benutzername
            </h2>
            {user?.username && (
              <p className="text-sm text-slate-400 mb-4">
                Aktuell: <span className="text-white font-mono">{user.username}</span>
              </p>
            )}
            <form onSubmit={handleSaveUsername} className="space-y-3">
              <div>
                <label className="label">
                  {user?.username ? 'Neuer Benutzername' : 'Benutzername wählen'}
                </label>
                <input
                  className="input"
                  value={newUsername}
                  onChange={e => { setNewUsername(e.target.value); setUsernameError(''); }}
                  placeholder="Mindestens 3 Zeichen"
                  minLength={3}
                  maxLength={30}
                  autoComplete="username"
                />
              </div>
              {usernameError && (
                <div className="flex items-center gap-2 text-red-400 text-sm bg-red-900/20 border border-red-900/50 rounded-xl px-3 py-2">
                  <AlertCircle size={14} />
                  {usernameError}
                </div>
              )}
              <button
                type="submit"
                disabled={usernameSaving || newUsername.trim().length < 3}
                className="btn-primary flex items-center gap-2"
              >
                {usernameSaved ? <Check size={16} /> : <Save size={16} />}
                {usernameSaved ? 'Gespeichert!' : usernameSaving ? 'Speichern...' : 'Benutzernamen speichern'}
              </button>
            </form>
          </div>

        </div>

        {/* Right column */}
        <div className="space-y-6">

          {/* Passwort */}
          {user?.username && user?.hasPassword && (
            <UserPasswordForm changePassword={changePassword} />
          )}

          {/* Export / Import */}
          <ExportImport />

        </div>
      </div>

      {/* Full-width footer row: Konto + Versionen */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-white mb-1">Konto</h2>
            <p className="text-sm text-slate-400">
              Mitglied seit {user?.createdAt ? new Date(user.createdAt).toLocaleDateString('de-DE') : '–'}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-red-400 hover:text-red-300 font-medium text-sm transition-colors"
          >
            <LogOut size={16} />
            Abmelden
          </button>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3">
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
