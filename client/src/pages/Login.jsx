import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { APP_NAME, APP_SLOGAN } from '../config/branding';
import { DeltaMark } from '../components/Logo';
import { Button, Field, Input, PasswordInput, Alert } from '../components/ui';

export default function Login() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmedId = identifier.trim();
    if (!trimmedId) return;

    setLoading(true);
    setError('');
    try {
      await login(trimmedId, password || null);
      navigate('/dashboard');
    } catch (err) {
      const msg = err.response?.data?.error;
      const code = err.response?.data?.code;
      if (msg === 'Falsches Passwort') {
        setError('Falsches Passwort.');
      } else if (code === 'PASSWORD_REQUIRED' || msg === 'Passwort erforderlich') {
        setError('Bitte Passwort eingeben.');
      } else if (code === 'UUID_BLOCKED') {
        setError('Diese UUID ist gesperrt. Melde dich mit deinem Benutzernamen an.');
      } else {
        setError('Unbekannter Benutzername. Überprüfe deine Zugangsdaten.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden">
      {/* Soft halo behind the card */}
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div className="orb w-[22rem] h-[22rem] sm:w-[30rem] sm:h-[30rem] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white/80" />
        <div className="orb w-56 h-56 left-[10%] top-[10%] bg-brand-200/50" />
        <div className="orb w-56 h-56 right-[8%] bottom-[12%] bg-rose-200/45" />
      </div>

      <div className="relative w-full max-w-sm">

        {/* Branding */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-5">
            <DeltaMark size="lg" />
          </div>
          <h1 className="display text-4xl mb-1.5">{APP_NAME}</h1>
          <p className="text-ink-400 text-sm">{APP_SLOGAN}</p>
        </div>

        <div className="card rounded-3xl p-6 sm:p-7">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Benutzername">
              <Input
                type="text"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                placeholder="Dein Benutzername"
                autoComplete="username"
                autoFocus
              />
            </Field>

            <Field label="Passwort" hint="Noch kein Passwort? Lass das Feld leer.">
              <PasswordInput
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Passwort"
                autoComplete="current-password"
              />
            </Field>

            {error && <Alert tone="error">{error}</Alert>}

            <Button
              type="submit"
              loading={loading}
              disabled={!identifier.trim()}
              className="w-full !py-3 mt-1"
            >
              Anmelden
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
