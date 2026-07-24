// Settings card: the WEB side of the Health Connect integration.
//
// The actual connection and permission grant happen in the Android companion
// app (Deltis Companion) — a browser cannot read Health Connect. So this card
// is a STATUS and CONFIGURATION surface: it shows which device is linked, what
// it is allowed to read, how far back, and how much was deduplicated, and it
// lets the user adjust the readable types and the backfill window or unlink
// the device. Backed by /api/health (see docs/api/health.md).
import { useState, useEffect, useCallback } from 'react';
import { HeartPulse, Smartphone, Unlink, RefreshCw } from 'lucide-react';
import api from '../utils/api';
import { Button, Alert, Spinner, Toggle, Checkbox, Field, Select, TONE_BUBBLE } from './ui';

// German labels for the Health Connect record types the server supports.
// `heartRate`/`steps`/`activeCalories`/`distance` enrich an exercise session
// rather than standing alone, which the hint below the toggles explains.
const TYPE_LABELS = {
  exercise: 'Trainingseinheiten',
  weight: 'Gewicht',
  heartRate: 'Herzfrequenz',
  steps: 'Schritte',
  activeCalories: 'Aktive Kalorien',
  distance: 'Distanz',
};

const BACKFILL_OPTIONS = [7, 14, 30, 90, 180, 365];

function formatDateTime(value) {
  if (!value) return '–';
  return new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

// Turns the last sync's counts into a short German summary, or null when
// there is nothing meaningful to report yet.
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
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [purge, setPurge] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/health/config');
      setConfig(res.data);
    } catch {
      setConfig({ connected: false, supportedTypes: Object.keys(TYPE_LABELS) });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const supportedTypes = config?.supportedTypes?.length
    ? config.supportedTypes
    : Object.keys(TYPE_LABELS);
  const enabledTypes = config?.enabledTypes || [];
  const minDays = config?.minBackfillDays || 7;
  const options = BACKFILL_OPTIONS.filter(d => d >= minDays);

  const toggleType = (type) => {
    setSaved(false);
    setConfig(prev => {
      const has = prev.enabledTypes?.includes(type);
      const next = has
        ? prev.enabledTypes.filter(t => t !== type)
        : [...(prev.enabledTypes || []), type];
      return { ...prev, enabledTypes: next };
    });
  };

  const changeBackfill = (days) => {
    setSaved(false);
    setConfig(prev => ({ ...prev, backfillDays: days }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const res = await api.put('/health/config', {
        enabledTypes: config.enabledTypes,
        backfillDays: config.backfillDays,
      });
      setConfig(res.data);
      setSaved(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError('');
    try {
      await api.delete(`/health/connect${purge ? '?purge=true' : ''}`);
      setShowDisconnect(false);
      setPurge(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Trennen fehlgeschlagen.');
    } finally {
      setDisconnecting(false);
    }
  };

  const syncSummary = summarizeSync(config?.lastSyncCounts);

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
      ) : !config.connected ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-500">
            Verbinde deine Android-Gesundheitsdaten mit der App <strong>Deltis Companion</strong>.
            Die App liest die von dir freigegebenen Health-Connect-Daten (z.&nbsp;B. Trainingseinheiten
            und Gewicht) und überträgt sie an Deltis – Aktivitäten aus bereits verbundenen Quellen
            wie Strava werden dabei automatisch übersprungen, sodass keine Duplikate entstehen.
          </p>
          <Alert tone="info">
            Installiere die Companion-App auf deinem Android-Gerät, melde dich mit diesem Konto an
            und wähle dort aus, welche Daten übertragen werden. Sobald das Gerät verbunden ist,
            erscheint der Status hier.
          </Alert>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="panel px-3.5 py-3 flex items-center gap-3">
            <span className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-rose-100 text-rose-600">
              <Smartphone size={16} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-ink-800 truncate">
                {config.deviceName || 'Android-Gerät'}
              </p>
              <p className="text-xs text-ink-400">
                Letzte Übertragung: {formatDateTime(config.lastSyncAt)}
              </p>
            </div>
          </div>

          {syncSummary && (
            <Alert tone="success" title="Zuletzt übertragen">{syncSummary}</Alert>
          )}

          <div>
            <p className="text-sm font-semibold text-ink-700 mb-2">Welche Daten werden gelesen?</p>
            <div className="space-y-2">
              {supportedTypes.map(type => (
                <div key={type} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-ink-600">{TYPE_LABELS[type] || type}</span>
                  <Toggle
                    value={enabledTypes.includes(type)}
                    onChange={() => toggleType(type)}
                    label={TYPE_LABELS[type] || type}
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-ink-400 mt-2">
              Herzfrequenz, Schritte, Kalorien und Distanz ergänzen deine Trainingseinheiten.
            </p>
          </div>

          <Field label="Wie weit zurück wird gelesen?" hint={`Mindestens ${minDays} Tage.`}>
            <Select
              value={config.backfillDays || minDays}
              onChange={e => changeBackfill(Number(e.target.value))}
            >
              {options.map(d => (
                <option key={d} value={d}>{d} Tage</option>
              ))}
            </Select>
          </Field>

          {error && <Alert tone="error">{error}</Alert>}
          {saved && <Alert tone="success">Einstellungen gespeichert.</Alert>}

          <div className="flex flex-wrap gap-2.5">
            <Button icon={RefreshCw} loading={saving} onClick={handleSave}>
              Speichern
            </Button>
            <Button variant="secondary" icon={Unlink} onClick={() => setShowDisconnect(v => !v)}>
              Gerät trennen
            </Button>
          </div>

          {showDisconnect && (
            <div className="panel p-3.5 space-y-3">
              <p className="text-sm text-ink-600">
                Die Verbindung zu diesem Gerät trennen? Es werden keine neuen Gesundheitsdaten
                mehr übertragen.
              </p>
              <Checkbox
                checked={purge}
                onChange={e => setPurge(e.target.checked)}
                label="Auch die bereits übertragenen Trainingseinheiten löschen"
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
    </div>
  );
}
