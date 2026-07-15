import { useState, useEffect, useCallback } from 'react';
import {
  Users, UserPlus, Trash2, Pencil, AtSign, Lock, Shield,
} from 'lucide-react';
import api from '../utils/api';
import AdminPageHeader from '../components/admin/AdminPageHeader';
import AdminSpinner from '../components/admin/AdminSpinner';
import ErrorBanner from '../components/admin/ErrorBanner';
import {
  Button, Field, Input, PasswordInput, Alert, Modal, Toggle, IconButton, Spinner,
} from '../components/ui';

// Create modal

function NewUserModal({ onClose, onCreate }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
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
    <Modal
      onClose={onClose}
      title="Neuen Nutzer anlegen"
      icon={UserPlus}
      footer={!created ? (
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>Abbrechen</Button>
          <Button className="flex-1" loading={loading} disabled={!canSubmit} onClick={handleCreate}>
            Anlegen
          </Button>
        </>
      ) : (
        <Button className="w-full" onClick={onClose}>Fertig</Button>
      )}
    >
      {!created ? (
        <div className="space-y-4">
          <Field label={<><AtSign size={12} className="inline mr-1" />Benutzername</>}>
            <Input
              value={username}
              onChange={e => { setUsername(e.target.value); setError(''); }}
              placeholder="Mindestens 3 Zeichen"
              autoFocus
              autoComplete="off"
            />
          </Field>
          <Field label="Name" optional>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Anzeigename – wird Benutzername wenn leer"
            />
          </Field>
          <Field
            label={<><Lock size={12} className="inline mr-1" />Temporäres Passwort</>}
            hint="Der Nutzer muss das Passwort beim ersten Login ändern."
          >
            <PasswordInput
              value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              placeholder="Mindestens 8 Zeichen"
              autoComplete="new-password"
            />
          </Field>

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <Toggle value={isAdmin} onChange={setIsAdmin} label="Admin-Konto" />
            <span className="text-sm text-ink-700 font-medium flex items-center gap-1.5">
              <Shield size={13} className={isAdmin ? 'text-ocher-500' : 'text-ink-300'} />
              Admin-Konto
            </span>
          </label>

          {error && <Alert tone="error">{error}</Alert>}
        </div>
      ) : (
        <Alert tone="success" title={`${created.isAdmin ? 'Admin-Konto' : 'Nutzer'} erfolgreich angelegt!`}>
          <p className="text-sm mt-1">
            Zugangsdaten für <span className="font-semibold">{created.name}</span>:
          </p>
          <div className="bg-surface border border-emerald-200 rounded-lg px-3 py-2 my-2">
            <p className="text-xs text-ink-400">Benutzername</p>
            <code className="text-brand-600 text-sm font-mono">{created.username}</code>
          </div>
          {created.isAdmin && (
            <p className="text-xs">
              Admin-Login: Benutzername eingeben → „Als Admin anmelden" aktivieren.
            </p>
          )}
          <p className="text-xs text-ocher-700 mt-1">
            Das Passwort muss beim ersten Login geändert werden.
          </p>
        </Alert>
      )}
    </Modal>
  );
}

// Edit modal

function EditUserModal({ user, onClose, onSave }) {
  const [username, setUsername] = useState(user.username || '');
  const [name, setName] = useState(user.name || '');
  const [password, setPassword] = useState('');
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
    <Modal
      onClose={onClose}
      title="Nutzer bearbeiten"
      subtitle={user.isAdmin ? 'Admin-Konto' : undefined}
      icon={Pencil}
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>Abbrechen</Button>
          <Button className="flex-1" loading={loading} disabled={!canSubmit} onClick={handleSave}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={<><AtSign size={12} className="inline mr-1" />Benutzername</>}>
          <Input
            value={username}
            onChange={e => { setUsername(e.target.value); setError(''); }}
            autoFocus
            autoComplete="off"
          />
        </Field>
        <Field label="Name">
          <Input value={name} onChange={e => setName(e.target.value)} />
        </Field>
        <Field
          label={<><Lock size={12} className="inline mr-1" />Neues temporäres Passwort</>}
          error={password.length > 0 && password.length < 8 ? 'Mindestens 8 Zeichen' : undefined}
          hint={password.length >= 8 ? 'Nutzer muss Passwort beim nächsten Login ändern.' : undefined}
        >
          <PasswordInput
            value={password}
            onChange={e => { setPassword(e.target.value); setError(''); }}
            placeholder="Leer lassen = Passwort unverändert"
            autoComplete="new-password"
          />
        </Field>

        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

// Main component

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
    <div>
      <AdminPageHeader
        icon={Users}
        title="Nutzerverwaltung"
        description={`${users.length} Nutzer registriert`}
        action={
          <Button icon={UserPlus} onClick={() => setShowCreateModal(true)}>
            <span className="hidden sm:inline">Neuer Nutzer</span>
          </Button>
        }
      />

      <ErrorBanner message={error} />

      {loading ? (
        <AdminSpinner />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b hairline bg-paper-50">
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-ink-400 uppercase tracking-[0.09em]">Nutzer</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-ink-400 uppercase tracking-[0.09em] hidden sm:table-cell">Erstellt</th>
                <th className="px-4 py-3 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--surface-border)]">
              {users.map(user => (
                <tr key={user._id} className="hover:bg-paper-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 bg-paper-100 border border-paper-200 rounded-full flex items-center justify-center text-xs font-semibold text-ink-600 shrink-0">
                        {(user.username || user.name)?.charAt(0)?.toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-ink-800">{user.name}</span>
                          {user.isAdmin && (
                            <span className="text-[10px] font-semibold bg-ocher-100 text-ocher-700 px-1.5 py-0.5 rounded-md border border-ocher-200 flex items-center gap-1">
                              <Shield size={10} />
                              Admin
                            </span>
                          )}
                          {user.mustChangePassword && (
                            <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-md border border-amber-200">
                              PW ändern
                            </span>
                          )}
                        </div>
                        {user.username && (
                          <span className="text-xs text-ink-400 font-mono">@{user.username}</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-400 hidden sm:table-cell">
                    {new Date(user.createdAt).toLocaleDateString('de-DE')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-0.5">
                      <IconButton
                        icon={Pencil}
                        label="Bearbeiten"
                        tone="brand"
                        size={15}
                        onClick={() => setEditingUser(user)}
                      />
                      {deletingId === user._id
                        ? <Spinner size="xs" className="mx-1.5" />
                        : <IconButton
                            icon={Trash2}
                            label="Löschen"
                            tone="danger"
                            size={15}
                            onClick={() => handleDelete(user)}
                          />}
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
