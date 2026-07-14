import { useState, useEffect, useRef, useCallback } from 'react';
import {
  RefreshCw, AlertTriangle, CheckCircle, Info, Package,
  GitBranch, ExternalLink, Loader2, Play, Undo2, Database,
  Container, Terminal, Server, ShieldCheck, Settings2,
} from 'lucide-react';
import api from '../utils/api';
import AdminPageHeader from '../components/admin/AdminPageHeader';
import SectionCard from '../components/admin/SectionCard';
import ErrorBanner from '../components/admin/ErrorBanner';
import ConfigRow from '../components/admin/ConfigRow';

// Update-mode descriptions

const MODES = {
  'docker-socket': {
    icon: Container,
    tone: 'green',
    title: 'Docker mit voller Kontrolle',
    text: 'Der Docker-Socket ist eingebunden. Updates laufen vollautomatisch: '
      + 'Backup → neues Image pullen → Container tauschen. Schlägt etwas fehl, '
      + 'wird die alte Version automatisch wiederhergestellt.',
    canUpdate: true,
  },
  'docker-manual': {
    icon: Terminal,
    tone: 'amber',
    title: 'Docker ohne Kontrolle',
    text: 'Die App läuft in Docker, hat aber keinen Zugriff auf den Docker-Socket. '
      + 'Das Update muss manuell auf dem Host durchgeführt werden:',
    canUpdate: false,
  },
  host: {
    icon: Server,
    tone: 'slate',
    title: 'Host-Installation',
    text: 'Die App läuft direkt auf dem Host. Updates laufen über Git: '
      + 'Backup → Checkout der Zielversion → Neuinstallation → Neustart. '
      + 'Bei Fehlern wird automatisch die vorherige Version wiederhergestellt.',
    canUpdate: true,
  },
};

const TONE_CLASSES = {
  green: 'bg-green-500/10 border-green-500/30 text-green-300',
  amber: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
  slate: 'bg-slate-500/10 border-slate-500/30 text-slate-300',
};

function ModePanel({ mode, dockerImage }) {
  const cfg = MODES[mode];
  if (!cfg) return null;
  const Icon = cfg.icon;
  return (
    <div className={`flex items-start gap-3 border rounded-xl px-4 py-4 ${TONE_CLASSES[cfg.tone]}`}>
      <Icon size={18} className="shrink-0 mt-0.5" />
      <div className="space-y-2 min-w-0">
        <p className="text-sm font-semibold">{cfg.title}</p>
        <p className="text-sm opacity-80">{cfg.text}</p>
        {mode === 'docker-manual' && (
          <pre className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-xs font-mono text-slate-300 overflow-x-auto">
{`docker pull ${dockerImage || 'hydniz/deltis:latest'}
cd <deltis-verzeichnis>   # dort liegt docker-compose.yml
./backup.sh               # Datensicherung vor dem Update!
docker compose up -d --no-build --force-recreate`}
          </pre>
        )}
      </div>
    </div>
  );
}

// Failed-update / rollback panel

