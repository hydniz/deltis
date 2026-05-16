import { useState, useEffect, useCallback } from 'react';
import {
  SlidersHorizontal, AlertTriangle, Lock, Eye, EyeOff,
  RotateCcw, Save, CheckCircle, Info, AlertCircle,
} from 'lucide-react';
import api from '../utils/api';

// ── Source badge ──────────────────────────────────────────────────────────────

function SourceBadge({ source }) {
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

// ── Config entry row ──────────────────────────────────────────────────────────

function ConfigRow({ entry, onSave, onReset }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [error, setError] = useState('');

  const isEnvLocked = entry.source === 'env';
  const isEditable = entry.editable && !isEnvLocked;
  const isStatus = entry.type === 'status';

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
      await api.put(`/admin/config/${entry.key}`, { value: draft });
      setSaveOk(true);
      setEditing(false);
      onSave(entry.key, draft);
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
      await api.delete(`/admin/config/${entry.key}`);
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

// ── Main component ────────────────────────────────────────────────────────────

export default function AdminConfig() {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await api.get('/admin/config');
      setConfigs(res.data);
    } catch {
      setError('Konfiguration konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const handleSave = (key, value) => {
    setConfigs(prev => prev.map(c =>
      c.key === key ? { ...c, value, source: 'db', hasValue: true } : c
    ));
  };

  const handleReset = (key) => {
    // After reset, refetch so we get the correct source/value from server
    fetchConfigs();
  };

  // Group configs by their group field
  const groups = configs.reduce((acc, cfg) => {
    const g = cfg.group || 'Sonstige';
    if (!acc[g]) acc[g] = [];
    acc[g].push(cfg);
    return acc;
  }, {});

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <SlidersHorizontal size={20} className="text-amber-400" />
          Systemkonfiguration
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          Laufzeitkonfiguration des Servers
        </p>
      </div>

      {/* Env priority info */}
      <div className="flex items-start gap-3 bg-amber-500/8 border border-amber-500/20 rounded-xl px-4 py-3 mb-6">
        <Info size={16} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-300/80 space-y-0.5">
          <p className="font-medium text-amber-300">Priorität der Konfigurationsquellen</p>
          <p>
            <code className="font-mono text-xs bg-amber-900/30 px-1 rounded">.env</code> hat immer
            Vorrang vor der Datenbankeinstellung. Werte die in{' '}
            <code className="font-mono text-xs bg-amber-900/30 px-1 rounded">.env</code> /
            <code className="font-mono text-xs bg-amber-900/30 px-1 rounded">docker-compose.yml</code>{' '}
            gesetzt sind, können hier nicht überschrieben werden.
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-900/50 rounded-xl px-4 py-3 text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-zinc-700 border-t-amber-500 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groups).map(([groupName, entries]) => (
            <div key={groupName} className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 bg-slate-800/40">
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  {groupName}
                </h2>
              </div>
              <div className="divide-y divide-slate-800">
                {entries.map(entry => (
                  <ConfigRow
                    key={entry.key}
                    entry={entry}
                    onSave={handleSave}
                    onReset={handleReset}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
