// Settings card: the WEB side of the Health Connect integration.
//
// The connection, permission grant AND the choice of which data types to read
// all happen in the Android companion app (a browser cannot read Health
// Connect). So this card is STATUS-ONLY: it lists the linked device(s), what
// each is reading, how much was deduplicated and when it last synced — but it
// does not let you pick data types or the window (that lives in the app). It
// can still unlink a device. Backed by /api/health (see docs/api/health.md).
import { useState, useEffect, useCallback } from 'react';
import { HeartPulse, Smartphone, Unlink } from 'lucide-react';
import api from '../utils/api';
import { Button, Alert, Spinner, Checkbox, TONE_BUBBLE } from './ui';

// German labels for the Health Connect record types the server supports.
const TYPE_LABELS = {
  exercise: 'Trainingseinheiten',
  weight: 'Gewicht',
  heartRate: 'Herzfrequenz',
  steps: 'Schritte',
  activeCalories: 'Aktive Kalorien',
  distance: 'Distanz',
};

function typeLabel(type) {
  return TYPE_LABELS[type] || type;
}

function formatDateTime(value) {
  if (!value) return '–';
  return new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

// Turns a device's last-sync counts into a short German summary, or null.
export function summarizeSync(counts) {
  if (!counts) return null;
  const parts = [];
  if (counts.activities) parts.push(`${counts.activities} Aktivität${counts.activities === 1 ? '' : 'en'}`);
  const imported = counts.weights?.imported;
  if (imported) parts.push(`${imported} Gewichtswert${imported === 1 ? '' : 'e'}`);
  const superseded = counts.merge?.superseded;
  if (superseded) parts.push(`${superseded} Duplikat${superseded === 1 ? '' : 'e'} erkannt`);
  return parts.length ? parts.join(' · ') : null;
}

export default function HealthConnectCard() {
  const [config, setConfig] = useState(null); // null = loading
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState(null); // deviceId whose disconnect confirm is open
  const [purge, setPurge] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/health/config');
      setConfig(res.data);
    } catch {
      setConfig({ connected: false });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // The per-device list. Falls back to the single connection shape for an older
  // server that doesn't send `devices` yet.
  const devices = config?.devices?.length
    ? config.devices
    : (config?.connected ? [{
        deviceId: config.deviceId, deviceName: config.deviceName,
        enabledTypes: config.enabledTypes, lastSyncAt: config.lastSyncAt,
        lastSyncCounts: config.lastSyncCounts, backfillDays: config.backfillDays,
      }] : []);

  const handleDisconnect = async (deviceId) => {
    setDisconnecting(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (deviceId) params.set('deviceId', deviceId);
      if (purge) params.set('purge', 'true');
      const qs = params.toString();
      await api.delete(`/health/connect${qs ? `?${qs}` : ''}`);
      setConfirmId(null);
      setPurge(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Trennen fehlgeschlagen.');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="card p-5" data-testid="health-connect-card">
      <h2 className="display text-lg mb-4 flex items-center gap-2.5">
        <span className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${TONE_BUBBLE.rose}`}>
          <HeartPulse size={14} />
        </span>
        Health Connect
      </h2>

      {!config ? (
        <div className="flex items-center justify-center py-6"><Spinner size="md" /></div>
      ) : devices.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-500">
            Verbinde deine Android-Gesundheitsdaten mit der App <strong>Deltis Companion</strong>.
            Die App liest die von dir freigegebenen Health-Connect-Daten und überträgt sie an
            Deltis – Aktivitäten aus bereits verbundenen Quellen wie Strava werden dabei
            automatisch übersprungen, sodass keine Duplikate entstehen.
          </p>
          <Alert tone="info">
            Installiere die Companion-App, melde dich mit diesem Konto an und wähle <strong>dort</strong>
            {' '}aus, welche Daten übertragen werden. Sobald ein Gerät verbunden ist, erscheint der
            Status hier.
          </Alert>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-ink-400">
            Datenarten und Zeitraum stellst du in der Companion-App ein – hier siehst du den Status.
          </p>

          {error && <Alert tone="error">{error}</Alert>}

          {devices.map(device => {
            const summary = summarizeSync(device.lastSyncCounts);
            const types = device.enabledTypes || [];
            const open = confirmId === device.deviceId;
            return (
              <div key={device.deviceId || 'device'} className="panel px-3.5 py-3 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-rose-100 text-rose-600">
                    <Smartphone size={16} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink-800 truncate">
                      {device.deviceName || 'Android-Gerät'}
                    </p>
                    <p className="text-xs text-ink-400">
                      Letzte Übertragung: {formatDateTime(device.lastSyncAt)}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" icon={Unlink} onClick={() => { setConfirmId(open ? null : device.deviceId); setPurge(false); }}>
                    Trennen
                  </Button>
                </div>

                {types.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {types.map(t => (
                      <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-paper-100 text-ink-500">
                        {typeLabel(t)}
                      </span>
                    ))}
                  </div>
                )}

                {summary && <p className="text-xs text-emerald-600">{summary}</p>}

                {open && (
                  <div className="border-t hairline pt-3 space-y-3">
                    <p className="text-sm text-ink-600">
                      Verbindung zu diesem Gerät trennen? Es werden keine neuen Daten mehr übertragen.
                    </p>
                    <Checkbox
                      checked={purge}
                      onChange={e => setPurge(e.target.checked)}
                      label="Auch die bereits übertragenen Trainingseinheiten löschen"
                    />
                    <div className="flex gap-2">
                      <Button variant="danger" size="sm" loading={disconnecting} onClick={() => handleDisconnect(device.deviceId)}>
                        Verbindung trennen
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => { setConfirmId(null); setPurge(false); }}>
                        Abbrechen
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
