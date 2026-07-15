import { useState, useEffect, useCallback } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import api from '../utils/api';
import AdminPageHeader from '../components/admin/AdminPageHeader';
import SectionCard from '../components/admin/SectionCard';
import AdminSpinner from '../components/admin/AdminSpinner';
import ErrorBanner from '../components/admin/ErrorBanner';
import ConfigRow from '../components/admin/ConfigRow';
import Alert from '../components/ui/Alert';

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
    <div>
      <AdminPageHeader
        icon={SlidersHorizontal}
        title="Systemkonfiguration"
        description="Laufzeitkonfiguration des Servers – Update-Einstellungen findest du unter Updates."
      />

      {/* Env priority info */}
      <Alert tone="warning" title="Priorität der Konfigurationsquellen" className="mb-6">
        <code>.env</code> hat immer Vorrang vor der Datenbankeinstellung.
        Werte die in <code>.env</code> / <code>docker-compose.yml</code> gesetzt
        sind, können hier nicht überschrieben werden.
      </Alert>

      <ErrorBanner message={error} />

      {loading ? (
        <AdminSpinner />
      ) : (
        <div className="space-y-6">
          {Object.entries(groups).map(([groupName, entries]) => (
            <SectionCard key={groupName} title={groupName}>
              <div>
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
