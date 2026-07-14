import { useState } from 'react';
import {
  AlertTriangle, Lock, Eye, EyeOff, RotateCcw, Save,
  CheckCircle, Info, AlertCircle,
} from 'lucide-react';
import api from '../../utils/api';

// Source badge

export function SourceBadge({ source }) {
  if (source === 'env') {
    return (
      <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 uppercase tracking-wide">
        <Lock size={8} />
        .env – gesperrt
      </span>
    );
  }
  if (source === 'db') {
    return (
      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand-500/15 text-brand-400 border border-brand-500/30 uppercase tracking-wide">
        Datenbank
      </span>
    );
  }
  if (source === 'file') {
    return (
      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30 uppercase tracking-wide">
        Konfigurationsdatei
      </span>
    );
  }
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-700 text-slate-400 border border-slate-600 uppercase tracking-wide">
      Standard
    </span>
  );
}

// Config entry row
// Shared between AdminConfig (Server/Sicherheit groups) and AdminUpdates
// (OTA settings) so config entries look and behave identically everywhere.

export default function ConfigRow({ entry, onSave, onReset }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [error, setError] = useState('');

  const isEnvLocked = entry.source === 'env';
  // Bootstrap keys (e.g. MONGODB_URI) use a dedicated route instead of the
  // standard config PUT. They show as editable in the UI even though
  // `entry.editable` is false (to protect the standard route from tests/misuse).
  const isBootstrap = Boolean(entry.bootstrap);
  const isEditable = (entry.editable || isBootstrap) && !isEnvLocked;
  const isStatus = entry.type === 'status';

  const endpoint = isBootstrap
    ? `/admin/config/bootstrap/${entry.key}`
    : `/admin/config/${entry.key}`;

  const startEdit = () => {
    setDraft(entry.value || '');
    setEditing(true);
    setError('');
    setSaveOk(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await api.put(endpoint, { value: draft });
      setSaveOk(true);
      setEditing(false);
      onSave(entry.key, draft, isBootstrap ? 'file' : 'db');
      setTimeout(() => setSaveOk(false), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    setError('');
    try {
      await api.delete(endpoint);
      setEditing(false);
      onReset(entry.key);
    } catch (err) {
      setError(err.response?.data?.error || 'Zurücksetzen fehlgeschlagen.');
    } finally {
      setResetting(false);
    }
  };

  const displayValue = () => {
    if (isStatus) return entry.hasValue ? '••••••••' : 'Nicht gesetzt';
    if (!entry.hasValue && !entry.value) return 'Nicht gesetzt';
    if (entry.type === 'password' && !showValue) return '••••••••';
    return entry.value || '—';
  };

  return (
    <div className="border-b border-slate-800 last:border-0">
      <div className="px-4 py-4">
        <div className="flex items-start justify-between gap-3 mb-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white">{entry.label}</span>
            <SourceBadge source={entry.source} />
            {entry.restartRequired && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-900/40 text-orange-400 border border-orange-700/40">
                Neustart erforderlich
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {entry.type === 'password' && entry.hasValue && !isStatus && (
              <button
                onClick={() => setShowValue(v => !v)}
                className="p-1.5 rounded-lg text-slate-600 hover:text-slate-300 transition-colors"
                title={showValue ? 'Verbergen' : 'Anzeigen'}
              >
                {showValue ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            )}
            {isEditable && !editing && (
              <button
                onClick={startEdit}
                className="text-xs px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white transition-colors"
              >
                Bearbeiten
              </button>
            )}
            {isEditable && (entry.source === 'db' || entry.source === 'file') && !editing && (
              <button
                onClick={handleReset}
                disabled={resetting}
                className="p-1.5 rounded-lg text-slate-600 hover:text-amber-400 hover:bg-amber-900/20 transition-colors"
                title="Auf Standard / .env zurücksetzen"
              >
                {resetting
                  ? <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  : <RotateCcw size={14} />}
              </button>
            )}
            {saveOk && <CheckCircle size={15} className="text-green-400" />}
          </div>
        </div>

        <p className="text-xs text-slate-500 mb-2">{entry.description}</p>

        {isEnvLocked && (
          <div className="flex items-start gap-2 text-xs text-amber-400/80 bg-amber-500/5 border border-amber-500/15 rounded-lg px-3 py-2 mb-2">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span>
              Dieser Wert ist in der <code className="font-mono">.env</code> Datei festgelegt und hat Vorrang.
              Er kann nicht über die UI geändert werden.
            </span>
          </div>
        )}

        {isBootstrap && !isEnvLocked && (
          <div className="flex items-start gap-2 text-xs text-blue-400/80 bg-blue-500/5 border border-blue-500/15 rounded-lg px-3 py-2 mb-2">
            <Info size={13} className="shrink-0 mt-0.5" />
            <span>
              Wird in <code className="font-mono">/etc/deltis/deltis.config.json</code> gespeichert.
              Ein <strong>Serverneustart</strong> ist erforderlich, damit die Änderung wirksam wird.
            </span>
          </div>
        )}

        {!editing ? (
          <div className="flex items-center gap-2">
            <code className={`text-xs font-mono px-2 py-1 rounded bg-slate-900 ${
              !entry.hasValue ? 'text-slate-600 italic' : 'text-slate-300'
            }`}>
              {displayValue()}
            </code>
          </div>
        ) : (
          <div className="space-y-2">
            {entry.type === 'select' ? (
              <select
                value={draft}
                onChange={e => setDraft(e.target.value)}
                className="input text-sm"
                autoFocus
              >
                {(entry.options || []).map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : (
              <input
                type={entry.type === 'password' ? 'text' : entry.type === 'number' ? 'number' : 'text'}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                className="input text-sm font-mono"
                autoFocus
                placeholder={entry.default || ''}
              />
            )}

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-xs bg-red-900/20 border border-red-900/50 rounded-lg px-3 py-2">
                <AlertCircle size={12} />
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setEditing(false)}
                className="btn-secondary text-xs py-1.5 px-3"
              >
                Abbrechen
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !draft.trim()}
                className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5"
              >
                {saving
                  ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Save size={12} />}
                Speichern
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
