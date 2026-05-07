import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import {
  Settings as SettingsIcon, Copy, Check, LogOut, User, Save
} from 'lucide-react';

// ─── Hauptseite ─────────────────────────────────────────────────────────────

export default function Settings() {
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();

  // Profil
  const [name, setName] = useState(user?.name || '');
  const [weightUnit, setWeightUnit] = useState(user?.weightUnit || 'kg');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.put('/auth/me', { name, weightUnit });
      updateUser(res.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      alert('Fehler beim Speichern: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const copyUuid = () => {
    navigator.clipboard.writeText(user?.uuid || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold text-white">Einstellungen</h1>
        <p className="text-slate-400 text-sm mt-0.5">Profil & Präferenzen</p>
      </div>

      {/* Profil */}
      <div className="card p-5">
        <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
          <User size={16} className="text-brand-400" />
          Profil
        </h2>
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Dein Name" />
          </div>
          <div>
            <label className="label">Gewichtseinheit</label>
            <select className="input" value={weightUnit} onChange={e => setWeightUnit(e.target.value)}>
              <option value="kg">Kilogramm (kg)</option>
              <option value="lbs">Pfund (lbs)</option>
            </select>
          </div>
          <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
            {saved ? <Check size={16} /> : <Save size={16} />}
            {saved ? 'Gespeichert!' : saving ? 'Speichern...' : 'Speichern'}
          </button>
        </form>
      </div>

      {/* UUID */}
      <div className="card p-5">
        <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
          <SettingsIcon size={16} className="text-brand-400" />
          Zugang
        </h2>
        <div>
          <label className="label">Deine UUID (Zugangscode)</label>
          <div className="flex gap-2">
            <input className="input font-mono text-sm" value={user?.uuid || ''} readOnly />
            <button onClick={copyUuid} className="btn-secondary px-3 flex-shrink-0 flex items-center gap-1.5">
              {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
              {copied ? 'Kopiert' : 'Kopieren'}
            </button>
          </div>
          <p className="text-xs text-slate-600 mt-1.5">
            Bewahre diese UUID sicher auf – sie ist dein einziger Zugangscode.
          </p>
        </div>
      </div>

      {/* Konto */}
      <div className="card p-5">
        <h2 className="font-semibold text-white mb-2">Konto</h2>
        <p className="text-sm text-slate-400 mb-4">
          Mitglied seit {user?.createdAt ? new Date(user.createdAt).toLocaleDateString('de-DE') : '–'}
        </p>
        <button onClick={handleLogout} className="flex items-center gap-2 text-red-400 hover:text-red-300 font-medium text-sm transition-colors">
          <LogOut size={16} />
          Abmelden
        </button>
      </div>
    </div>
  );
}
