import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Eye, EyeOff, AlertCircle, Activity } from 'lucide-react';
import { APP_NAME } from '../config/branding';
import api from '../utils/api';

export default function AdminSetup() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.get('/admin/setup-status')
      .then(res => {
        if (!res.data.setupNeeded) navigate('/login', { replace: true });
      })
      .catch(() => navigate('/login', { replace: true }))
      .finally(() => setLoading(false));
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (username.length < 3) {
      setError('Benutzername muss mindestens 3 Zeichen haben.');
      return;
    }
    if (password.length < 8) {
      setError('Passwort muss mindestens 8 Zeichen haben.');
      return;
    }
    if (password !== confirm) {
      setError('Passwörter stimmen nicht überein.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.post('/admin/setup', { username, password });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Setup fehlgeschlagen.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-brand-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2.5 mb-6">
            <div className="w-5 h-5 rounded bg-brand-600 flex items-center justify-center">
              <Activity size={12} className="text-white" />
            </div>
            <span className="font-semibold text-zinc-100 text-sm">{APP_NAME}</span>
          </div>
          <h1 className="text-2xl font-semibold text-zinc-100 mb-1">Admin einrichten</h1>
          <p className="text-zinc-500 text-sm">Ersteinrichtung des Admin-Kontos</p>
        </div>

        {!done ? (
          <div className="card p-6">
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
                {submitting
                  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : null}
                Setup abschließen
              </button>
            </form>
          </div>
        ) : (
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
            <button
              onClick={() => navigate('/login')}
              className="btn-primary w-full py-3"
            >
              Zur Anmeldung
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
