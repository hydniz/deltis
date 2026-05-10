import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, UserPlus, Trash2, Copy, Check, X } from 'lucide-react';
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
      onClick={copy}
      className="ml-1 p-1 rounded text-slate-500 hover:text-slate-200 transition-colors"
      title="UUID kopieren"
    >
      {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
    </button>
  );
}

function NewUserModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(null);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/admin/users', { name: name.trim() || undefined });
      setCreated(res.data);
      onCreate(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Fehler beim Anlegen');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
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
              <label className="label">Name (optional)</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="input"
                placeholder="Wird automatisch gesetzt wenn leer"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
              />
            </div>
            {error && (
              <p className="text-red-400 text-sm">{error}</p>
            )}
            <div className="flex gap-3">
              <button onClick={onClose} className="btn-secondary flex-1">
                Abbrechen
              </button>
              <button
                onClick={handleCreate}
                disabled={loading}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : null}
                Anlegen
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-green-900/20 border border-green-700/50 rounded-xl p-4">
              <p className="text-green-400 text-sm font-medium mb-1">Nutzer erfolgreich angelegt!</p>
              <p className="text-slate-400 text-sm mb-3">
                Teile diese UUID mit <span className="text-white font-medium">{created.name}</span>:
              </p>
              <div className="flex items-center gap-2 bg-slate-900 rounded-lg px-3 py-2">
                <code className="text-brand-300 text-sm font-mono flex-1 break-all">{created.uuid}</code>
                <CopyButton text={created.uuid} />
              </div>
            </div>
            <button onClick={onClose} className="btn-primary w-full">
              Fertig
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Admin() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
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

  const handleCreate = (newUser) => {
    setUsers(prev => [...prev, newUser]);
  };

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
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ShieldCheck size={22} className="text-brand-400" />
          <div>
            <h1 className="text-xl font-bold text-white">Nutzerverwaltung</h1>
            <p className="text-slate-500 text-sm">{users.length} {users.length === 1 ? 'Nutzer' : 'Nutzer'} registriert</p>
          </div>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="btn-primary flex items-center gap-2"
        >
          <UserPlus size={16} />
          Neuer Nutzer
        </button>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-900/50 rounded-xl px-4 py-3 text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">UUID</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider hidden sm:table-cell">Erstellt</th>
                <th className="px-4 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {users.map(user => (
                <tr key={user._id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 bg-slate-700 rounded-full flex items-center justify-center text-xs font-semibold text-slate-300 shrink-0">
                        {user.name?.charAt(0)?.toUpperCase()}
                      </div>
                      <div>
                        <span className="text-sm text-slate-200">{user.name}</span>
                        {user.isAdmin && (
                          <span className="ml-2 text-xs bg-brand-900/60 text-brand-300 px-1.5 py-0.5 rounded-md border border-brand-700/50">
                            Admin
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center">
                      <code className="text-xs text-slate-400 font-mono">{user.uuid.slice(0, 8)}…</code>
                      <CopyButton text={user.uuid} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 hidden sm:table-cell">
                    {new Date(user.createdAt).toLocaleDateString('de-DE')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!user.isAdmin && (
                      <button
                        onClick={() => handleDelete(user)}
                        disabled={deletingId === user._id}
                        className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-50"
                        title="Nutzer löschen"
                      >
                        {deletingId === user._id
                          ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          : <Trash2 size={15} />
                        }
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <NewUserModal
          onClose={() => setShowModal(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}
