import { useState } from 'react';
import {
  AlertTriangle, Lock, Eye, EyeOff, RotateCcw, Save, CheckCircle, Info,
} from 'lucide-react';
import api from '../../utils/api';
import { Button, Input, Select, Alert, IconButton, Spinner } from '../ui';

// Source badge

export function SourceBadge({ source }) {
  if (source === 'env') {
    return (
      <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-ocher-100 text-ocher-700 border border-ocher-200 uppercase tracking-wide">
        <Lock size={8} />
        .env – gesperrt
      </span>
    );
  }
  if (source === 'db') {
    return (
      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand-50 text-brand-600 border border-brand-200 uppercase tracking-wide">
        Datenbank
      </span>
    );
  }
  if (source === 'file') {
    return (
      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sage-100 text-sage-700 border border-sage-200 uppercase tracking-wide">
        Konfigurationsdatei
      </span>
    );
  }
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-paper-100 text-ink-500 border border-paper-200 uppercase tracking-wide">
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
    <div className="border-b hairline last:border-0">
      <div className="px-4 py-4">
        <div className="flex items-start justify-between gap-3 mb-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-ink-800">{entry.label}</span>
            <SourceBadge source={entry.source} />
            {entry.restartRequired && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-ocher-100 text-ocher-700 border border-ocher-200">
                Neustart erforderlich
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {entry.type === 'password' && entry.hasValue && !isStatus && (
              <IconButton
                icon={showValue ? EyeOff : Eye}
                label={showValue ? 'Verbergen' : 'Anzeigen'}
                size={14}
                onClick={() => setShowValue(v => !v)}
              />
            )}
            {isEditable && !editing && (
              <Button variant="secondary" size="sm" onClick={startEdit}>
                Bearbeiten
              </Button>
            )}
            {isEditable && (entry.source === 'db' || entry.source === 'file') && !editing && (
              resetting
                ? <Spinner size="xs" />
                : <IconButton
                    icon={RotateCcw}
                    label="Auf Standard / .env zurücksetzen"
                    tone="brand"
                    size={14}
                    onClick={handleReset}
                  />
            )}
            {saveOk && <CheckCircle size={15} className="text-emerald-500" />}
          </div>
        </div>

        <p className="text-xs text-ink-400 mb-2">{entry.description}</p>

        {isEnvLocked && (
          <Alert tone="warning" className="mb-2 !py-2 !text-xs">
            Dieser Wert ist in der <code>.env</code> Datei festgelegt und hat Vorrang.
            Er kann nicht über die UI geändert werden.
          </Alert>
        )}

        {isBootstrap && !isEnvLocked && (
          <div className="flex items-start gap-2 text-xs text-sage-700 bg-sage-100/50 border border-sage-200 rounded-lg px-3 py-2 mb-2">
            <Info size={13} className="shrink-0 mt-0.5" />
            <span>
              Wird in <code className="font-mono">/etc/deltis/deltis.config.json</code> gespeichert.
              Ein <strong>Serverneustart</strong> ist erforderlich, damit die Änderung wirksam wird.
            </span>
          </div>
        )}

        {!editing ? (
          <div className="flex items-center gap-2">
            <code className={`text-xs font-mono px-2 py-1 rounded-md bg-paper-100 border border-paper-200 ${
              !entry.hasValue ? 'text-ink-300 italic' : 'text-ink-700'
            }`}>
              {displayValue()}
            </code>
          </div>
        ) : (
          <div className="space-y-2">
            {entry.type === 'select' ? (
              <Select
                value={draft}
                onChange={e => setDraft(e.target.value)}
                autoFocus
              >
                {(entry.options || []).map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </Select>
            ) : (
              <Input
                type={entry.type === 'password' ? 'text' : entry.type === 'number' ? 'number' : 'text'}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                className="font-mono"
                autoFocus
                placeholder={entry.default || ''}
              />
            )}

            {error && <Alert tone="error" className="!py-2 !text-xs">{error}</Alert>}

            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
                Abbrechen
              </Button>
              <Button size="sm" icon={Save} loading={saving} disabled={!draft.trim()} onClick={handleSave}>
                Speichern
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
