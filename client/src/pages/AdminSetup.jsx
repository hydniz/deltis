import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Copy, Check, Eye, EyeOff, AlertCircle, Activity } from 'lucide-react';
import { APP_NAME } from '../config/branding';
import api from '../utils/api';

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
    >
      {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
      {copied ? 'Kopiert!' : 'Kopieren'}
    </button>
  );
}

export default function AdminSetup() {
  const navigate = useNavigate();
  const [adminUuid, setAdminUuid] = useState(null);
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
        if (!res.data.setupNeeded) {
          navigate('/login', { replace: true });
        } else {
          setAdminUuid(res.data.adminUuid);
        }
      })
      .catch(() => navigate('/login', { replace: true }))
      .finally(() => setLoading(false));
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
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
      await api.post('/admin/setup', { password });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Setup fehlgeschlagen.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-600 rounded-2xl mb-5 shadow-lg shadow-brand-600/30">
            <Activity size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-1">{APP_NAME}</h1>
          <p className="text-slate-400 text-sm">Ersteinrichtung des Admin-Kontos</p>
        </div>

        {!done ? (
          <div className="card p-6 space-y-5">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck size={16} className="text-brand-400" />
                <h2 className="text-sm font-semibold text-slate-200">Deine Admin-UUID</h2>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                Speichere diese UUID – damit meldest du dich später an.
              </p>
              <div className="bg-slate-900 border border-slate-700 rounded-xl p-3">
                <code className="text-brand-300 text-sm font-mono break-all leading-relaxed">
                  {adminUuid}
                </code>
              </div>
              <div className="flex justify-end mt-2">
                <CopyButton text={adminUuid} />
              </div>
            </div>

            <div className="border-t border-slate-800" />

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Passwort setzen</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="input pr-10"
                    placeholder="Mindestens 8 Zeichen"
                    autoComplete="new-password"
                    autoFocus
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
                disabled={submitting || !password || !confirm}
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
                Melde dich jetzt mit deiner UUID und deinem Passwort an.
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
