import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Activity, KeyRound, ShieldCheck, AlertCircle, Eye, EyeOff } from 'lucide-react';

export default function Login() {
  const [uuid, setUuid] = useState('');
  const [adminSecret, setAdminSecret] = useState('');
  const [isAdminLogin, setIsAdminLogin] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmedUuid = uuid.trim();
    if (!trimmedUuid) return;
    if (isAdminLogin && !adminSecret.trim()) return;

    setLoading(true);
    setError('');
    try {
      await login(trimmedUuid, isAdminLogin ? adminSecret.trim() : null);
      navigate('/');
    } catch (err) {
      const msg = err.response?.data?.error;
      if (msg === 'Admin-Secret erforderlich' || msg === 'Falsches Admin-Secret') {
        setError('Falsches Admin-Secret.');
      } else {
        setError('Ungültige UUID. Überprüfe deine Zugangsdaten.');
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleAdminMode = () => {
    setIsAdminLogin(v => !v);
    setAdminSecret('');
    setError('');
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-600 rounded-2xl mb-5 shadow-lg shadow-brand-600/30">
            <Activity size={28} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Habit Tracker</h1>
          <p className="text-slate-400">Gib deine persönliche UUID ein</p>
        </div>

        <div className="card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">
                <KeyRound size={14} className="inline mr-1" />
                Deine UUID
              </label>
              <input
                type="text"
                value={uuid}
                onChange={e => setUuid(e.target.value)}
                className="input font-mono text-sm"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                autoComplete="off"
                autoFocus
              />
            </div>

            {isAdminLogin && (
              <div>
                <label className="label">
                  <ShieldCheck size={14} className="inline mr-1" />
                  Admin-Secret
                </label>
                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={adminSecret}
                    onChange={e => setAdminSecret(e.target.value)}
                    className="input pr-10"
                    placeholder="Admin-Secret eingeben"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                    tabIndex={-1}
                  >
                    {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-900/20 border border-red-900/50 rounded-xl px-3 py-2">
                <AlertCircle size={15} />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !uuid.trim() || (isAdminLogin && !adminSecret.trim())}
              className="btn-primary w-full py-3 flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : null}
              Anmelden
            </button>
          </form>
        </div>

        <div className="text-center mt-4">
          <button
            type="button"
            onClick={toggleAdminMode}
            className={`text-xs transition-colors ${
              isAdminLogin
                ? 'text-brand-400 hover:text-brand-300'
                : 'text-slate-600 hover:text-slate-400'
            }`}
          >
            {isAdminLogin ? '← Normale Anmeldung' : 'Als Admin anmelden'}
          </button>
        </div>
      </div>
    </div>
  );
}
