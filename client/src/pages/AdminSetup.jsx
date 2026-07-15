import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check, AlertTriangle, Database, Lock, ChevronRight, RefreshCw,
  ShieldAlert, SlidersHorizontal,
} from 'lucide-react';
import { APP_NAME } from '../config/branding';
import { DeltaMark } from '../components/Logo';
import api from '../utils/api';
import {
  Button, Field, Input, PasswordInput, Alert, Spinner,
} from '../components/ui';

// Step indicator

function Steps({ current, steps }) {
  return (
    <div className="flex items-center gap-1 mb-8">
      {steps.map((label, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold transition-colors ${
            i < current ? 'bg-brand-500 text-white' :
            i === current ? 'bg-brand-500 text-white ring-4 ring-brand-100' :
            'bg-paper-100 border border-paper-200 text-ink-400'
          }`}>
            {i < current ? <Check size={12} /> : i + 1}
          </div>
          <span className={`text-xs hidden sm:inline ${i === current ? 'text-ink-900 font-semibold' : 'text-ink-400'}`}>
            {label}
          </span>
          {i < steps.length - 1 && (
            <div className={`w-6 h-px mx-1 ${i < current ? 'bg-brand-400' : 'bg-paper-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// JWT secret + pepper fields shared by both config steps.
function SecurityFields({ jwtSecret, setJwtSecret, pepperFile, setPepperFile, passwordPepper, setPasswordPepper }) {
  return (
    <>
      <Field
        label={<><Lock size={12} className="inline mr-1" />JWT Secret</>}
        optional
        hint="Wenn leer: temporäres Zufalls-Secret — Sitzungen enden bei jedem Neustart. Wirksam erst nach Neustart des Servers."
      >
        <PasswordInput
          mono
          value={jwtSecret}
          onChange={e => setJwtSecret(e.target.value)}
          placeholder="openssl rand -base64 64"
        />
      </Field>

      <div className="space-y-3.5">
        <Alert tone="warning">
          Den Pepper <strong>vor dem ersten Nutzer-Login</strong> konfigurieren.
          Eine nachträgliche Änderung macht alle Passwörter ungültig.
          Wirksam erst nach Neustart.
        </Alert>

        <Field
          label="Pepper-Datei Pfad"
          hint="Pfad zu einer Datei außerhalb des App-Verzeichnisses. Sicherer als ein direkt gesetzter Wert."
        >
          <Input
            className="font-mono"
            value={pepperFile}
            onChange={e => setPepperFile(e.target.value)}
            placeholder="/etc/deltis/pepper.key"
          />
        </Field>

        <Field
          label="Pepper (direkt)"
          hint={pepperFile.trim() ? 'Deaktiviert wenn Pepper-Datei gesetzt.' : undefined}
        >
          <PasswordInput
            mono
            value={passwordPepper}
            onChange={e => setPasswordPepper(e.target.value)}
            placeholder="langer zufälliger Wert"
            disabled={!!pepperFile.trim()}
          />
        </Field>
      </div>
    </>
  );
}

// Warning card shown when the admin saved the config without any pepper.
function PepperWarningCard({ onBack, onContinue }) {
  return (
    <div className="card rounded-3xl p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
          <AlertTriangle size={18} className="text-red-500" />
        </div>
        <div>
          <h2 className="display text-lg mb-1">Kein Pepper konfiguriert!</h2>
          <p className="text-sm text-ink-500">
            Das Admin-Passwort wird <strong className="text-ink-900">ohne Pepper</strong> gehasht.
            Wenn du später einen Pepper hinzufügst, ist das Admin-Passwort nicht mehr gültig
            und du wirst ausgesperrt.
          </p>
        </div>
      </div>
      <Alert tone="error" title="Empfehlung: Konfiguriere jetzt einen Pepper, bevor du das Admin-Konto erstellst.">
        Generiere einen sicheren Pepper: <code>openssl rand -base64 48 {'>'} /etc/deltis/pepper.key</code>
      </Alert>
      <div className="flex gap-3">
        <Button className="flex-1" onClick={onBack}>
          <ChevronRight size={15} className="rotate-180" />
          Pepper jetzt setzen
        </Button>
        <Button variant="danger" className="flex-1" onClick={onContinue}>
          Trotzdem fortfahren
        </Button>
      </div>
    </div>
  );
}

// Step: Configuration
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
    <div className="card rounded-3xl p-6">
      <div className="flex items-center gap-2 mb-2">
        <HeaderIcon size={17} className="text-brand-500" />
        <h2 className="display text-lg">
          {withMongo ? 'Systemkonfiguration' : 'Sicherheitskonfiguration'}
        </h2>
      </div>

      <p className="text-xs text-ink-400 mb-5">
        Diese Werte werden in <code className="font-mono">/etc/deltis/deltis.config.json</code> gespeichert.
        .env-Variablen haben immer Vorrang.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        {withMongo && (
          <Field
            label={<><Database size={12} className="inline mr-1" />MongoDB URI</>}
            error={mongoError || undefined}
            hint="Ohne MongoDB URI kann der Server nicht vollständig starten. JWT-Secret und Pepper können aber bereits jetzt gespeichert werden."
          >
            <PasswordInput
              mono
              value={mongoUri}
              onChange={e => { setMongoUri(e.target.value); setMongoError(''); }}
              placeholder="mongodb://localhost:27017/habit_tracker"
              autoFocus
            />
          </Field>
        )}

        <SecurityFields
          jwtSecret={jwtSecret} setJwtSecret={setJwtSecret}
          pepperFile={pepperFile} setPepperFile={setPepperFile}
          passwordPepper={passwordPepper} setPasswordPepper={setPasswordPepper}
        />

        {error && (
          <Alert tone={error.includes('gespeichert') ? 'warning' : 'error'}>
            {error}
          </Alert>
        )}

        <Button
          type="submit"
          loading={submitting}
          icon={submitting ? undefined : ChevronRight}
          className="w-full !py-3"
        >
          {submitting
            ? (withMongo ? 'Verbinde …' : 'Speichere …')
            : (withMongo ? 'Speichern & verbinden' : 'Speichern & weiter')}
        </Button>
      </form>
    </div>
  );
}

// Step: Admin account

function StepAccount({ onDone }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
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
    <div className="card rounded-3xl p-6">
      <div className="flex items-center gap-2 mb-5">
        <ShieldAlert size={17} className="text-brand-500" />
        <h2 className="display text-lg">Admin-Konto erstellen</h2>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Benutzername">
          <Input
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="Mindestens 3 Zeichen"
            autoComplete="username"
            autoFocus
          />
        </Field>
        <Field label="Passwort">
          <PasswordInput
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Mindestens 8 Zeichen"
            autoComplete="new-password"
          />
        </Field>
        <Field label="Passwort bestätigen">
          <PasswordInput
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="Passwort wiederholen"
            autoComplete="new-password"
          />
        </Field>

        {error && <Alert tone="error">{error}</Alert>}

        <Button
          type="submit"
          loading={submitting}
          disabled={!username || !password || !confirm}
          className="w-full !py-3"
        >
          Weiter <ChevronRight size={16} />
        </Button>
      </form>
    </div>
  );
}

// Step: Done

function StepDone({ navigate }) {
  return (
    <div className="card rounded-3xl p-6 text-center space-y-4">
      <div className="w-12 h-12 bg-emerald-50 border border-emerald-200 rounded-full flex items-center justify-center mx-auto">
        <Check size={22} className="text-emerald-500" />
      </div>
      <div>
        <h2 className="display text-xl mb-1">Setup abgeschlossen!</h2>
        <p className="text-ink-500 text-sm">Melde dich jetzt mit deinem Benutzernamen und Passwort an.</p>
      </div>
      <div className="flex items-start gap-2 panel px-4 py-3 text-left">
        <SlidersHorizontal size={14} className="text-ocher-500 shrink-0 mt-0.5" />
        <p className="text-xs text-ink-500">
          JWT Secret und Pepper werden nach einem <strong className="text-ink-700">Server-Neustart</strong> aktiv.
          Weitere Einstellungen sind im <strong className="text-ink-700">Admin-Bereich</strong> verfügbar.
        </p>
      </div>
      <Button className="w-full !py-3" onClick={() => navigate('/login')}>
        Zur Anmeldung
      </Button>
    </div>
  );
}

// Main component

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
        <Spinner size="lg" />
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
            <DeltaMark size="sm" />
            <span className="font-display font-semibold text-ink-900">{APP_NAME}</span>
          </div>
          <h1 className="display text-3xl mb-1">Ersteinrichtung</h1>
          <p className="text-ink-400 text-sm">Admin-Konto für Deltis einrichten</p>
        </div>

        <Steps current={step} steps={STEPS} />

        {renderStep[step]}
      </div>
    </div>
  );
}
