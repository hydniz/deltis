import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check, Eye, EyeOff, AlertCircle, Activity, ShieldAlert,
  Database, Lock, AlertTriangle, Info, ChevronRight, RefreshCw,
  SlidersHorizontal,
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

// ── Shared form building blocks ───────────────────────────────────────────────

// Password-style input with a show/hide toggle.
function SecretInput({ value, onChange, placeholder, disabled, autoFocus }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        className="input pr-10 font-mono text-sm"
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
      />
      <button type="button" onClick={() => setShow(v => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors" tabIndex={-1}>
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

// JWT secret + pepper fields shared by both config steps.
function SecurityFields({ jwtSecret, setJwtSecret, pepperFile, setPepperFile, passwordPepper, setPasswordPepper }) {
  return (
    <>
      <div>
        <label className="label flex items-center gap-1.5">
          <Lock size={12} />
          JWT Secret
          <span className="text-[10px] text-slate-500 font-normal ml-1">optional</span>
        </label>
        <SecretInput
          value={jwtSecret}
          onChange={e => setJwtSecret(e.target.value)}
          placeholder="openssl rand -base64 64"
        />
        <div className="flex items-start gap-1.5 mt-1.5">
          <Info size={11} className="text-slate-500 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-500">
            Wenn leer: temporäres Zufalls-Secret — Sitzungen enden bei jedem Neustart.
            Wirksam erst nach Neustart des Servers.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-start gap-2 bg-amber-500/8 border border-amber-500/20 rounded-xl px-3 py-3">
          <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300/80">
            Den Pepper <strong>vor dem ersten Nutzer-Login</strong> konfigurieren.
            Eine nachträgliche Änderung macht alle Passwörter ungültig.
            Wirksam erst nach Neustart.
          </p>
        </div>

        <div>
          <label className="label">Pepper-Datei Pfad <span className="text-[10px] text-slate-500 font-normal ml-1">empfohlen</span></label>
          <input
            type="text"
            value={pepperFile}
            onChange={e => setPepperFile(e.target.value)}
            className="input font-mono text-sm"
            placeholder="/etc/deltis/pepper.key"
          />
          <p className="text-xs text-slate-600 mt-1">Pfad zu einer Datei außerhalb des App-Verzeichnisses. Sicherer als ein direkt gesetzter Wert.</p>
        </div>

        <div>
          <label className="label">Pepper (direkt) <span className="text-[10px] text-slate-500 font-normal ml-1">alternative</span></label>
          <SecretInput
            value={passwordPepper}
            onChange={e => setPasswordPepper(e.target.value)}
            placeholder="langer zufälliger Wert"
            disabled={!!pepperFile.trim()}
          />
          {pepperFile.trim() && (
            <p className="text-xs text-slate-600 mt-1">Deaktiviert wenn Pepper-Datei gesetzt.</p>
          )}
        </div>
      </div>
    </>
  );
}

// Warning card shown when the admin saved the config without any pepper.
function PepperWarningCard({ onBack, onContinue }) {
  return (
    <div className="card p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-red-900/30 border border-red-700/50 flex items-center justify-center shrink-0">
          <AlertTriangle size={18} className="text-red-400" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-white mb-1">Kein Pepper konfiguriert!</h2>
          <p className="text-sm text-slate-400">
            Das Admin-Passwort wird <strong className="text-white">ohne Pepper</strong> gehasht.
            Wenn du später einen Pepper hinzufügst, ist das Admin-Passwort nicht mehr gültig
            und du wirst ausgesperrt.
          </p>
        </div>
      </div>
      <div className="bg-red-900/15 border border-red-800/40 rounded-xl px-4 py-3 text-xs text-red-300/80 space-y-1">
        <p><strong>Empfehlung:</strong> Konfiguriere jetzt einen Pepper, bevor du das Admin-Konto erstellst.</p>
        <p>Generiere einen sicheren Pepper: <code className="font-mono bg-slate-900 px-1 rounded">openssl rand -base64 48 {'>'} /etc/deltis/pepper.key</code></p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="btn-primary flex-1 flex items-center justify-center gap-2"
        >
          <ChevronRight size={15} className="rotate-180" />
          Pepper jetzt setzen
        </button>
        <button
          onClick={onContinue}
          className="btn-secondary flex-1 text-red-400 hover:text-red-300 border-red-900/40 hover:border-red-800/60"
        >
          Trotzdem fortfahren
        </button>
      </div>
    </div>
  );
}

// ── Step: Configuration ───────────────────────────────────────────────────────
// One component for both variants:
//   withMongo=true  → setup mode: MongoDB URI + JWT + pepper (POST /admin/setup/bootstrap)
//   withMongo=false → DB already connected: JWT + pepper only (POST /admin/setup/security-config)

function StepConfig({ withMongo, onDone }) {
  const [mongoUri, setMongoUri] = useState('');
  const [jwtSecret, setJwtSecret] = useState('');
  const [pepperFile, setPepperFile] = useState('');
  const [passwordPepper, setPasswordPepper] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [mongoError, setMongoError] = useState('');
  // Shown after a successful save when no pepper was configured
  const [pepperWarning, setPepperWarning] = useState(false);

  const pepperConfigured = pepperFile.trim() || passwordPepper.trim();

  const handleSubmit = async (e) => {
    e.preventDefault();
    const uri = mongoUri.trim();
    if (withMongo && uri && !uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
      setMongoError('Muss mit mongodb:// oder mongodb+srv:// beginnen.');
      return;
    }
    setSubmitting(true);
    setError('');
    setMongoError('');
    try {
      const endpoint = withMongo ? '/admin/setup/bootstrap' : '/admin/setup/security-config';
      const res = await api.post(endpoint, {
        ...(withMongo && uri ? { mongodb_uri: uri } : {}),
        ...(jwtSecret.trim() ? { jwt_secret: jwtSecret.trim() } : {}),
        ...(pepperFile.trim() ? { pepper_file: pepperFile.trim() } : {}),
        ...(passwordPepper.trim() ? { password_pepper: passwordPepper.trim() } : {}),
      });
      if (!res.data.ok) {
        setError(res.data.note || 'Fehler beim Speichern.');
        return;
      }
      if (withMongo && res.data.setupMode) {
        setError(
          uri
            ? 'Konfiguration gespeichert, aber MongoDB konnte nicht verbunden werden. URI prüfen und erneut versuchen.'
            : 'Konfiguration gespeichert. Gib eine MongoDB URI ein und speichere erneut um fortzufahren.'
        );
        return;
      }
      // Saved. Warn before advancing if no pepper was configured.
      if (!pepperConfigured) {
        setPepperWarning(true);
        return;
      }
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || (withMongo ? 'Verbindung fehlgeschlagen.' : 'Speichern fehlgeschlagen.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (pepperWarning) {
    return <PepperWarningCard onBack={() => setPepperWarning(false)} onContinue={onDone} />;
  }

  const HeaderIcon = withMongo ? Database : Lock;

  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-2">
        <HeaderIcon size={18} className="text-brand-400" />
        <h2 className="text-base font-semibold text-white">
          {withMongo ? 'Systemkonfiguration' : 'Sicherheitskonfiguration'}
        </h2>
      </div>

      <p className="text-xs text-slate-500 mb-5">
        Diese Werte werden in <code className="font-mono">/etc/deltis/deltis.config.json</code> gespeichert.
        .env-Variablen haben immer Vorrang.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        {withMongo && (
          <div>
            <label className="label flex items-center gap-1.5">
              <Database size={12} />
              MongoDB URI
            </label>
            <SecretInput
              value={mongoUri}
              onChange={e => { setMongoUri(e.target.value); setMongoError(''); }}
              placeholder="mongodb://localhost:27017/habit_tracker"
              autoFocus
            />
            {mongoError && <p className="text-xs text-red-400 mt-1">{mongoError}</p>}
            <p className="text-xs text-slate-600 mt-1">
              Ohne MongoDB URI kann der Server nicht vollständig starten. JWT-Secret und Pepper
              können aber bereits jetzt gespeichert werden.
            </p>
          </div>
        )}

        <SecurityFields
          jwtSecret={jwtSecret} setJwtSecret={setJwtSecret}
          pepperFile={pepperFile} setPepperFile={setPepperFile}
          passwordPepper={passwordPepper} setPasswordPepper={setPasswordPepper}
        />

        {error && (
          <div className={`flex items-start gap-2 text-sm rounded-xl px-3 py-2 ${
            error.includes('gespeichert')
              ? 'text-amber-400 bg-amber-900/20 border border-amber-900/50'
              : 'text-red-400 bg-red-900/20 border border-red-900/50'
          }`}>
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="btn-primary w-full py-3 flex items-center justify-center gap-2"
        >
          {submitting
            ? <RefreshCw size={16} className="animate-spin" />
            : <ChevronRight size={16} />}
          {submitting
            ? (withMongo ? 'Verbinde …' : 'Speichere …')
            : (withMongo ? 'Speichern & verbinden' : 'Speichern & weiter')}
        </button>
      </form>
    </div>
  );
}

// ── Step: Admin account ───────────────────────────────────────────────────────

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
          <input type="text" value={username} onChange={e => setUsername(e.target.value)}
            className="input" placeholder="Mindestens 3 Zeichen" autoComplete="username" autoFocus />
        </div>
        <div>
          <label className="label">Passwort</label>
          <div className="relative">
            <input type={showPw ? 'text' : 'password'} value={password}
              onChange={e => setPassword(e.target.value)}
              className="input pr-10" placeholder="Mindestens 8 Zeichen" autoComplete="new-password" />
            <button type="button" onClick={() => setShowPw(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors" tabIndex={-1}>
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <div>
          <label className="label">Passwort bestätigen</label>
          <input type={showPw ? 'text' : 'password'} value={confirm}
            onChange={e => setConfirm(e.target.value)}
            className="input" placeholder="Passwort wiederholen" autoComplete="new-password" />
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm bg-red-900/20 border border-red-900/50 rounded-xl px-3 py-2">
            <AlertCircle size={15} />
            {error}
          </div>
        )}

        <button type="submit" disabled={submitting || !username || !password || !confirm}
          className="btn-primary w-full py-3 flex items-center justify-center gap-2">
          {submitting && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          Weiter <ChevronRight size={16} />
        </button>
      </form>
    </div>
  );
}

// ── Step: Done ────────────────────────────────────────────────────────────────

function StepDone({ navigate }) {
  return (
    <div className="card p-6 text-center space-y-4">
      <div className="w-12 h-12 bg-green-900/30 border border-green-700/50 rounded-full flex items-center justify-center mx-auto">
        <Check size={22} className="text-green-400" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-white mb-1">Setup abgeschlossen!</h2>
        <p className="text-slate-400 text-sm">Melde dich jetzt mit deinem Benutzernamen und Passwort an.</p>
      </div>
      <div className="flex items-start gap-2 bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-3 text-left">
        <SlidersHorizontal size={14} className="text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-slate-400">
          JWT Secret und Pepper werden nach einem <strong className="text-slate-300">Server-Neustart</strong> aktiv.
          Weitere Einstellungen sind im <strong className="text-slate-300">Admin-Bereich</strong> verfügbar.
        </p>
      </div>
      <button onClick={() => navigate('/login')} className="btn-primary w-full py-3">
        Zur Anmeldung
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AdminSetup() {
  const navigate = useNavigate();
  const [step, setStep] = useState(null); // null = loading
  const [setupMode, setSetupMode] = useState(false);
  const [needsSecurityConfig, setNeedsSecurityConfig] = useState(false);

  useEffect(() => {
    api.get('/admin/setup-status')
      .then(res => {
        if (!res.data.setupNeeded) {
          navigate('/login', { replace: true });
          return;
        }
        const sm = Boolean(res.data.setupMode);
        setSetupMode(sm);
        // Show security config step when pepper is not yet configured,
        // regardless of whether we're in setup mode or not.
        setNeedsSecurityConfig(!res.data.pepperConfigured);
        setStep(0);
      })
      .catch(() => navigate('/login', { replace: true }));
  }, [navigate]);

  if (step === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-brand-500 rounded-full animate-spin" />
      </div>
    );
  }

  // Build step list based on what still needs to be configured.
  // setupMode=true   → always show system config (MongoDB + JWT + Pepper)
  // !pepperConfigured → show security config (JWT + Pepper) before account creation
  // otherwise        → just account + done
  let STEPS, renderStep;
  if (setupMode) {
    STEPS = ['System', 'Konto', 'Fertig'];
    renderStep = [
      <StepConfig withMongo onDone={() => setStep(1)} />,
      <StepAccount onDone={() => setStep(2)} />,
      <StepDone navigate={navigate} />,
    ];
  } else if (needsSecurityConfig) {
    STEPS = ['Sicherheit', 'Konto', 'Fertig'];
    renderStep = [
      <StepConfig withMongo={false} onDone={() => setStep(1)} />,
      <StepAccount onDone={() => setStep(2)} />,
      <StepDone navigate={navigate} />,
    ];
  } else {
    STEPS = ['Konto', 'Fertig'];
    renderStep = [
      <StepAccount onDone={() => setStep(1)} />,
      <StepDone navigate={navigate} />,
    ];
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2.5 mb-6">
            <div className="w-5 h-5 rounded bg-brand-600 flex items-center justify-center">
              <Activity size={12} className="text-white" />
            </div>
            <span className="font-semibold text-zinc-100 text-sm">{APP_NAME}</span>
          </div>
          <h1 className="text-2xl font-semibold text-zinc-100 mb-1">Ersteinrichtung</h1>
          <p className="text-zinc-500 text-sm">Admin-Konto für Deltis einrichten</p>
        </div>

        <Steps current={step} steps={STEPS} />

        {renderStep[step]}
      </div>
    </div>
  );
}
