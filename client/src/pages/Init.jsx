import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check, ChevronRight, ChevronLeft, Database, Lock, ShieldCheck,
  Sparkles, SlidersHorizontal, UserRound, Wand2, PartyPopper,
} from 'lucide-react';
import { APP_NAME, APP_SLOGAN } from '../config/branding';
import { DeltaMark } from '../components/Logo';
import ThemeToggle from '../components/ThemeToggle';
import api from '../utils/api';
import {
  Button, Field, Input, Select, PasswordInput, Alert, Spinner,
} from '../components/ui';

// Cryptographically random base64 secret for the one-click generate buttons.
function generateSecret(bytes = 48) {
  const arr = new Uint8Array(bytes);
  window.crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr));
}

// Decorative layers

// Floating blurred colour orbs behind the wizard card.
function OrbBackdrop() {
  return (
    <div aria-hidden="true" className="absolute inset-0 pointer-events-none overflow-hidden">
      <div className="orb anim-float w-72 h-72 sm:w-96 sm:h-96 -left-20 -top-16 bg-brand-200/60" />
      <div className="orb anim-float w-64 h-64 sm:w-80 sm:h-80 -right-16 top-1/4 bg-rose-200/50" style={{ animationDelay: '-2.4s' }} />
      <div className="orb anim-float w-60 h-60 sm:w-72 sm:h-72 left-[10%] -bottom-20 bg-ocher-200/60" style={{ animationDelay: '-4.1s' }} />
      <div className="orb anim-float w-52 h-52 sm:w-64 sm:h-64 right-[16%] -bottom-10 bg-sage-200/50" style={{ animationDelay: '-5.6s' }} />
    </div>
  );
}

// One-shot confetti rain for the final step (pure CSS, no dependencies).
const CONFETTI_COLORS = [
  'rgb(var(--c-brand-400))', 'rgb(var(--c-brand-500))', 'rgb(var(--c-sage-400))',
  'rgb(var(--c-ocher-400))', 'rgb(var(--c-rose-400))', 'rgb(var(--c-emerald-400))',
];

function ConfettiRain({ count = 48 }) {
  // Random layout per mount is intentional — every install party looks unique.
  const pieces = useMemo(() => (
    Array.from({ length: count }, (_, i) => ({
      left: `${Math.random() * 100}%`,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: `${Math.random() * 0.9}s`,
      duration: `${2.6 + Math.random() * 1.8}s`,
      drift: `${(Math.random() - 0.5) * 160}px`,
      spin: `${360 + Math.random() * 540}deg`,
      // The falling animation owns `transform`, so size variety comes from
      // width/height instead of an (overridden) inline scale.
      width: `${Math.round(6 + Math.random() * 5)}px`,
      height: `${Math.round(10 + Math.random() * 8)}px`,
    }))
  ), [count]);

  return (
    <div aria-hidden="true" className="fixed inset-0 pointer-events-none overflow-hidden z-10">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: p.left,
            backgroundColor: p.color,
            animationDelay: p.delay,
            animationDuration: p.duration,
            width: p.width,
            height: p.height,
            '--confetti-drift': p.drift,
            '--confetti-spin': p.spin,
          }}
        />
      ))}
    </div>
  );
}

