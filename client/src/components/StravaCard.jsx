// Settings card: connect/disconnect the user's Strava account, show sync
// state and trigger a manual sync. The OAuth callback redirects back to
// /settings?strava=<status> — the query parameter is consumed here.
import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, RefreshCw, Unlink, Check } from 'lucide-react';
import api from '../utils/api';
import { Button, Alert, Checkbox, Spinner, TONE_BUBBLE } from './ui';

// Strava brand colour (required by the Strava brand guidelines for
// connect buttons).
const STRAVA_ORANGE = '#FC4C02';

const CALLBACK_MESSAGES = {
  success: { tone: 'success', text: 'Strava verbunden! Die Aktivitäten der letzten 7 Tage werden im Hintergrund synchronisiert.' },
  denied: { tone: 'warning', text: 'Verbindung abgebrochen – du hast den Zugriff bei Strava nicht bestätigt.' },
  scope: { tone: 'warning', text: 'Bitte erlaube beim Verbinden den Zugriff auf deine Aktivitäten – ohne ihn kann nichts synchronisiert werden.' },
  'athlete-taken': { tone: 'error', text: 'Dieses Strava-Konto ist bereits mit einem anderen Benutzer verknüpft.' },
  'invalid-state': { tone: 'error', text: 'Der Anmeldevorgang ist abgelaufen. Bitte versuche es erneut.' },
  config: { tone: 'error', text: 'Strava ist auf diesem Server nicht konfiguriert.' },
  error: { tone: 'error', text: 'Verbindung fehlgeschlagen. Bitte versuche es erneut.' },
};

