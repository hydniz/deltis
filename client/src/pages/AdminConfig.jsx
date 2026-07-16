import { useState, useEffect, useCallback } from 'react';
import { SlidersHorizontal, Server, ShieldCheck, UserPlus, Plug } from 'lucide-react';
import api from '../utils/api';
import AdminPageHeader from '../components/admin/AdminPageHeader';
import SectionCard from '../components/admin/SectionCard';
import AdminSpinner from '../components/admin/AdminSpinner';
import ErrorBanner from '../components/admin/ErrorBanner';
import ConfigRow from '../components/admin/ConfigRow';
import { SECTION_HELP } from '../components/admin/helpContent';
import { Alert, HelpTip } from '../components/ui';

// Update-related settings live on the AdminUpdates page – everything about
// OTA updates is managed in one place there.
const UPDATES_PAGE_GROUP = 'OTA Update';

// Section order and presentation, keyed by the `group` the API reports.
// Listed top-down from "what runs the server" to "who may use it"; a group
// the API adds without an entry here is appended at the end untouched.
const SECTIONS = [
  { group: 'Server', icon: Server, help: SECTION_HELP.server },
  { group: 'Sicherheit', icon: ShieldCheck, help: SECTION_HELP.security },
  { group: 'Registrierung & Zugang', icon: UserPlus, help: SECTION_HELP.access },
  { group: 'Integrationen', icon: Plug, help: null },
];

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

  const known = SECTIONS.filter(s => groups[s.group]?.length);
  const extra = Object.keys(groups)
    .filter(g => !SECTIONS.some(s => s.group === g))
    .map(g => ({ group: g, icon: null, help: null }));

  return (
    <div>
      <AdminPageHeader
        icon={SlidersHorizontal}
        title="Systemkonfiguration"
        description="Laufzeitkonfiguration des Servers – Update-Einstellungen findest du unter Updates."
      />

      {/* Env priority info */}
      <Alert tone="warning" title="Priorität der Konfigurationsquellen" className="mb-6">
        <div className="flex items-start justify-between gap-2">
          <p>
            <code>.env</code> hat immer Vorrang vor der Datenbankeinstellung.
            Werte die in <code>.env</code> / <code>docker-compose.yml</code> gesetzt
            sind, können hier nicht überschrieben werden.
          </p>
          <HelpTip
            title={SECTION_HELP.precedence.title}
            short={SECTION_HELP.precedence.short}
            className="!text-amber-500 hover:!text-amber-900"
          >
            {SECTION_HELP.precedence.long}
          </HelpTip>
        </div>
      </Alert>

      <ErrorBanner message={error} />

      {loading ? (
        <AdminSpinner />
      ) : (
        <div className="space-y-6">
          {[...known, ...extra].map(({ group, icon, help }) => (
            <SectionCard
              key={group}
              icon={icon}
              title={group}
              help={help && (
                <HelpTip title={help.title} short={help.short}>{help.long}</HelpTip>
              )}
            >
              <div>
                {groups[group].map(entry => (
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
