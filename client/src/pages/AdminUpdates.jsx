import { useState, useEffect, useRef, useCallback } from 'react';
import {
  RefreshCw, AlertTriangle, CheckCircle, Info, Package,
  GitBranch, ExternalLink, Loader2, Play, Undo2, Database,
  Container, Terminal, Server, Settings2,
} from 'lucide-react';
import api from '../utils/api';
import AdminPageHeader from '../components/admin/AdminPageHeader';
import SectionCard from '../components/admin/SectionCard';
import ErrorBanner from '../components/admin/ErrorBanner';
import ConfigRow from '../components/admin/ConfigRow';
import { SECTION_HELP } from '../components/admin/helpContent';
import { Button, Alert, HelpTip } from '../components/ui';

// Update-mode descriptions

const MODES = {
  'docker-socket': {
    icon: Container,
    tone: 'success',
    title: 'Docker mit voller Kontrolle',
    text: 'Der Docker-Socket ist eingebunden. Updates laufen vollautomatisch: '
      + 'Backup → neues Image pullen → Container tauschen. Schlägt etwas fehl, '
      + 'wird die alte Version automatisch wiederhergestellt.',
    canUpdate: true,
  },
  'docker-manual': {
    icon: Terminal,
    tone: 'warning',
    title: 'Docker ohne Kontrolle',
    text: 'Die App läuft in Docker, hat aber keinen Zugriff auf den Docker-Socket. '
      + 'Das Update muss manuell auf dem Host durchgeführt werden:',
    canUpdate: false,
  },
  host: {
    icon: Server,
    tone: 'info',
    title: 'Host-Installation',
    text: 'Die App läuft direkt auf dem Host. Updates laufen über Git: '
      + 'Backup → Checkout der Zielversion → Neuinstallation → Neustart. '
      + 'Bei Fehlern wird automatisch die vorherige Version wiederhergestellt.',
    canUpdate: true,
  },
};

function ModePanel({ mode, dockerImage, updateAvailable }) {
  const cfg = MODES[mode];
  if (!cfg) return null;
  // The manual-update warning with its host instructions only matters when
  // there actually IS an update — an up-to-date instance stays quiet.
  if (mode === 'docker-manual' && updateAvailable !== true) return null;
  return (
    <Alert tone={cfg.tone} title={cfg.title}>
      <p>{cfg.text}</p>
      {mode === 'docker-manual' && (
        <pre className="bg-charcoal text-cream rounded-lg px-3 py-2.5 mt-2 text-xs font-mono overflow-x-auto">
{`docker pull ${dockerImage || 'hydniz/deltis:latest'}
cd <deltis-verzeichnis>   # dort liegt docker-compose.yml
./backup.sh               # Datensicherung vor dem Update!
docker compose up -d --no-build --force-recreate`}
        </pre>
      )}
    </Alert>
  );
}

// Failed-update / rollback panel

function RollbackPanel({ updateState, onRollback, rollbackRunning }) {
  if (!updateState || updateState.phase !== 'failed') return null;
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-4 space-y-3">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
        <div className="space-y-1 min-w-0">
          <p className="text-sm font-semibold text-red-800">Letztes Update fehlgeschlagen</p>
          {updateState.error && (
            <p className="text-sm text-red-700/80 break-words">{updateState.error}</p>
          )}
          <p className="text-sm text-red-700/70">
            {updateState.recovered
              ? 'Die vorherige Version wurde automatisch wiederhergestellt und läuft.'
              : 'Automatische Wiederherstellung war nicht möglich – bitte Rollback starten.'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {updateState.rollbackAvailable && (
          <Button
            variant="danger"
            size="sm"
            loading={rollbackRunning}
            icon={Undo2}
            onClick={() => onRollback(false)}
          >
            Rollback (nur App)
          </Button>
        )}
        {updateState.backupFile && (
          <Button
            variant="danger"
            size="sm"
            loading={rollbackRunning}
            icon={Database}
            onClick={() => onRollback(true)}
          >
            Rollback + Datenbank wiederherstellen
          </Button>
        )}
      </div>
      <p className="text-xs text-red-700/60">
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
    description: 'Vorschau auf kommende Releases – weitgehend stabil. Berücksichtigt Beta- UND Stable-Releases, je nachdem was neuer ist (z.B. v1.2.3-beta2)',
    color: 'blue',
  },
  {
    value: 'alpha',
    label: 'Alpha',
    description: 'Entwicklungsversionen – können instabil sein. Berücksichtigt Alpha-, Beta- und Stable-Releases, je nachdem was neuer ist (z.B. v1.2.3-alpha4)',
    color: 'orange',
  },
  {
    value: 'main',
    label: 'Main Branch',
    description: 'Neuester Commit auf dem main-Branch – NICHT für Produktivsysteme empfohlen',
    color: 'red',
    warn: true,
  },
];

