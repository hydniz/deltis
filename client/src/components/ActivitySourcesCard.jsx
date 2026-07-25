// Settings card: rank the ACTIVITY sources for the cross-platform merge.
//
// A single workout can arrive from several platforms (a Garmin watch writing to
// Health Connect, the same ride pulled from Strava, …). The server keeps only
// one canonical record per workout (services/activityMerge). Strava already
// outranks Health Connect; this card lets the user order the Health Connect
// source apps among themselves, so the source they trust wins a duplicate.
// Backed by GET/PUT /api/health/activity-sources (see services/activitySources).
import { useState, useEffect, useCallback } from 'react';
import { Layers, ChevronUp, ChevronDown } from 'lucide-react';
import api from '../utils/api';
import { Button, Alert, Spinner, TONE_BUBBLE } from './ui';

// Orders the detected sources by the saved preference, then appends any newly
// seen source (not yet ranked) at the bottom, preserving detection order.
export function orderSources(sources, priority) {
  const byOrigin = new Map((sources || []).map(s => [s.origin, s]));
  const ordered = [];
  const seen = new Set();
  for (const origin of priority || []) {
    if (byOrigin.has(origin) && !seen.has(origin)) { ordered.push(byOrigin.get(origin)); seen.add(origin); }
  }
  for (const s of sources || []) {
    if (!seen.has(s.origin)) { ordered.push(s); seen.add(s.origin); }
  }
  return ordered;
}

export default function ActivitySourcesCard() {
  const [order, setOrder] = useState(null); // null = loading; [] = none detected
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/health/activity-sources');
      setOrder(orderSources(res.data.sources, res.data.priority));
    } catch {
      setOrder([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const move = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = order.slice();
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await api.put('/health/activity-sources', { priority: order.map(s => s.origin) });
      setSaved(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card p-5" data-testid="activity-sources-card">
      <h2 className="display text-lg mb-4 flex items-center gap-2.5">
        <span className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${TONE_BUBBLE.sage}`}>
          <Layers size={14} />
        </span>
        Aktivitäten-Quellen
      </h2>

      {order === null ? (
        <div className="flex items-center justify-center py-6"><Spinner size="md" /></div>
      ) : order.length < 2 ? (
        <p className="text-sm text-ink-500">
          Sobald dieselbe Aktivität aus mehreren Quellen kommt, kannst du hier festlegen,
          welche Quelle bei Duplikaten Vorrang hat. Aktuell ist noch keine Rangfolge nötig.
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-ink-400">
            Bei doppelten Aktivitäten wird der Eintrag der obersten Quelle behalten. Ziehe die
            wichtigste Quelle nach oben. (Strava hat generell Vorrang vor Health Connect.)
          </p>

          {error && <Alert tone="error">{error}</Alert>}

          <ul className="space-y-2">
            {order.map((source, i) => (
              <li key={source.origin} className="panel px-3.5 py-2.5 flex items-center gap-3">
                <span className="w-6 text-center text-sm font-semibold text-ink-400 tabular-nums">{i + 1}.</span>
                <span className="flex-1 min-w-0 text-sm font-medium text-ink-800 truncate">
                  {source.appLabel}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="ghost" size="sm" icon={ChevronUp} aria-label="Nach oben"
                    disabled={i === 0} onClick={() => move(i, -1)}
                  />
                  <Button
                    variant="ghost" size="sm" icon={ChevronDown} aria-label="Nach unten"
                    disabled={i === order.length - 1} onClick={() => move(i, 1)}
                  />
                </div>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-3">
            <Button variant="primary" size="sm" loading={saving} onClick={handleSave}>
              Speichern
            </Button>
            {saved && <span className="text-xs text-emerald-600">Gespeichert</span>}
          </div>
        </div>
      )}
    </div>
  );
}
