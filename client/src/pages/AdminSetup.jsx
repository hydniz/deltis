import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check, Eye, EyeOff, AlertCircle, Activity,
  ShieldAlert, Database, Lock, AlertTriangle, Info, ChevronRight,
} from 'lucide-react';
import { APP_NAME } from '../config/branding';
import api from '../utils/api';

// ── Step indicator ────────────────────────────────────────────────────────────

function Steps({ current, steps }) {
  return (
    <div className="flex items-center gap-1 mb-8">
      {steps.map((label, i) => (
        <div key={i} className="flex items-center gap-1">
          <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold transition-colors ${
            i < current ? 'bg-brand-600 text-white' :
            i === current ? 'bg-brand-500 text-white ring-2 ring-brand-400/40' :
            'bg-slate-800 text-slate-500'
          }`}>
            {i < current ? <Check size={12} /> : i + 1}
          </div>
          <span className={`text-xs hidden sm:inline ${i === current ? 'text-white' : 'text-slate-600'}`}>
            {label}
          </span>
          {i < steps.length - 1 && (
            <div className={`w-6 h-px mx-1 ${i < current ? 'bg-brand-600' : 'bg-slate-800'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Step 1: Admin account ─────────────────────────────────────────────────────

function StepAccount({ onDone }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (username.length < 3) { setError('Benutzername muss mindestens 3 Zeichen haben.'); return; }
    if (password.length < 8) { setError('Passwort muss mindestens 8 Zeichen haben.'); return; }
    if (password !== confirm) { setError('Passwörter stimmen nicht überein.'); return; }
    setSubmitting(true);
    setError('');
    try {
      await api.post('/admin/setup', { username, password });
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'Setup fehlgeschlagen.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-5">
        <ShieldAlert size={18} className="text-brand-400" />
        <h2 className="text-base font-semibold text-white">Admin-Konto erstellen</h2>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">Benutzername</label>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="input"
            placeholder="Mindestens 3 Zeichen"
            autoComplete="username"
            autoFocus
          />
        </div>
        <div>
          <label className="label">Passwort</label>
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="input pr-10"
              placeholder="Mindestens 8 Zeichen"
              autoComplete="new-password"
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
          <label className="label">Passwort bestätigen</label>
          <input
            type={showPw ? 'text' : 'password'}
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            className="input"
            placeholder="Passwort wiederholen"
            autoComplete="new-password"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm bg-red-900/20 border border-red-900/50 rounded-xl px-3 py-2">
            <AlertCircle size={15} />
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !username || !password || !confirm}
          className="btn-primary w-full py-3 flex items-center justify-center gap-2"
        >
          {submitting && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          Weiter
          <ChevronRight size={16} />
        </button>
      </form>
    </div>
  );
}

// ── Step 2: System configuration ──────────────────────────────────────────────

function StepSystemConfig({ onDone, onSkip }) {
  const [mongoUri, setMongoUri] = useState('');
  const [showMongoUri, setShowMongoUri] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [envMongoUri, setEnvMongoUri] = useState(false);

  useEffect(() => {
    // Check if MongoDB URI is already provided via env
    api.get('/admin/config')
      .then(res => {
        const mongoEntry = res.data.find(c => c.key === 'MONGODB_URI');
        if (mongoEntry?.source === 'env') setEnvMongoUri(true);
        if (mongoEntry?.value) setMongoUri(mongoEntry.value);
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const uri = mongoUri.trim();
      if (uri && !uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
        setError('Ungültige MongoDB URI. Muss mit mongodb:// oder mongodb+srv:// beginnen.');
        setSubmitting(false);
        return;
      }
      await api.post('/admin/setup/system-config', {
        mongodb_uri: uri || undefined,
      });
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'Fehler beim Speichern.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-5">
        <Database size={18} className="text-brand-400" />
        <h2 className="text-base font-semibold text-white">Systemkonfiguration</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* MongoDB URI */}
        <div>
          <label className="label flex items-center gap-1.5">
            <Database size={13} />
            MongoDB URI
          </label>

          {envMongoUri ? (
            <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-3">
              <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300/80">
                MongoDB URI ist bereits über die Umgebungsvariable (<code className="font-mono">.env</code> /{' '}
                <code className="font-mono">docker-compose.yml</code>) gesetzt und hat Vorrang.
                Der hier eingetragene Wert wird ignoriert, solange die Umgebungsvariable gesetzt ist.
              </p>
            </div>
          ) : (
            <>
              <div className="relative">
                <input
                  type={showMongoUri ? 'text' : 'password'}
                  value={mongoUri}
                  onChange={e => setMongoUri(e.target.value)}
                  className="input pr-10 font-mono text-sm"
                  placeholder="mongodb://localhost:27017/habit_tracker"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowMongoUri(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                  tabIndex={-1}
                >
                  {showMongoUri ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Leer lassen für Standardwert (<code className="font-mono">mongodb://localhost:27017/habit_tracker</code>).
                Änderungen werden in <code className="font-mono">deltis.config.json</code> gespeichert
                und erfordern einen Serverneustart.
              </p>
            </>
          )}
        </div>

        {/* Security info */}
        <div className="bg-slate-800/40 border border-slate-700 rounded-xl px-4 py-4 space-y-3">
          <div className="flex items-center gap-2">
            <Lock size={14} className="text-slate-400" />
            <span className="text-sm font-medium text-slate-300">Sicherheitskonfiguration</span>
          </div>
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <Info size={13} className="text-brand-400 shrink-0 mt-0.5" />
              <p className="text-xs text-slate-400">
                <strong className="text-slate-300">Pepper-Datei</strong> — Wird über die Umgebungsvariable{' '}
                <code className="font-mono">PEPPER_FILE</code> (Pfad zur Datei) oder{' '}
                <code className="font-mono">PASSWORD_PEPPER</code> (direkter Wert) gesetzt.
                Diese Werte können nur in <code className="font-mono">.env</code> oder{' '}
                <code className="font-mono">docker-compose.yml</code> konfiguriert werden.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300/70">
                Den Pepper <strong>niemals</strong> nach dem ersten Login eines Nutzers ändern!
                Alle Passwörter werden damit gehasht – eine Änderung macht alle Accounts unbrauchbar.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <Info size={13} className="text-brand-400 shrink-0 mt-0.5" />
              <p className="text-xs text-slate-400">
                <strong className="text-slate-300">JWT Secret</strong> — Über{' '}
                <code className="font-mono">JWT_SECRET</code> oder{' '}
                <code className="font-mono">JWT_SECRET_FILE</code> setzen. Änderungen invalidieren
                alle aktiven Sessions.
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm bg-red-900/20 border border-red-900/50 rounded-xl px-3 py-2">
            <AlertCircle size={15} />
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onSkip}
            className="btn-secondary flex-1"
          >
            Überspringen
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary flex-1 flex items-center justify-center gap-2"
          >
            {submitting && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            Weiter
            <ChevronRight size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Step 3: Done ──────────────────────────────────────────────────────────────

function StepDone({ navigate }) {
  return (
    <div className="card p-6 text-center space-y-4">
      <div className="w-12 h-12 bg-green-900/30 border border-green-700/50 rounded-full flex items-center justify-center mx-auto">
        <Check size={22} className="text-green-400" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-white mb-1">Setup abgeschlossen!</h2>
        <p className="text-slate-400 text-sm">
          Melde dich jetzt mit deinem Benutzernamen und Passwort an.
        </p>
      </div>
      <p className="text-xs text-slate-600">
        Weitere Einstellungen (OTA, Systemkonfiguration) sind nach dem Login im Admin-Bereich verfügbar.
      </p>
      <button
        onClick={() => navigate('/login')}
        className="btn-primary w-full py-3"
      >
        Zur Anmeldung
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const STEPS = ['Konto', 'System', 'Fertig'];

export default function AdminSetup() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/setup-status')
      .then(res => {
        if (!res.data.setupNeeded) navigate('/login', { replace: true });
      })
      .catch(() => navigate('/login', { replace: true }))
      .finally(() => setLoading(false));
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-brand-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2.5 mb-6">
            <div className="w-5 h-5 rounded bg-brand-600 flex items-center justify-center">
              <Activity size={12} className="text-white" />
            </div>
            <span className="font-semibold text-zinc-100 text-sm">{APP_NAME}</span>
          </div>
          <h1 className="text-2xl font-semibold text-zinc-100 mb-1">Ersteinrichtung</h1>
          <p className="text-zinc-500 text-sm">System-Setup für Deltis</p>
        </div>

        <Steps current={step} steps={STEPS} />

        {step === 0 && <StepAccount onDone={() => setStep(1)} />}
        {step === 1 && (
          <StepSystemConfig
            onDone={() => setStep(2)}
            onSkip={() => setStep(2)}
          />
        )}
        {step === 2 && <StepDone navigate={navigate} />}
      </div>
    </div>
  );
}