// Why "Update starten" is unavailable, keyed by `blockReason` from the status
// endpoint. Each returns { tone, text } for an Alert.
const BLOCK_HINTS = {
  'up-to-date': (status, channelLabel) => ({
    tone: 'success',
    text: `Version v${status.currentVersion} ist die neueste im Kanal „${channelLabel}“ – `
      + 'es gibt nichts einzuspielen.',
  }),
  downgrade: (status, channelLabel) => ({
    tone: 'warning',
    text: `Die neueste Version im Kanal „${channelLabel}“ (v${status.latest?.version}) ist `
      + `älter als die installierte Version v${status.currentVersion}. Ein Kanalwechsel `
      + 'führt kein Downgrade durch – es wird erst wieder aktualisiert, wenn dieser Kanal '
      + 'die installierte Version überholt hat.',
  }),
  'check-failed': () => ({
    tone: 'error',
    text: 'Es konnte nicht geprüft werden, ob ein Update verfügbar ist – '
      + 'GitHub war nicht erreichbar.',
  }),
  unknown: () => ({
    tone: 'warning',
    text: 'Es lässt sich nicht bestimmen, ob die verfügbare Version neuer ist als die '
      + 'installierte. Das Update wird deshalb nicht angeboten.',
  }),
};

function ChannelBadge({ channel }) {
  const cfg = CHANNELS.find(c => c.value === channel) || CHANNELS[0];
  const colors = {
    green:  'bg-emerald-50 text-emerald-700 border-emerald-200',
    blue:   'bg-sage-100 text-sage-700 border-sage-200',
    orange: 'bg-ocher-100 text-ocher-700 border-ocher-200',
    red:    'bg-red-50 text-red-700 border-red-200',
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${colors[cfg.color]}`}>
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
    <div className="bg-charcoal rounded-xl p-4 h-56 overflow-y-auto font-mono text-xs">
      {lines.length === 0 && (
        <p className="text-ink-400 italic">Bereit.</p>
      )}
      {lines.map((line, i) => (
        <div
          key={i}
          className={`leading-5 whitespace-pre-wrap ${
            line.startsWith('✗') ? 'text-red-400' :
            line.startsWith('✓') ? 'text-emerald-400' :
            line.startsWith('⚠') ? 'text-amber-400' :
            line.startsWith('→') ? 'text-brand-300 dark:text-brand-400' :
            'text-cream/70'
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

  // An update may only be started when something newer actually exists. Until
  // the status has loaded we do not know, so the button stays disabled.
  const canStart = status?.updateAvailable === true;
  const blockHint = status && !notConfigured && BLOCK_HINTS[status.blockReason]
    ? BLOCK_HINTS[status.blockReason](status, channelConfig.label)
    : null;

  // Hide settings that do not apply to the current runtime environment
  // (context 'docker' only in Docker, 'host' only on host installations).
  // While the status is still loading, context-bound entries stay hidden.
  const visibleOtaConfigs = otaConfigs.filter(c => {
    if (!c.context) return true;
    if (!status) return false;
    return c.context === 'docker' ? status.inDocker : !status.inDocker;
  });

  return (
    <div className="space-y-6">
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
                className="text-brand-600 hover:underline inline-flex items-center gap-0.5"
              >
                {status.repoUrl.replace(/^https?:\/\//, '')}
                <ExternalLink size={11} />
              </a>
            </>
          ) : 'In-App-Updates direkt aus dem GitHub-Repository'
        }
      />

      {/* Environment / update mode */}
      {status?.mode && (
        <ModePanel
          mode={status.mode}
          dockerImage={status.dockerImage}
          updateAvailable={status.updateAvailable}
        />
      )}

      {/* Failed update → rollback offer */}
      <RollbackPanel
        updateState={status?.updateState}
        onRollback={startRollback}
        rollbackRunning={rollbackRunning || updateRunning}
      />

      {/* Last update succeeded */}
      {status?.updateState?.phase === 'success' && (
        <Alert tone="success">
          Letztes Update erfolgreich
          {status.updateState.fromVersion && status.updateState.toVersion && (
            <> ({status.updateState.fromVersion} → {status.updateState.toVersion})</>
          )}
          . Migrationen abgeschlossen.
        </Alert>
      )}

      {/* Repo not configured yet → point to the settings card below */}
      {notConfigured && (
        <Alert tone="warning">
          Es ist noch kein GitHub-Repository konfiguriert. Trage unter{' '}
          <strong>Einstellungen</strong> (unten) eine Repository-URL ein,
          damit nach Updates gesucht werden kann.
        </Alert>
      )}

      {/* Version info */}
      {loadingStatus ? (
        <div className="card p-6 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-ink-300" />
        </div>
      ) : statusError ? (
        <ErrorBanner message={statusError} />
      ) : status && (
        <SectionCard icon={Package} title="Versionsinfo">
          <div>
            <div className="px-4 py-3 flex items-center justify-between border-b hairline">
              <span className="text-sm text-ink-500">Installiert</span>
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-ink-900">v{status.currentVersion}</code>
                {status.currentCommit && (
                  <code className="text-xs font-mono text-ink-400">({status.currentCommit})</code>
                )}
              </div>
            </div>
            <div className="px-4 py-3 flex items-center justify-between border-b hairline">
              <span className="text-sm text-ink-500 flex items-center gap-2">
                Verfügbar <ChannelBadge channel={status.channel} />
              </span>
              <div className="flex items-center gap-2">
                {status.checkError ? (
                  <span className="text-xs text-red-600">{status.checkError}</span>
                ) : status.latest ? (
                  <>
                    <code className="text-sm font-mono text-ink-900">
                      {status.channel === 'main'
                        ? status.latest.commitSha
                        : `v${status.latest.version}`}
                    </code>
                    {status.latest.releaseUrl && (
                      <a
                        href={status.latest.releaseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-600 hover:text-brand-700"
                      >
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-ink-300">—</span>
                )}
              </div>
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-ink-500">Status</span>
              <div>
                {status.updateAvailable === true && (
                  <span className="flex items-center gap-1.5 text-sm font-medium text-ocher-600">
                    <AlertTriangle size={14} />
                    Update verfügbar
                  </span>
                )}
                {/* "Aktuell" would be a green tick on a channel that simply
                    trails the installed build – say that instead. */}
                {status.updateAvailable === false && status.blockReason === 'downgrade' && (
                  <span className="flex items-center gap-1.5 text-sm font-medium text-ocher-600">
                    <AlertTriangle size={14} />
                    Kanal ist älter
                  </span>
                )}
                {status.updateAvailable === false && status.blockReason !== 'downgrade' && (
                  <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                    <CheckCircle size={14} />
                    Aktuell
                  </span>
                )}
                {status.updateAvailable === null && (
                  <span className="text-sm text-ink-400">Nicht bestimmbar</span>
                )}
              </div>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Release channel selector – single source of truth for the channel */}
      <SectionCard
        icon={GitBranch}
        title="Release-Kanal"
        help={(
          <HelpTip title={SECTION_HELP.channel.title} short={SECTION_HELP.channel.short}>
            {SECTION_HELP.channel.long}
          </HelpTip>
        )}
      >
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {CHANNELS.map(ch => (
              <button
                key={ch.value}
                onClick={() => saveChannel(ch.value)}
                disabled={savingChannel}
                className={`text-left px-3.5 py-3 rounded-xl border transition-all ${
                  selectedChannel === ch.value
                    ? ch.warn
                      ? 'bg-red-50 border-red-300 text-red-800'
                      : 'bg-brand-50 border-brand-300 text-ink-900'
                    : 'bg-paper-50 border-paper-200 text-ink-500 hover:border-ink-200'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold">{ch.label}</span>
                  {ch.warn && <AlertTriangle size={13} className="text-red-500" />}
                  {selectedChannel === ch.value && !ch.warn && <CheckCircle size={13} className="text-brand-500" />}
                </div>
                <p className="text-xs opacity-70 leading-snug">{ch.description}</p>
              </button>
            ))}
          </div>

          <p className="text-xs text-ink-400 leading-snug">
            Ein Kanalwechsel wirkt sofort auf die Versionsprüfung, aber nie von allein auf
            die Installation. <strong className="font-semibold text-ink-500">Ein Wechsel
            führt nie ein Downgrade durch:</strong> Ist die neueste Version des gewählten
            Kanals älter als die installierte, wird kein Update angeboten.
          </p>

          {channelConfig.warn && (
            <Alert tone="error">
              Der Main-Branch enthält unveröffentlichten Code und kann Fehler oder
              Breaking Changes enthalten. Nicht für Produktivsysteme geeignet.
              Verfolgt wird immer der <code>main</code>-Branch des Repositories –
              ein eigener Branch kann bewusst nicht angegeben werden.
            </Alert>
          )}

          {channelSaved && (
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-600">
              <CheckCircle size={13} />
              Kanal gespeichert.
            </div>
          )}
        </div>
      </SectionCard>

      {/* Update action */}
      <SectionCard
        icon={Play}
        title="Update starten"
        help={(
          <HelpTip title={SECTION_HELP.updateStart.title} short={SECTION_HELP.updateStart.short}>
            {SECTION_HELP.updateStart.long}
          </HelpTip>
        )}
      >
        <div className="p-4 space-y-4">
          <div className="flex items-start gap-2 text-sm text-ink-500">
            <Info size={15} className="shrink-0 mt-0.5" />
            <span>
              Vor jedem Update wird automatisch eine Datensicherung erstellt.
              Schlägt die Sicherung fehl, wird das Update <strong>nicht</strong> durchgeführt.
              Jeder Schritt wird protokolliert (Log unten und in <code className="font-mono text-xs">backups/update-logs/</code>).
            </span>
          </div>

          {modeConfig?.canUpdate === false ? (
            <div className="flex items-start gap-2 text-sm text-ocher-700">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <span>
                In dieser Umgebung ist kein automatisches Update möglich –
                bitte die manuelle Anleitung oben verwenden.
              </span>
            </div>
          ) : (
            <div className="space-y-3">
              {blockHint && <Alert tone={blockHint.tone}>{blockHint.text}</Alert>}
              <Button
                icon={Play}
                loading={starting || updateRunning}
                disabled={rollbackRunning || notConfigured || !canStart}
                onClick={startUpdate}
              >
                {updateRunning ? 'Update läuft …' : 'Update starten'}
              </Button>
            </div>
          )}

          <UpdateLog lines={logLines} />

          <button
            onClick={fetchStatus}
            disabled={loadingStatus}
            className="text-xs text-ink-400 hover:text-ink-700 flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw size={12} className={loadingStatus ? 'animate-spin' : ''} />
            Status aktualisieren
          </button>
        </div>
      </SectionCard>

      {/* OTA settings – moved here from the system configuration page so
          everything update-related lives on one page */}
      {visibleOtaConfigs.length > 0 && (
        <SectionCard
          icon={Settings2}
          title="Einstellungen"
          help={(
            <HelpTip
              title={SECTION_HELP.updateSettings.title}
              short={SECTION_HELP.updateSettings.short}
            >
              {SECTION_HELP.updateSettings.long}
            </HelpTip>
          )}
        >
          <div>
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
