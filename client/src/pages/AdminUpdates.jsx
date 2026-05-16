import { useState, useEffect, useRef, useCallback } from 'react';
import {
  RefreshCw, AlertTriangle, CheckCircle, Info, Package,
  GitBranch, ExternalLink, Loader2, Play,
} from 'lucide-react';
import api from '../utils/api';

// ── Channel selector ──────────────────────────────────────────────────────────

const CHANNELS = [
  {
    value: 'stable',
    label: 'Stable',
    description: 'Empfohlen – vollständig getestete Versionen (z.B. v1.2.3)',
    color: 'green',
  },
  {
    value: 'beta',
    label: 'Beta',
    description: 'Vorschau auf kommende Releases – weitgehend stabil (z.B. v1.2.3-beta)',
    color: 'blue',
  },
  {
    value: 'alpha',
    label: 'Alpha',
    description: 'Entwicklungsversionen – können instabil sein (z.B. v1.2.3-alpha)',
    color: 'orange',
  },
  {
    value: 'main',
    label: 'Main Branch',
    description: 'Neuester Entwicklungsstand – NICHT für Produktivsysteme empfohlen',
    color: 'red',
    warn: true,
  },
];

function ChannelBadge({ channel }) {
  const cfg = CHANNELS.find(c => c.value === channel) || CHANNELS[0];
  const colors = {
    green:  'bg-green-500/15 text-green-400 border-green-500/30',
    blue:   'bg-blue-500/15 text-blue-400 border-blue-500/30',
    orange: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    red:    'bg-red-500/15 text-red-400 border-red-500/30',
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${colors[cfg.color]}`}>
      {cfg.label}
    </span>
  );
}

// ── Update log ────────────────────────────────────────────────────────────────

function UpdateLog({ lines }) {
  const bottomRef = useRef(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  return (
    <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 h-56 overflow-y-auto font-mono text-xs">
      {lines.length === 0 && (
        <p className="text-slate-600 italic">Bereit.</p>
      )}
      {lines.map((line, i) => (
        <div
          key={i}
          className={`leading-5 whitespace-pre-wrap ${
            line.startsWith('✗') ? 'text-red-400' :
            line.startsWith('✓') ? 'text-green-400' :
            line.startsWith('⚠') ? 'text-amber-400' :
            line.startsWith('→') ? 'text-brand-300' :
            'text-slate-400'
          }`}
        >
          {line || ' '}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AdminUpdates() {
  const [status, setStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState('');

  const [selectedChannel, setSelectedChannel] = useState('stable');
  const [savingChannel, setSavingChannel] = useState(false);
  const [channelSaved, setChannelSaved] = useState(false);

  const [updateRunning, setUpdateRunning] = useState(false);
  const [logLines, setLogLines] = useState([]);
  const [starting, setStarting] = useState(false);
  const sseRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true);
    setStatusError('');
    try {
      const res = await api.get('/admin/update/status');
      setStatus(res.data);
      setSelectedChannel(res.data.channel || 'stable');
      setUpdateRunning(res.data.updateInProgress || false);
    } catch (err) {
      setStatusError(err.response?.data?.error || 'Status konnte nicht geladen werden.');
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // Subscribe to SSE log stream
  useEffect(() => {
    const es = new EventSource('/api/admin/update/stream', { withCredentials: true });
    sseRef.current = es;

    es.onmessage = (e) => {
      try {
        const { line } = JSON.parse(e.data);
        setLogLines(prev => [...prev, line]);
      } catch { /* ignore */ }
    };

    es.addEventListener('restart', () => {
      setUpdateRunning(true);
    });

    return () => es.close();
  }, []);

  const saveChannel = async (channel) => {
    setSavingChannel(true);
    try {
      await api.put('/admin/config/UPDATE_RELEASE_CHANNEL', { value: channel });
      setSelectedChannel(channel);
      setChannelSaved(true);
      setTimeout(() => setChannelSaved(false), 2000);
      await fetchStatus();
    } catch { /* ignore */ } finally {
      setSavingChannel(false);
    }
  };

  const startUpdate = async () => {
    setStarting(true);
    setLogLines([]);
    try {
      await api.post('/admin/update/start');
      setUpdateRunning(true);
    } catch (err) {
      alert(err.response?.data?.error || 'Update konnte nicht gestartet werden.');
    } finally {
      setStarting(false);
    }
  };

  const channelConfig = CHANNELS.find(c => c.value === selectedChannel) || CHANNELS[0];

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <RefreshCw size={20} className="text-amber-400" />
          Over-the-Air Updates
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          Neue Versionen von{' '}
          <a
            href="https://github.com/hydniz/deltis"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-400 hover:underline inline-flex items-center gap-0.5"
          >
            github.com/hydniz/deltis
            <ExternalLink size={11} />
          </a>
        </p>
      </div>

      {/* Docker anti-pattern warning */}
      {status?.inDocker && (
        <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-4">
          <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-300">Docker-Umgebung erkannt</p>
            <p className="text-sm text-amber-300/70">
              Du betreibst Deltis in einem Docker-Container. Das direkte Modifizieren von
              Container-Inhalten ist ein <strong>Anti-Pattern</strong> und wird bei jedem Neustart
              rückgängig gemacht.
            </p>
            <p className="text-sm text-amber-300/70">
              Der korrekte Weg zum Aktualisieren ist das <strong>Ersetzen des Docker-Images</strong>.
              Der Update-Button unten löst Watchtower aus, das genau das tut – er lädt das neue Image
              und startet den Container neu.
            </p>
          </div>
        </div>
      )}

      {/* Version info */}
      {loadingStatus ? (
        <div className="card p-6 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-slate-500" />
        </div>
      ) : statusError ? (
        <div className="card p-4 flex items-center gap-2 text-red-400 text-sm">
          <AlertTriangle size={16} />
          {statusError}
        </div>
      ) : status && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 bg-slate-800/40">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Package size={13} />
              Versionsinfo
            </h2>
          </div>
          <div className="divide-y divide-slate-800">
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-slate-400">Installiert</span>
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-white">v{status.currentVersion}</code>
                {status.currentCommit && (
                  <code className="text-xs font-mono text-slate-500">({status.currentCommit})</code>
                )}
              </div>
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-slate-400">
                Verfügbar <ChannelBadge channel={status.channel} />
              </span>
              <div className="flex items-center gap-2">
                {status.checkError ? (
                  <span className="text-xs text-red-400">{status.checkError}</span>
                ) : status.latest ? (
                  <>
                    <code className="text-sm font-mono text-white">
                      {status.channel === 'main'
                        ? status.latest.commitSha
                        : `v${status.latest.version}`}
                    </code>
                    {status.latest.releaseUrl && (
                      <a
                        href={status.latest.releaseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-400 hover:text-brand-300"
                      >
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-slate-600">—</span>
                )}
              </div>
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-slate-400">Status</span>
              <div>
                {status.updateAvailable === true && (
                  <span className="flex items-center gap-1.5 text-sm text-amber-400">
                    <AlertTriangle size={14} />
                    Update verfügbar
                  </span>
                )}
                {status.updateAvailable === false && (
                  <span className="flex items-center gap-1.5 text-sm text-green-400">
                    <CheckCircle size={14} />
                    Aktuell
                  </span>
                )}
                {status.updateAvailable === null && (
                  <span className="text-sm text-slate-500">Nicht bestimmbar</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Release channel selector */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-800/40">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <GitBranch size={13} />
            Release-Kanal
          </h2>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {CHANNELS.map(ch => (
              <button
                key={ch.value}
                onClick={() => saveChannel(ch.value)}
                disabled={savingChannel}
                className={`text-left px-3 py-3 rounded-xl border transition-all ${
                  selectedChannel === ch.value
                    ? ch.warn
                      ? 'bg-red-500/15 border-red-500/40 text-red-300'
                      : 'bg-brand-500/15 border-brand-500/40 text-brand-300'
                    : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold">{ch.label}</span>
                  {ch.warn && <AlertTriangle size={13} className="text-red-400" />}
                  {selectedChannel === ch.value && <CheckCircle size={13} className="text-brand-400" />}
                </div>
                <p className="text-xs opacity-70 leading-snug">{ch.description}</p>
              </button>
            ))}
          </div>

          {channelConfig.warn && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/25 rounded-xl px-3 py-3">
              <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300/80">
                Der Main-Branch enthält unveröffentlichten Code und kann Fehler oder
                Breaking Changes enthalten. Nicht für Produktivsysteme geeignet.
              </p>
            </div>
          )}

          {channelSaved && (
            <div className="flex items-center gap-2 text-xs text-green-400">
              <CheckCircle size={13} />
              Kanal gespeichert.
            </div>
          )}
        </div>
      </div>

      {/* Update action */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-800/40">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Update starten
          </h2>
        </div>
        <div className="p-4 space-y-4">
          {status?.inDocker ? (
            <div className="flex items-start gap-2 text-sm text-slate-400">
              <Info size={15} className="shrink-0 mt-0.5" />
              <span>
                Watchtower wird benachrichtigt, das neueste Docker-Image zu pullen und den
                Container bei Bedarf neu zu starten.
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-sm text-slate-400">
              <Info size={15} className="shrink-0 mt-0.5" />
              <span>
                Kein Docker-Container erkannt. Updates werden über das konfigurierte
                Watchtower-Setup ausgeführt.
              </span>
            </div>
          )}

          <button
            onClick={startUpdate}
            disabled={starting || updateRunning}
            className="btn-primary flex items-center gap-2 disabled:opacity-60"
          >
            {(starting || updateRunning)
              ? <Loader2 size={16} className="animate-spin" />
              : <Play size={16} />}
            {updateRunning ? 'Update läuft …' : 'Update starten'}
          </button>

          <UpdateLog lines={logLines} />

          <button
            onClick={fetchStatus}
            disabled={loadingStatus}
            className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw size={12} className={loadingStatus ? 'animate-spin' : ''} />
            Status aktualisieren
          </button>
        </div>
      </div>
    </div>
  );
}
