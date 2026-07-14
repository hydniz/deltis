import { useState, useEffect, useCallback } from 'react';
import { SlidersHorizontal, Info } from 'lucide-react';
import api from '../utils/api';
import AdminPageHeader from '../components/admin/AdminPageHeader';
import SectionCard from '../components/admin/SectionCard';
import AdminSpinner from '../components/admin/AdminSpinner';
import ErrorBanner from '../components/admin/ErrorBanner';
import ConfigRow from '../components/admin/ConfigRow';

// Update-related settings live on the AdminUpdates page – everything about
// OTA updates is managed in one place there.
const UPDATES_PAGE_GROUP = 'OTA Update';

export default function AdminConfig() {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await api.get('/admin/config');
      setConfigs(res.data.filter(c => c.group !== UPDATES_PAGE_GROUP));
    } catch {
      setError('Konfiguration konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const handleSave = (key, value, source = 'db') => {
    setConfigs(prev => prev.map(c =>
      c.key === key ? { ...c, value, source, hasValue: true } : c
    ));
  };

  const handleReset = () => {
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
      <AdminPageHeader
        icon={SlidersHorizontal}
        title="Systemkonfiguration"
        description="Laufzeitkonfiguration des Servers – Update-Einstellungen findest du unter Updates (OTA)."
      />

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

      <ErrorBanner message={error} />

      {loading ? (
        <AdminSpinner />
      ) : (
        <div className="space-y-6">
          {Object.entries(groups).map(([groupName, entries]) => (
            <SectionCard key={groupName} title={groupName}>
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
            </SectionCard>
          ))}
        </div>
      )}
    </div>
  );
}
