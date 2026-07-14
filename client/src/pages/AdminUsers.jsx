import { useState, useEffect, useCallback } from 'react';
import {
  Users, UserPlus, Trash2, X, Pencil, AlertCircle, Eye, EyeOff, Lock, AtSign, Shield
} from 'lucide-react';
import api from '../utils/api';
import AdminPageHeader from '../components/admin/AdminPageHeader';
import AdminSpinner from '../components/admin/AdminSpinner';
import ErrorBanner from '../components/admin/ErrorBanner';

// ── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ value, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 focus:outline-none ${value ? 'bg-brand-600' : 'bg-slate-700'}`}
    >
      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

// ── Create modal ──────────────────────────────────────────────────────────────

function NewUserModal({ onClose, onCreate }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);

  const handleCreate = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/admin/users', {
        username: username.trim(),
        password,
        name: name.trim() || undefined,
        isAdmin,
      });
      setCreated(res.data);
      onCreate(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Fehler beim Anlegen.');
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = username.trim().length >= 3 && password.length >= 8 && !loading;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="card p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <UserPlus size={18} className="text-brand-400" />
            Neuen Nutzer anlegen
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors">
            <X size={20} />
          </button>
        </div>

        {!created ? (
          <div className="space-y-4">
            <div>
              <label className="label">
                <AtSign size={13} className="inline mr-1" />
                Benutzername
              </label>
              <input
                type="text"
                value={username}
                onChange={e => { setUsername(e.target.value); setError(''); }}
                className="input"
                placeholder="Mindestens 3 Zeichen"
                autoFocus
                autoComplete="off"
              />
            </div>
            <div>
              <label className="label">Name (optional)</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="input"
                placeholder="Anzeigename – wird Benutzername wenn leer"
              />
            </div>
            <div>
              <label className="label">
                <Lock size={13} className="inline mr-1" />
                Temporäres Passwort
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(''); }}
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
              <p className="text-xs text-slate-600 mt-1">
                Der Nutzer muss das Passwort beim ersten Login ändern.
              </p>
            </div>

            <label className="flex items-center gap-3 cursor-pointer select-none">
              <Toggle value={isAdmin} onChange={setIsAdmin} />
              <span className="text-sm text-slate-300 flex items-center gap-1.5">
                <Shield size={13} className={isAdmin ? 'text-brand-400' : 'text-slate-500'} />
                Admin-Konto
              </span>
            </label>

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-900/20 border border-red-900/50 rounded-xl px-3 py-2">
                <AlertCircle size={14} />
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
              <button
                onClick={handleCreate}
                disabled={!canSubmit}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Anlegen
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-green-900/20 border border-green-700/50 rounded-xl p-4 space-y-2">
              <p className="text-green-400 text-sm font-medium">
                {created.isAdmin ? 'Admin-Konto' : 'Nutzer'} erfolgreich angelegt!
              </p>
              <p className="text-slate-400 text-sm">
                Zugangsdaten für <span className="text-white font-medium">{created.name}</span>:
              </p>
              <div className="bg-slate-900 rounded-lg px-3 py-2 space-y-1">
                <p className="text-xs text-slate-500">Benutzername</p>
                <code className="text-brand-300 text-sm font-mono">{created.username}</code>
              </div>
              {created.isAdmin && (
                <p className="text-xs text-brand-400">
                  Admin-Login: Benutzername eingeben → "Als Admin anmelden" aktivieren.
                </p>
              )}
              <p className="text-xs text-amber-400">
                Das Passwort muss beim ersten Login geändert werden.
              </p>
            </div>
            <button onClick={onClose} className="btn-primary w-full">Fertig</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Edit modal ────────────────────────────────────────────────────────────────

function EditUserModal({ user, onClose, onSave }) {
  const [username, setUsername] = useState(user.username || '');
  const [name, setName] = useState(user.name || '');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setLoading(true);
    setError('');
    try {
      const body = {};
      if (username.trim() !== user.username) body.username = username.trim();
      if (name.trim() !== user.name) body.name = name.trim();
      if (password) body.password = password;

      if (Object.keys(body).length === 0) { onClose(); return; }

      const res = await api.put(`/admin/users/${user._id}`, body);
      onSave(res.data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Fehler beim Speichern.');
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = username.trim().length >= 3 && (!password || password.length >= 8) && !loading;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="card p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Pencil size={16} className="text-brand-400" />
            Nutzer bearbeiten
            {user.isAdmin && <Shield size={14} className="text-brand-400" />}
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">
              <AtSign size={13} className="inline mr-1" />
              Benutzername
            </label>
            <input
              type="text"
              value={username}
              onChange={e => { setUsername(e.target.value); setError(''); }}
              className="input"
              autoFocus
              autoComplete="off"
            />
          </div>
          <div>
            <label className="label">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label">
              <Lock size={13} className="inline mr-1" />
              Neues temporäres Passwort
            </label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                className="input pr-10"
                placeholder="Leer lassen = Passwort unverändert"
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
            {password.length > 0 && password.length < 8 && (
              <p className="text-xs text-amber-400 mt-1">Mindestens 8 Zeichen</p>
            )}
            {password.length >= 8 && (
              <p className="text-xs text-amber-400 mt-1">
                Nutzer muss Passwort beim nächsten Login ändern.
              </p>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm bg-red-900/20 border border-red-900/50 rounded-xl px-3 py-2">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
            <button
              onClick={handleSave}
              disabled={!canSubmit}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Speichern
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState('');

  const fetchUsers = useCallback(async () => {
    try {
      const res = await api.get('/admin/users');
      setUsers(res.data);
    } catch {
      setError('Nutzer konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleCreate = (newUser) => setUsers(prev => [...prev, newUser]);

  const handleSave = (updated) =>
    setUsers(prev => prev.map(u => u._id === updated._id ? { ...u, ...updated } : u));

  const handleDelete = async (user) => {
    if (!confirm(`Nutzer "${user.name}" wirklich löschen?\nAlle Daten gehen verloren.`)) return;
    setDeletingId(user._id);
    try {
      await api.delete(`/admin/users/${user._id}`);
      setUsers(prev => prev.filter(u => u._id !== user._id));
    } catch (err) {
      alert(err.response?.data?.error || 'Löschen fehlgeschlagen.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <AdminPageHeader
        icon={Users}
        title="Nutzerverwaltung"
        description={`${users.length} Nutzer registriert`}
        action={
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2"
          >
            <UserPlus size={16} />
            Neuer Nutzer
          </button>
        }
      />

      <ErrorBanner message={error} />

      {loading ? (
        <AdminSpinner />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Nutzer</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider hidden sm:table-cell">Erstellt</th>
                <th className="px-4 py-3 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {users.map(user => (
                <tr key={user._id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 bg-slate-700 rounded-full flex items-center justify-center text-xs font-semibold text-slate-300 shrink-0">
                        {(user.username || user.name)?.charAt(0)?.toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-slate-200">{user.name}</span>
                          {user.isAdmin && (
                            <span className="text-xs bg-brand-900/60 text-brand-300 px-1.5 py-0.5 rounded-md border border-brand-700/50 flex items-center gap-1">
                              <Shield size={10} />
                              Admin
                            </span>
                          )}
                          {user.mustChangePassword && (
                            <span className="text-xs bg-amber-900/40 text-amber-400 px-1.5 py-0.5 rounded-md border border-amber-700/40">
                              PW ändern
                            </span>
                          )}
                        </div>
                        {user.username && (
                          <span className="text-xs text-slate-500 font-mono">@{user.username}</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 hidden sm:table-cell">
                    {new Date(user.createdAt).toLocaleDateString('de-DE')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setEditingUser(user)}
                        className="p-1.5 rounded-lg text-slate-600 hover:text-brand-400 hover:bg-brand-900/20 transition-colors"
                        title="Bearbeiten"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => handleDelete(user)}
                        disabled={deletingId === user._id}
                        className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-50"
                        title="Löschen"
                      >
                        {deletingId === user._id
                          ? <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          : <Trash2 size={15} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreateModal && (
        <NewUserModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreate}
        />
      )}
      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