function formatDateTime(value) {
  if (!value) return '–';
  return new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function StravaCard() {
  const [status, setStatus] = useState(null); // null = loading
  const [callbackMessage, setCallbackMessage] = useState(null);
  const [actionError, setActionError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [purge, setPurge] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const pollTimer = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/strava/status');
      setStatus(res.data);
      return res.data;
    } catch {
      setStatus({ configured: false, connected: false, connection: null, activityCount: 0 });
      return null;
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Consume the OAuth callback status from the URL (once).
  useEffect(() => {
    const key = searchParams.get('strava');
    if (!key) return;
    setCallbackMessage(CALLBACK_MESSAGES[key] || CALLBACK_MESSAGES.error);
    const next = new URLSearchParams(searchParams);
    next.delete('strava');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // While the 7-day backfill runs, refresh until it is done.
  useEffect(() => {
    const pending = status?.connected && status.connection && !status.connection.initialSyncDone;
    if (!pending) return undefined;
    pollTimer.current = setInterval(load, 5000);
    return () => clearInterval(pollTimer.current);
  }, [status, load]);

  const handleConnect = async () => {
    setConnecting(true);
    setActionError('');
    try {
      const res = await api.get('/strava/connect');
      window.location.href = res.data.url;
    } catch (err) {
      setActionError(err.response?.data?.error || 'Verbindung konnte nicht gestartet werden.');
      setConnecting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setActionError('');
    setSyncResult(null);
    try {
      const res = await api.post('/strava/sync');
      setSyncResult(res.data);
      await load();
    } catch (err) {
      setActionError(err.response?.data?.error || 'Synchronisation fehlgeschlagen.');
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setActionError('');
    try {
      await api.delete(`/strava/connection${purge ? '?purge=1' : ''}`);
      setShowDisconnect(false);
      setPurge(false);
      setSyncResult(null);
      await load();
    } catch (err) {
      setActionError(err.response?.data?.error || 'Trennen fehlgeschlagen.');
    } finally {
      setDisconnecting(false);
    }
  };

  const connection = status?.connection;
  const athleteName = connection
    ? [connection.athlete?.firstname, connection.athlete?.lastname].filter(Boolean).join(' ') || `Athlet ${connection.athleteId}`
    : '';

  return (
    <div className="card p-5" data-testid="strava-card">
      <h2 className="display text-lg mb-4 flex items-center gap-2.5">
        <span className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${TONE_BUBBLE.clay}`}>
          <Activity size={14} />
        </span>
        Strava
      </h2>

      {callbackMessage && (
        <Alert tone={callbackMessage.tone} className="mb-3">{callbackMessage.text}</Alert>
      )}

      {!status ? (
        <div className="flex items-center justify-center py-6"><Spinner size="md" /></div>
      ) : !status.configured ? (
        <p className="text-sm text-ink-500">
          Die Strava-Integration ist auf diesem Server noch nicht eingerichtet.
          Ein Administrator muss zuerst die Strava-API-Zugangsdaten hinterlegen
          (Administration → System → Integrationen).
        </p>
      ) : !status.connected ? (
        <>
          <p className="text-xs text-ink-400 mb-4">
            Verbinde dein Strava-Konto, um Aktivitäten automatisch zu synchronisieren.
            Beim ersten Verbinden werden die letzten 7 Tage importiert.
          </p>
          <button
            type="button"
            onClick={handleConnect}
            disabled={connecting}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: STRAVA_ORANGE }}
          >
            {connecting ? <Spinner size="sm" /> : <Activity size={15} />}
            Mit Strava verbinden
          </button>
        </>
      ) : (
        <div className="space-y-3">
          <div className="panel px-3.5 py-3 flex items-center gap-3">
            <span
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
              style={{ backgroundColor: STRAVA_ORANGE }}
            >
              {athleteName.slice(0, 1).toUpperCase() || 'S'}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-ink-800 truncate flex items-center gap-1.5">
                {athleteName}
                <Check size={13} className="text-emerald-600 flex-shrink-0" />
              </p>
              <p className="text-xs text-ink-400">
                {status.activityCount} synchronisierte Aktivität{status.activityCount === 1 ? '' : 'en'}
                {' · '}Letzter Sync: {formatDateTime(connection.lastSyncAt)}
              </p>
            </div>
          </div>

          {!connection.initialSyncDone && (
            <Alert tone="info">
              Erstsynchronisation läuft – die Aktivitäten der letzten 7 Tage werden geladen…
            </Alert>
          )}
          {connection.lastSyncError && (
            <Alert tone="warning" title="Letzter Sync mit Fehlern">{connection.lastSyncError}</Alert>
          )}
          {syncResult && (
            <Alert tone="success">
              Synchronisation abgeschlossen: {syncResult.synced} neu/aktualisiert
              {syncResult.failed > 0 ? `, ${syncResult.failed} fehlgeschlagen` : ''}.
            </Alert>
          )}

          <div className="flex flex-wrap gap-2.5">
            <Button icon={RefreshCw} loading={syncing} onClick={handleSync}>
              Jetzt synchronisieren
            </Button>
            <Button variant="secondary" icon={Unlink} onClick={() => setShowDisconnect(v => !v)}>
              Trennen
            </Button>
          </div>

          {showDisconnect && (
            <div className="panel p-3.5 space-y-3">
              <p className="text-sm text-ink-600">
                Verbindung zu Strava trennen? Neue Aktivitäten werden nicht mehr synchronisiert.
              </p>
              <Checkbox
                checked={purge}
                onChange={e => setPurge(e.target.checked)}
                label="Auch alle bereits synchronisierten Strava-Aktivitäten löschen"
              />
              <div className="flex gap-2">
                <Button variant="danger" size="sm" loading={disconnecting} onClick={handleDisconnect}>
                  Verbindung trennen
                </Button>
                <Button variant="secondary" size="sm" onClick={() => { setShowDisconnect(false); setPurge(false); }}>
                  Abbrechen
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {actionError && <Alert tone="error" className="mt-3">{actionError}</Alert>}

      <p className="text-[11px] text-ink-300 mt-4">Powered by Strava</p>
    </div>
  );
}