// Step indicator with animated progress line.
function StepRail({ steps, current }) {
  const progress = steps.length > 1 ? (current / (steps.length - 1)) * 100 : 0;
  return (
    <div className="mb-8">
      <div className="relative h-1 rounded-full bg-paper-200 mb-3 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-brand-500 transition-all duration-700 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex justify-between">
        {steps.map((s, i) => (
          <div key={s.id} className="flex items-center gap-1.5">
            <div className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold transition-all duration-300 ${
              i < current ? 'bg-brand-500 text-white' :
              i === current ? 'bg-brand-500 text-white ring-4 ring-brand-100 scale-110' :
              'bg-paper-100 border border-paper-200 text-ink-400'
            }`}>
              {i < current ? <Check size={10} /> : i + 1}
            </div>
            <span className={`text-[11px] hidden sm:inline transition-colors ${i === current ? 'text-ink-900 font-semibold' : 'text-ink-400'}`}>
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Steps

function StepWelcome({ onNext, backupsPresent }) {
  return (
    <div className="card rounded-3xl p-8 text-center space-y-6">
      <div className="anim-pop inline-flex">
        <div className="anim-float">
          <DeltaMark size="lg" />
        </div>
      </div>
      <div>
        <h2 className="display text-3xl mb-2 anim-fade-up">Willkommen bei {APP_NAME}!</h2>
        <p className="text-ink-500 text-sm leading-relaxed max-w-sm mx-auto anim-fade-up" style={{ animationDelay: '90ms' }}>
          Deine Instanz ist startklar. In wenigen Schritten richtest du dein
          Admin-Konto ein und passt die Grundeinstellungen an.
        </p>
      </div>
      {backupsPresent && (
        <Alert tone="warning" title="Backups gefunden – lief hier schon eine Instanz?" className="text-left anim-fade-up">
          Die Datenbank ist leer, aber im Backup-Verzeichnis dieses Servers liegen
          Datenbank-Backups. Wenn hier bereits eine {APP_NAME}-Instanz lief, brich die
          Einrichtung ab und stelle zuerst ein Backup wieder her
          (<code className="font-mono">./restore.sh</code>) — durch eine Neueinrichtung
          werden die alten Daten nicht übernommen.
        </Alert>
      )}
      <div className="grid grid-cols-3 gap-3 text-left anim-fade-up" style={{ animationDelay: '180ms' }}>
        {[
          { icon: ShieldCheck, label: 'Sicherheit' },
          { icon: UserRound, label: 'Admin-Konto' },
          { icon: SlidersHorizontal, label: 'Einstellungen' },
        ].map(({ icon: Icon, label }, i) => (
          <div key={label} className="panel px-3 py-3 flex flex-col items-center gap-1.5 anim-pop" style={{ animationDelay: `${240 + i * 90}ms` }}>
            <Icon size={16} className="text-brand-500" />
            <span className="text-[11px] text-ink-500 font-medium">{label}</span>
          </div>
        ))}
      </div>
      <Button onClick={onNext} className="w-full !py-3 anim-fade-up" style={{ animationDelay: '380ms' }}>
        Los geht&rsquo;s <Sparkles size={15} />
      </Button>
    </div>
  );
}

// Only shown while the server has no MongoDB connection (setup mode).
function StepDatabase({ onDone }) {
  const [uri, setUri] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = uri.trim();
    if (!trimmed.startsWith('mongodb://') && !trimmed.startsWith('mongodb+srv://')) {
      setError('Muss mit mongodb:// oder mongodb+srv:// beginnen.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await api.post('/admin/setup/bootstrap', { mongodb_uri: trimmed });
      if (res.data.setupMode) {
        setError('Konfiguration gespeichert, aber MongoDB ist nicht erreichbar. Bitte URI prüfen.');
        return;
      }
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'Verbindung fehlgeschlagen.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card rounded-3xl p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Database size={17} className="text-brand-500" />
        <h2 className="display text-lg">Datenbank verbinden</h2>
      </div>
      <p className="text-xs text-ink-400">
        Es besteht noch keine Verbindung zu MongoDB. Die URI wird in{' '}
        <code className="font-mono">/etc/deltis/deltis.config.json</code> gespeichert;
        .env-Variablen haben immer Vorrang.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="MongoDB URI" error={error || undefined}>
          <PasswordInput
            mono
            value={uri}
            onChange={e => { setUri(e.target.value); setError(''); }}
            placeholder="mongodb://localhost:27017/deltis"
            autoFocus
          />
        </Field>
        <Button type="submit" loading={submitting} disabled={!uri.trim()} className="w-full !py-3">
          {submitting ? 'Verbinde …' : <>Verbinden &amp; weiter <ChevronRight size={15} /></>}
        </Button>
      </form>
    </div>
  );
}

// JWT secret + pepper. Values already provided via .env are shown as locked.
function StepSecurity({ status, onDone, onBack }) {
  const [jwtSecret, setJwtSecret] = useState('');
  const [pepper, setPepper] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const needsJwt = !status.jwtConfigured;
  const needsPepper = !status.pepperConfigured;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        ...(needsJwt && jwtSecret.trim() ? { jwt_secret: jwtSecret.trim() } : {}),
        ...(needsPepper && pepper.trim() ? { password_pepper: pepper.trim() } : {}),
      };
      if (Object.keys(payload).length > 0) {
        await api.post('/admin/setup/security-config', payload);
      }
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'Speichern fehlgeschlagen.');
    } finally {
      setSubmitting(false);
    }
  };

  const generateInto = (setter) => () => setter(generateSecret());

  return (
    <div className="card rounded-3xl p-6 space-y-5">
      <div className="flex items-center gap-2">
        <ShieldCheck size={17} className="text-brand-500" />
        <h2 className="display text-lg">Sicherheit</h2>
      </div>

      {needsPepper && (
        <Alert tone="warning">
          Der Pepper wird <strong>jetzt, vor dem Admin-Konto</strong> gesetzt und darf
          danach nie mehr geändert werden — sonst werden alle Passwörter ungültig.
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {needsJwt ? (
          <Field
            label="JWT Secret"
            optional
            hint="Signiert Login-Sitzungen. Wenn leer: Zufalls-Secret pro Serverstart — alle Sitzungen enden bei jedem Neustart. Wird nach einem Neustart aktiv."
          >
            <div className="flex gap-2">
              <div className="flex-1">
                <PasswordInput
                  mono
                  value={jwtSecret}
                  onChange={e => setJwtSecret(e.target.value)}
                  placeholder="Leer lassen oder generieren"
                />
              </div>
              <Button type="button" variant="secondary" onClick={generateInto(setJwtSecret)} title="Sicheres Secret generieren">
                <Wand2 size={15} />
              </Button>
            </div>
          </Field>
        ) : (
          <LockedRow label="JWT Secret" note="Bereits über .env oder Konfigurationsdatei festgelegt." />
        )}

        {needsPepper ? (
          <Field
            label="Pepper"
            optional
            hint="Zusätzliches Geheimnis für das Passwort-Hashing. Alternativ per PEPPER_FILE in .env setzen — Datei-Pfade sind noch sicherer."
          >
            <div className="flex gap-2">
              <div className="flex-1">
                <PasswordInput
                  mono
                  value={pepper}
                  onChange={e => setPepper(e.target.value)}
                  placeholder="Leer lassen oder generieren"
                />
              </div>
              <Button type="button" variant="secondary" onClick={generateInto(setPepper)} title="Sicheren Pepper generieren">
                <Wand2 size={15} />
              </Button>
            </div>
          </Field>
        ) : (
          <LockedRow label="Pepper" note="Bereits über .env oder Konfigurationsdatei festgelegt." />
        )}

        {error && <Alert tone="error">{error}</Alert>}

        <WizardNav onBack={onBack} submitting={submitting} label="Weiter" />
      </form>
    </div>
  );
}

function StepAccount({ account, setAccount, onDone, onBack }) {
  const [error, setError] = useState('');
  const set = (field) => (e) => { setAccount(a => ({ ...a, [field]: e.target.value })); setError(''); };

  const handleSubmit = (e) => {
    e.preventDefault();
    const username = account.username.trim().toLowerCase();
    if (username.length < 3 || username.length > 30) {
      setError('Benutzername muss 3–30 Zeichen lang sein.');
      return;
    }
    if (!/^[a-z0-9_.\-]+$/.test(username)) {
      setError('Benutzername darf nur Buchstaben, Zahlen, Punkte, Bindestriche und Unterstriche enthalten.');
      return;
    }
    if (account.password.length < 8) {
      setError('Passwort muss mindestens 8 Zeichen lang sein.');
      return;
    }
    if (account.password !== account.confirm) {
      setError('Passwörter stimmen nicht überein.');
      return;
    }
    onDone();
  };

  return (
    <div className="card rounded-3xl p-6 space-y-5">
      <div className="flex items-center gap-2">
        <UserRound size={17} className="text-brand-500" />
        <h2 className="display text-lg">Admin-Konto erstellen</h2>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Benutzername">
          <Input
            value={account.username}
            onChange={set('username')}
            placeholder="Mindestens 3 Zeichen (a–z, 0–9, .-_)"
            autoComplete="username"
            autoFocus
            maxLength={30}
          />
        </Field>
        <Field label="Anzeigename" optional>
          <Input
            value={account.name}
            onChange={set('name')}
            placeholder="Wie sollen wir dich nennen?"
            maxLength={60}
          />
        </Field>
        <Field label="Passwort">
          <PasswordInput
            value={account.password}
            onChange={set('password')}
            placeholder="Mindestens 8 Zeichen"
            autoComplete="new-password"
          />
        </Field>
        <Field label="Passwort bestätigen">
          <PasswordInput
            value={account.confirm}
            onChange={set('confirm')}
            placeholder="Passwort wiederholen"
            autoComplete="new-password"
          />
        </Field>

        {error && <Alert tone="error">{error}</Alert>}

        <WizardNav
          onBack={onBack}
          label="Weiter"
          disabled={!account.username.trim() || account.password.length < 8 || account.password !== account.confirm}
        />
      </form>
    </div>
  );
}

// All non-bootstrap settings, grouped. Locked entries (env-managed or
// system-managed) are visible but not editable.
function StepSettings({ settings, values, setValues, onSubmit, onBack, submitting, error }) {
  const groups = useMemo(() => {
    const byGroup = new Map();
    for (const s of settings) {
      if (!byGroup.has(s.group)) byGroup.set(s.group, []);
      byGroup.get(s.group).push(s);
    }
    return [...byGroup.entries()];
  }, [settings]);

  const setValue = (key) => (e) => setValues(v => ({ ...v, [key]: e.target.value }));

  return (
    <div className="card rounded-3xl p-6 space-y-5">
      <div className="flex items-center gap-2">
        <SlidersHorizontal size={17} className="text-brand-500" />
        <h2 className="display text-lg">Einstellungen</h2>
      </div>
      <p className="text-xs text-ink-400">
        Alles später im Admin-Bereich änderbar. Gesperrte Werte sind über{' '}
        <code className="font-mono">.env</code> festgelegt und haben Vorrang.
      </p>

      <form onSubmit={onSubmit} className="space-y-6">
        {groups.map(([group, entries], gi) => (
          <fieldset key={group} className="space-y-3.5 anim-fade-up" style={{ animationDelay: `${gi * 80}ms` }}>
            <legend className="text-[11px] uppercase tracking-[0.14em] font-semibold text-ink-400">{group}</legend>
            {entries.map((s) => (
              s.locked ? (
                <LockedRow key={s.key} label={s.label} note={
                  s.lockedReason === 'env' ? 'Über .env festgelegt.' : 'Systemverwaltet.'
                } value={s.value} />
              ) : (
                <Field key={s.key} label={s.label} hint={s.description}>
                  {s.type === 'select' ? (
                    <Select value={values[s.key] ?? ''} onChange={setValue(s.key)}>
                      {s.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </Select>
                  ) : (
                    <Input
                      type={s.type === 'number' ? 'number' : 'text'}
                      value={values[s.key] ?? ''}
                      onChange={setValue(s.key)}
                      placeholder={s.default || ''}
                    />
                  )}
                </Field>
              )
            ))}
          </fieldset>
        ))}

        {error && <Alert tone="error">{error}</Alert>}

        <WizardNav onBack={onBack} submitting={submitting} label="Einrichtung abschließen" />
      </form>
    </div>
  );
}

function StepDone({ result, account }) {
  return (
    <>
      <ConfettiRain />
      <div className="card rounded-3xl p-8 text-center space-y-5 relative">
        <div className="anim-pop w-14 h-14 bg-emerald-50 border border-emerald-200 rounded-full flex items-center justify-center mx-auto">
          <PartyPopper size={24} className="text-emerald-500" />
        </div>
        <div>
          <h2 className="display text-2xl mb-1.5 anim-fade-up">Alles bereit{account.name ? `, ${account.name}` : ''}!</h2>
          <p className="text-ink-500 text-sm anim-fade-up" style={{ animationDelay: '90ms' }}>
            Dein Admin-Konto wurde erstellt und du bist bereits angemeldet.
          </p>
        </div>

        {result?.restartRequired && (
          <Alert tone="warning">
            Mindestens eine Einstellung wird erst nach einem <strong>Server-Neustart</strong> wirksam.
          </Alert>
        )}
        {result?.skipped?.length > 0 && (
          <p className="text-xs text-ink-400 anim-fade-up" style={{ animationDelay: '160ms' }}>
            Übersprungen (über .env festgelegt): {result.skipped.join(', ')}
          </p>
        )}

        <Button
          className="w-full !py-3 anim-fade-up"
          style={{ animationDelay: '240ms' }}
          onClick={() => { window.location.href = '/dashboard'; }}
        >
          Zur App <ChevronRight size={15} />
        </Button>
      </div>
    </>
  );
}

// Shared bits

function LockedRow({ label, note, value }) {
  return (
    <div className="panel px-4 py-3 flex items-start gap-2.5">
      <Lock size={13} className="text-ink-400 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-700">
          {label}
          {value ? <span className="ml-2 font-mono text-xs text-ink-400 break-all">{value}</span> : null}
        </p>
        <p className="text-xs text-ink-400">{note}</p>
      </div>
    </div>
  );
}

function WizardNav({ onBack, submitting = false, disabled = false, label }) {
  return (
    <div className="flex gap-3">
      {onBack && (
        <Button type="button" variant="secondary" onClick={onBack} disabled={submitting}>
          <ChevronLeft size={15} /> Zurück
        </Button>
      )}
      <Button type="submit" loading={submitting} disabled={disabled} className="flex-1 !py-3">
        {label} {!submitting && <ChevronRight size={15} />}
      </Button>
    </div>
  );
}

// Main component

export default function Init() {
  const navigate = useNavigate();
  const [status, setStatus] = useState(null); // null = loading
  const [stepIdx, setStepIdx] = useState(0);
  const [account, setAccount] = useState({ username: '', name: '', password: '', confirm: '' });
  const [values, setValues] = useState({});
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const loadStatus = () => api.get('/init/status').then(res => {
    if (!res.data.initNeeded) {
      navigate('/login', { replace: true });
      return null;
    }
    setStatus(res.data);
    // Prefill editable settings with their effective value (or default).
    setValues(prev => {
      const next = { ...prev };
      for (const s of res.data.settings || []) {
        if (!s.locked && next[s.key] === undefined) next[s.key] = s.value ?? s.default ?? '';
      }
      return next;
    });
    return res.data;
  });

  useEffect(() => {
    loadStatus().catch(() => navigate('/login', { replace: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Step list depends on the server state: the database step only appears in
  // setup mode, the security step only while JWT secret or pepper are missing.
  const steps = useMemo(() => {
    if (!status) return [];
    return [
      { id: 'welcome', label: 'Willkommen' },
      ...(status.setupMode ? [{ id: 'database', label: 'Datenbank' }] : []),
      ...(!status.jwtConfigured || !status.pepperConfigured ? [{ id: 'security', label: 'Sicherheit' }] : []),
      { id: 'account', label: 'Konto' },
      { id: 'settings', label: 'Einstellungen' },
      { id: 'done', label: 'Fertig' },
    ];
  }, [status]);

  // OTA settings are runtime-specific: a Docker-only setting (the update image)
  // is meaningless on a host install and vice versa. Hide the ones that do not
  // apply to this environment — same rule the Updates admin page uses. Until the
  // status has loaded, context-bound entries stay hidden.
  const visibleSettings = useMemo(() => {
    const list = status?.settings || [];
    return list.filter(s => {
      if (!s.context) return true;
      return s.context === 'docker' ? status.inDocker : !status.inDocker;
    });
  }, [status]);

  if (!status) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const step = steps[Math.min(stepIdx, steps.length - 1)];
  const next = () => { setSubmitError(''); setStepIdx(i => Math.min(i + 1, steps.length - 1)); };
  const back = () => { setSubmitError(''); setStepIdx(i => Math.max(i - 1, 0)); };

  // Database connected → the settings list may have changed, reload it.
  const handleDatabaseDone = async () => {
    try { await loadStatus(); } catch { /* keep current status */ }
    next();
  };

  // Final submit: admin account + all unlocked settings in one call.
  const handleFinish = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError('');
    try {
      const settings = {};
      for (const s of visibleSettings) {
        if (!s.locked && values[s.key] !== undefined && String(values[s.key]).trim() !== '') {
          settings[s.key] = String(values[s.key]).trim();
        }
      }
      const res = await api.post('/init', {
        username: account.username.trim().toLowerCase(),
        password: account.password,
        name: account.name.trim() || undefined,
        settings,
      });
      setResult(res.data);
      next();
    } catch (err) {
      setSubmitError(err.response?.data?.error || 'Einrichtung fehlgeschlagen.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-x-hidden">
      <OrbBackdrop />

      <header className="relative flex items-center justify-between px-5 sm:px-8 py-5 max-w-2xl mx-auto w-full">
        <div className="flex items-center gap-2.5">
          <DeltaMark size="sm" />
          <span className="font-display font-semibold text-ink-900">{APP_NAME}</span>
        </div>
        <ThemeToggle />
      </header>

      <main className="relative flex items-start justify-center px-4 pb-16 pt-4 sm:pt-10">
        <div className="w-full max-w-md">
          {step.id !== 'welcome' && step.id !== 'done' && (
            <>
              <div className="text-center mb-6">
                <h1 className="display text-2xl mb-0.5">Ersteinrichtung</h1>
                <p className="text-ink-400 text-xs">{APP_SLOGAN}</p>
              </div>
              <StepRail steps={steps} current={stepIdx} />
            </>
          )}

          {/* key={step.id} re-triggers the entrance animation on every step change */}
          <div key={step.id} className="anim-fade-up">
            {step.id === 'welcome' && <StepWelcome onNext={next} backupsPresent={!!status.backupsPresent} />}
            {step.id === 'database' && <StepDatabase onDone={handleDatabaseDone} />}
            {step.id === 'security' && <StepSecurity status={status} onDone={next} onBack={back} />}
            {step.id === 'account' && (
              <StepAccount account={account} setAccount={setAccount} onDone={next} onBack={back} />
            )}
            {step.id === 'settings' && (
              <StepSettings
                settings={visibleSettings}
                values={values}
                setValues={setValues}
                onSubmit={handleFinish}
                onBack={back}
                submitting={submitting}
                error={submitError}
              />
            )}
            {step.id === 'done' && <StepDone result={result} account={account} />}
          </div>
        </div>
      </main>
    </div>
  );
}