function RollbackPanel({ updateState, onRollback, rollbackRunning }) {
  if (!updateState || updateState.phase !== 'failed') return null;
  return (
    <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-4 space-y-3">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
        <div className="space-y-1 min-w-0">
          <p className="text-sm font-semibold text-red-300">Letztes Update fehlgeschlagen</p>
          {updateState.error && (
            <p className="text-sm text-red-300/80 break-words">{updateState.error}</p>
          )}
          <p className="text-sm text-red-300/70">
            {updateState.recovered
              ? 'Die vorherige Version wurde automatisch wiederhergestellt und läuft.'
              : 'Automatische Wiederherstellung war nicht möglich – bitte Rollback starten.'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {updateState.rollbackAvailable && (
          <button
            onClick={() => onRollback(false)}
            disabled={rollbackRunning}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-red-500/20 border border-red-500/40 text-red-200 hover:bg-red-500/30 disabled:opacity-60 transition-colors"
          >
            {rollbackRunning ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
            Rollback (nur App)
          </button>
        )}
        {updateState.backupFile && (
          <button
            onClick={() => onRollback(true)}
            disabled={rollbackRunning}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-red-500/20 border border-red-500/40 text-red-200 hover:bg-red-500/30 disabled:opacity-60 transition-colors"
          >
            {rollbackRunning ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
            Rollback + Datenbank wiederherstellen
          </button>
        )}
      </div>
      <p className="text-xs text-red-300/60">
        „+ Datenbank" spielt die Sicherung von vor dem Update zurück – Änderungen
        seit dem Update gehen dabei verloren.
      </p>
    </div>
  );
}

// Channel selector

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

// Update log

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
          {line || ' '}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

// Main component

export default function AdminUpdates() {
  const [status, setStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState('');

  const [selectedChannel, setSelectedChannel] = useState('stable');
  const [savingChannel, setSavingChannel] = useState(false);
  const [channelSaved, setChannelSaved] = useState(false);

  // OTA settings (repo URL, branch, docker image) come from the shared config
  // API – the release channel has its own selector and is excluded here.
  const [otaConfigs, setOtaConfigs] = useState([]);

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

  const fetchOtaConfigs = useCallback(async () => {
    try {
      const res = await api.get('/admin/config');
      setOtaConfigs(res.data.filter(c =>
        c.group === 'OTA Update' && c.key !== 'UPDATE_RELEASE_CHANNEL'
      ));
    } catch { /* settings card is best-effort – status card shows errors */ }
  }, []);

  useEffect(() => { fetchStatus(); fetchOtaConfigs(); }, [fetchStatus, fetchOtaConfigs]);

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

  const handleConfigSave = async (key, value, source) => {
    setOtaConfigs(prev => prev.map(c =>
      c.key === key ? { ...c, value, source, hasValue: true } : c
    ));
    await fetchStatus();
  };

  const handleConfigReset = async () => {
    await fetchOtaConfigs();
    await fetchStatus();
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

  const [rollbackRunning, setRollbackRunning] = useState(false);
  const startRollback = async (restoreDb) => {
    const warning = restoreDb
      ? 'Rollback inklusive Datenbank-Wiederherstellung starten?\n\nAlle Änderungen seit dem letzten Update gehen verloren!'
      : 'Rollback auf die vorherige Version starten?';
    if (!window.confirm(warning)) return;
    setRollbackRunning(true);
    setLogLines([]);
    try {
      await api.post('/admin/update/rollback', { restoreDb });
      setUpdateRunning(true);
    } catch (err) {
      alert(err.response?.data?.error || 'Rollback konnte nicht gestartet werden.');
    } finally {
      setRollbackRunning(false);
    }
  };

  const channelConfig = CHANNELS.find(c => c.value === selectedChannel) || CHANNELS[0];
  const modeConfig = MODES[status?.mode] || null;
  const notConfigured = status && status.configured === false;

  // Hide settings that do not apply to the current runtime environment
  // (context 'docker' only in Docker, 'host' only on host installations).
  // While the status is still loading, context-bound entries stay hidden.
  const visibleOtaConfigs = otaConfigs.filter(c => {
    if (!c.context) return true;
    if (!status) return false;
    return c.context === 'docker' ? status.inDocker : !status.inDocker;
  });

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <AdminPageHeader
        icon={RefreshCw}
        title="Updates (OTA)"
        description={
          status?.repoUrl ? (
            <>
              Neue Versionen von{' '}
              <a
                href={status.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-400 hover:underline inline-flex items-center gap-0.5"
              >
                {status.repoUrl.replace(/^https?:\/\//, '')}
                <ExternalLink size={11} />
              </a>
            </>
          ) : 'In-App-Updates direkt aus dem GitHub-Repository'
        }
      />

      {/* Environment / update mode */}
      {status?.mode && <ModePanel mode={status.mode} dockerImage={status.dockerImage} />}

      {/* Failed update → rollback offer */}
      <RollbackPanel
        updateState={status?.updateState}
        onRollback={startRollback}
        rollbackRunning={rollbackRunning || updateRunning}
      />

      {/* Last update succeeded */}
      {status?.updateState?.phase === 'success' && (
        <div className="flex items-center gap-2.5 bg-green-500/10 border border-green-500/25 rounded-xl px-4 py-3">
          <ShieldCheck size={16} className="text-green-400 shrink-0" />
          <p className="text-sm text-green-300/90">
            Letztes Update erfolgreich
            {status.updateState.fromVersion && status.updateState.toVersion && (
              <> ({status.updateState.fromVersion} → {status.updateState.toVersion})</>
            )}
            . Migrationen abgeschlossen.
          </p>
        </div>
      )}

      {/* Repo not configured yet → point to the settings card below */}
      {notConfigured && (
        <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-3">
          <Info size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-300/90">
            Es ist noch kein GitHub-Repository konfiguriert. Trage unter{' '}
            <strong>Einstellungen</strong> (unten) eine Repository-URL ein,
            damit nach Updates gesucht werden kann.
          </p>
        </div>
      )}

      {/* Version info */}
      {loadingStatus ? (
        <div className="card p-6 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-slate-500" />
        </div>
      ) : statusError ? (
        <ErrorBanner message={statusError} />
      ) : status && (
        <SectionCard icon={Package} title="Versionsinfo">
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
        </SectionCard>
      )}

      {/* Release channel selector – single source of truth for the channel */}
      <SectionCard icon={GitBranch} title="Release-Kanal">
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
      </SectionCard>

      {/* Update action */}
      <SectionCard icon={Play} title="Update starten">
        <div className="p-4 space-y-4">
          <div className="flex items-start gap-2 text-sm text-slate-400">
            <Info size={15} className="shrink-0 mt-0.5" />
            <span>
              Vor jedem Update wird automatisch eine Datensicherung erstellt.
              Schlägt die Sicherung fehl, wird das Update <strong>nicht</strong> durchgeführt.
              Jeder Schritt wird protokolliert (Log unten und in <code>backups/update-logs/</code>).
            </span>
          </div>

          {modeConfig?.canUpdate === false ? (
            <div className="flex items-start gap-2 text-sm text-amber-400">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <span>
                In dieser Umgebung ist kein automatisches Update möglich –
                bitte die manuelle Anleitung oben verwenden.
              </span>
            </div>
          ) : (
            <button
              onClick={startUpdate}
              disabled={starting || updateRunning || rollbackRunning || notConfigured}
              className="btn-primary flex items-center gap-2 disabled:opacity-60"
            >
              {(starting || updateRunning)
                ? <Loader2 size={16} className="animate-spin" />
                : <Play size={16} />}
              {updateRunning ? 'Update läuft …' : 'Update starten'}
            </button>
          )}

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
      </SectionCard>

      {/* OTA settings – moved here from the system configuration page so
          everything update-related lives on one page */}
      {visibleOtaConfigs.length > 0 && (
        <SectionCard icon={Settings2} title="Einstellungen">
          <div className="divide-y divide-slate-800">
            {visibleOtaConfigs.map(entry => (
              <ConfigRow
                key={entry.key}
                entry={entry}
                onSave={handleConfigSave}
                onReset={handleConfigReset}
              />
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
