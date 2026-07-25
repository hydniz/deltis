import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { Spinner, Checkbox, Segmented } from './ui';

// Per-metric multi-platform source selection ("Datenquellen"). A metric can
// receive readings from several apps/devices (Samsung Health, Garmin, … each on
// a phone). Here the user chooses whether ALL sources feed it (new ones join
// automatically) or only SELECTED ones — either specific (app · device) sources
// or an "alle Geräte" wildcard to aggregate one app across all phones. Saves
// immediately. Manual entries always count and are not listed.
const MODE_OPTIONS = [
  { value: 'all', label: 'Alle zusammenführen' },
  { value: 'selected', label: 'Nur ausgewählte' },
];

const has = (list, e) => list.some(s => s.deviceId === e.deviceId && s.app === e.app);

export default function MetricSourcesEditor({ metricId }) {
  const [detected, setDetected] = useState(null); // null = loading
  const [policy, setPolicy] = useState({ mode: 'all', sources: [] });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/metrics/${metricId}/sources`);
      setDetected(res.data.sources || []);
      setPolicy(res.data.policy || { mode: 'all', sources: [] });
    } catch {
      setDetected([]);
    }
  }, [metricId]);

  useEffect(() => { load(); }, [load]);

  const save = async (next) => {
    setPolicy(next);
    setSaving(true);
    try {
      await api.put(`/metrics/${metricId}`, { sourcePolicy: next });
    } finally {
      setSaving(false);
    }
  };

  const setMode = (mode) => save({ ...policy, mode });
  const toggle = (entry) => {
    const sources = has(policy.sources, entry)
      ? policy.sources.filter(s => !(s.deviceId === entry.deviceId && s.app === entry.app))
      : [...policy.sources, entry];
    save({ ...policy, sources });
  };

  if (detected === null) {
    return <div className="flex justify-center py-3"><Spinner size="sm" /></div>;
  }
  if (detected.length === 0) {
    return (
      <p className="text-xs text-ink-400">
        Noch keine Plattform-Quellen erkannt. Sobald ein Gerät Daten liefert, kannst du hier wählen.
      </p>
    );
  }

  // The distinct apps let us offer an "alle Geräte" wildcard per app on top of
  // the specific app·device sources.
  const apps = [...new Map(detected.map(s => [s.app, s.appLabel])).entries()];

  return (
    <div className="space-y-2.5">
      <Segmented value={policy.mode} onChange={setMode} options={MODE_OPTIONS} />
      {policy.mode === 'selected' && (
        <div className="space-y-1.5">
          {apps.length > 1 || detected.length > 1 ? (
            apps.map(([app, appLabel]) => (
              <Checkbox
                key={`wild-${app}`}
                checked={has(policy.sources, { deviceId: '', app })}
                onChange={() => toggle({ deviceId: '', app })}
                label={`${appLabel} · alle Geräte`}
              />
            ))
          ) : null}
          {detected.map(s => (
            <Checkbox
              key={`${s.deviceId}|${s.app}`}
              checked={has(policy.sources, { deviceId: s.deviceId, app: s.app })}
              onChange={() => toggle({ deviceId: s.deviceId, app: s.app })}
              label={`${s.appLabel}${s.deviceName ? ` · ${s.deviceName}` : ''}`}
            />
          ))}
          {policy.sources.length === 0 && (
            <p className="text-xs text-ocher-600">Keine Quelle gewählt — nur manuelle Einträge zählen.</p>
          )}
        </div>
      )}
      {saving && <p className="text-[11px] text-ink-300">Speichern…</p>}
    </div>
  );
}
