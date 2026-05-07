import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Activity, KeyRound, AlertCircle } from 'lucide-react';

export default function Login() {
  const [uuid, setUuid] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = uuid.trim();
    if (!trimmed) return;

    setLoading(true);
    setError('');
    try {
      await login(trimmed);
      navigate('/');
    } catch {
      setError('Ungültige UUID. Überprüfe deine Zugangsdaten.');
    } finally {
      setLoading(false);
    }
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

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-900/20 border border-red-900/50 rounded-xl px-3 py-2">
                <AlertCircle size={15} />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !uuid.trim()}
              className="btn-primary w-full py-3 flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : null}
              Anmelden
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          Die UUID erhältst du vom Administrator der App.
        </p>
      </div>
    </div>
  );
}
