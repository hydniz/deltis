import { useState, useEffect } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import { APP_NAME } from '../config/branding';
import { DeltaMark } from '../components/Logo';
import ThemeToggle from '../components/ThemeToggle';
import { ArrowLeft, UserPlus } from 'lucide-react';
import { Button, Field, Input, PasswordInput, Alert, Spinner } from '../components/ui';

// Public self-registration. Only reachable when the admin enabled it —
// the server enforces the setting (and rate limits) on every attempt.
export default function Register() {
  const { user, register } = useAuth();
  const navigate = useNavigate();

  const [enabled, setEnabled] = useState(null); // null = checking
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/auth/registration-status')
      .then(res => setEnabled(!!res.data.enabled))
      .catch(() => setEnabled(false));
  }, []);

  if (user) return <Navigate to="/dashboard" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = username.trim();
    if (trimmed.length < 3) { setError('Benutzername muss mindestens 3 Zeichen lang sein.'); return; }
    if (password.length < 8) { setError('Passwort muss mindestens 8 Zeichen lang sein.'); return; }
    if (password !== confirm) { setError('Passwörter stimmen nicht überein.'); return; }

    setLoading(true);
    setError('');
    try {
      await register(trimmed, password, name.trim() || undefined);
      navigate('/dashboard'); // onboarding wizard takes over from here
    } catch (err) {
      setError(err.response?.data?.error || 'Registrierung fehlgeschlagen. Bitte erneut versuchen.');
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden">
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      {/* Soft halo behind the card */}
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div className="orb w-[22rem] h-[22rem] sm:w-[30rem] sm:h-[30rem] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white/80 dark:bg-brand-400/[.13]" />
        <div className="orb w-56 h-56 left-[10%] top-[10%] bg-sage-200/50" />
        <div className="orb w-56 h-56 right-[8%] bottom-[12%] bg-ocher-200/45" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-5">
            <DeltaMark size="lg" />
          </div>
          <h1 className="display text-4xl mb-1.5">{APP_NAME}</h1>
          <p className="text-ink-400 text-sm">Konto erstellen</p>
        </div>

        {enabled === null && (
          <div className="flex justify-center py-10">
            <Spinner size="md" />
          </div>
        )}

        {enabled === false && (
          <div className="card rounded-3xl p-6 sm:p-7 text-center space-y-4">
            <Alert tone="info">
              Die Selbstregistrierung ist deaktiviert. Bitte wende dich an den
              Administrator, um ein Konto zu erhalten.
            </Alert>
            <Link to="/login" className="btn-secondary inline-flex">
              <ArrowLeft size={15} />
              Zurück zur Anmeldung
            </Link>
          </div>
        )}

        {enabled === true && (
          <>
            <div className="card rounded-3xl p-6 sm:p-7">
              <form onSubmit={handleSubmit} className="space-y-4">
                <Field label="Benutzername">
                  <Input
                    type="text"
                    value={username}
                    onChange={e => { setUsername(e.target.value); setError(''); }}
                    placeholder="Mindestens 3 Zeichen (a–z, 0–9, .-_)"
                    autoFocus
                    autoComplete="username"
                    minLength={3}
                    maxLength={30}
                    required
                  />
                </Field>
                <Field label="Name" hint="Optional – so begrüßt dich Deltis.">
                  <Input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Dein Anzeigename"
                    maxLength={60}
                  />
                </Field>
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
                    value={confirm}
                    onChange={e => { setConfirm(e.target.value); setError(''); }}
                    placeholder="Passwort wiederholen"
                    autoComplete="new-password"
                  />
                </Field>

                {error && <Alert tone="error">{error}</Alert>}

                <Button
                  type="submit"
                  icon={UserPlus}
                  loading={loading}
                  className="w-full"
                  disabled={username.trim().length < 3 || password.length < 8 || password !== confirm}
                >
                  Konto erstellen
                </Button>
              </form>
            </div>

            <p className="text-center text-sm text-ink-500 mt-5">
              Schon ein Konto?{' '}
              <Link to="/login" className="font-semibold text-brand-600 hover:text-brand-700 transition-colors">
                Anmelden
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
