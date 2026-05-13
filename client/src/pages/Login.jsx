import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { APP_NAME, APP_SLOGAN } from '../config/branding';
import { Activity, AlertCircle, Eye, EyeOff } from 'lucide-react';

export default function Login() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 mb-5 shadow-2xl shadow-brand-900/50">
            <Activity size={28} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-1">
            <span className="bg-gradient-to-r from-brand-300 via-amber-200 to-orange-300 bg-clip-text text-transparent">
              {APP_NAME}
            </span>
          </h1>
          <p className="text-white/45 text-sm">{APP_SLOGAN}</p>
        </div>

        {/* Glass form card */}
        <div className="card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Benutzername</label>
              <input
                type="text"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                className="input"
                placeholder="Dein Benutzername"
                autoComplete="username"
                autoFocus
              />
            </div>

            <div>
              <label className="label">Passwort</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="input pr-10"
                  placeholder="Passwort"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="text-xs text-white/25 mt-1.5">
                Noch kein Passwort? Lass das Feld leer.
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-300 text-sm bg-red-500/10 border border-red-400/20 rounded-xl px-3 py-2.5">
                <AlertCircle size={14} className="flex-shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !identifier.trim()}
              className="btn-primary w-full py-2.5 flex items-center justify-center gap-2 mt-1"
            >
              {loading && (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              Anmelden
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
