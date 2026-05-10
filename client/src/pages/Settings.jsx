import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import {
  Settings as SettingsIcon, Copy, Check, LogOut, User, Save, KeyRound, Eye, EyeOff,
  Download, Upload, AlertCircle
} from 'lucide-react';

// ── Main page ─────────────────────────────────────────────────────────────

export default function Settings() {
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();

  // Profil
  const [name, setName] = useState(user?.name || '');
  const [weightUnit, setWeightUnit] = useState(user?.weightUnit || 'kg');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showUuid, setShowUuid] = useState(false);

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

  const copyUuid = () => {
    navigator.clipboard.writeText(user?.uuid || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold text-white">Einstellungen</h1>
        <p className="text-slate-400 text-sm mt-0.5">Profil & Präferenzen</p>
      </div>

      {/* Profil */}
      <div className="card p-5">
        <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
          <User size={16} className="text-brand-400" />
          Profil
        </h2>
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Dein Name" />
          </div>
          <div>
            <label className="label">Gewichtseinheit</label>
            <select className="input" value={weightUnit} onChange={e => setWeightUnit(e.target.value)}>
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

      {/* UUID */}
      <div className="card p-5">
        <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
          <SettingsIcon size={16} className="text-brand-400" />
          Zugang
        </h2>
        <div>
          <label className="label">Deine UUID (Zugangscode)</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                className={`input font-mono text-sm pr-10 ${showUuid ? '' : 'blur-sm select-none'}`}
                value={user?.uuid || ''}
                readOnly
                tabIndex={showUuid ? 0 : -1}
              />
              <button
                type="button"
                onClick={() => setShowUuid(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                title={showUuid ? 'UUID verbergen' : 'UUID anzeigen'}
              >
                {showUuid ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <button onClick={copyUuid} className="btn-secondary px-3 flex-shrink-0 flex items-center gap-1.5">
              {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
              {copied ? 'Kopiert' : 'Kopieren'}
            </button>
          </div>
          <p className="text-xs text-slate-600 mt-1.5">
            Bewahre diese UUID sicher auf – sie ist dein einziger Zugangscode.
          </p>
        </div>
      </div>

      {/* Export / Import */}
      <ExportImport />

      {/* Admin-Passwort */}
      {user?.isAdmin && <ChangePasswordForm />}

      {/* Konto */}
      <div className="card p-5">
        <h2 className="font-semibold text-white mb-2">Konto</h2>
        <p className="text-sm text-slate-400 mb-4">
          Mitglied seit {user?.createdAt ? new Date(user.createdAt).toLocaleDateString('de-DE') : '–'}
        </p>
        <button onClick={handleLogout} className="flex items-center gap-2 text-red-400 hover:text-red-300 font-medium text-sm transition-colors">
          <LogOut size={16} />
          Abmelden
        </button>
      </div>
    </div>
  );
}

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

function ChangePasswordForm() {
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
      await api.put('/admin/password', { currentPassword: current, newPassword: next });
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
        <KeyRound size={16} className="text-brand-400" />
        Admin-Passwort ändern
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
