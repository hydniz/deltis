// Admin page: state of the Strava integration — setup checklist, the value
// for Strava's "Authorization Callback Domain", webhook subscription
// management and usage numbers. The credentials themselves are edited under
// Administration → System (group "Integrationen").
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plug, Activity, Check, X, RefreshCw, Trash2, Webhook } from 'lucide-react';
import api from '../utils/api';
import AdminPageHeader from '../components/admin/AdminPageHeader';
import SectionCard from '../components/admin/SectionCard';
import AdminSpinner from '../components/admin/AdminSpinner';
import ErrorBanner from '../components/admin/ErrorBanner';
import { Alert, Button } from '../components/ui';

function StatusDot({ ok, label }) {
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <span className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${
        ok ? 'bg-emerald-100 text-emerald-600' : 'bg-red-50 text-red-500'
      }`}>
        {ok ? <Check size={10} strokeWidth={3} /> : <X size={10} strokeWidth={3} />}
      </span>
      <span className={ok ? 'text-ink-700' : 'text-ink-400'}>{label}</span>
    </span>
  );
}

function InfoRow({ label, children }) {
  return (
    <div className="py-2.5 border-b hairline last:border-b-0">
      <p className="text-xs text-ink-400 mb-0.5">{label}</p>
      <div className="text-sm text-ink-800">{children}</div>
    </div>
  );
}

export default function AdminIntegrations() {
  const [overview, setOverview] = useState(null);
  const [subscriptions, setSubscriptions] = useState(null); // null = unknown
  const [subError, setSubError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/strava/admin/overview');
      setOverview(res.data);
      if (res.data.configured) {
        try {
          const subs = await api.get('/strava/admin/subscription');
          setSubscriptions(subs.data.subscriptions);
          setSubError('');
        } catch (err) {
          setSubscriptions(null);
          setSubError(err.response?.data?.error || 'Webhook-Status konnte nicht geladen werden.');
        }
      }
    } catch {
      setError('Integrationsstatus konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createSubscription = async () => {
    setBusy(true);
    setSubError('');
    try {
      await api.post('/strava/admin/subscription');
      await load();
    } catch (err) {
      setSubError(err.response?.data?.error || 'Webhook-Abo konnte nicht angelegt werden.');
    } finally {
      setBusy(false);
    }
  };

  const deleteSubscription = async (id) => {
    if (!confirm('Webhook-Abo bei Strava löschen? Neue Aktivitäten kommen dann nur noch per Polling an.')) return;
    setBusy(true);
    setSubError('');
    try {
      await api.delete(`/strava/admin/subscription/${id}`);
      await load();
    } catch (err) {
      setSubError(err.response?.data?.error || 'Webhook-Abo konnte nicht gelöscht werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <AdminPageHeader
        icon={Plug}
        title="Integrationen"
        description="Externe Dienste – Zugangsdaten pflegst du unter System → Integrationen."
      />

      <ErrorBanner message={error} />

      {loading ? (
        <AdminSpinner />
      ) : overview && (
        <div className="space-y-6">
          <SectionCard icon={Activity} title="Strava">
            <div className="space-y-4">
              {/* Setup checklist */}
              <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                <StatusDot ok={overview.clientIdSet} label="Client-ID gesetzt" />
                <StatusDot ok={overview.clientSecretSet} label="Client-Secret gesetzt" />
                <StatusDot ok={Boolean(overview.publicBaseUrl)} label="Öffentliche Basis-URL gesetzt" />
              </div>

              {!overview.configured && (
                <Alert tone="warning">
                  Hinterlege Client-ID und Client-Secret deiner Strava-API-Anwendung unter{' '}
                  <Link to="/admin/config" className="underline font-semibold">System → Integrationen</Link>.
                  Eine API-Anwendung erstellst du auf strava.com/settings/api.
                </Alert>
              )}

              <div>
                <InfoRow label='"Authorization Callback Domain" (bei Strava unter „My API Application" eintragen)'>
                  {overview.callbackDomain
                    ? <code className="font-mono text-brand-700">{overview.callbackDomain}</code>
                    : <span className="text-ink-400">Erst verfügbar, wenn die öffentliche Basis-URL gesetzt ist.</span>}
                </InfoRow>
                <InfoRow label="Webhook-Callback-URL">
                  {overview.webhookCallbackUrl
                    ? <code className="font-mono text-xs break-all">{overview.webhookCallbackUrl}</code>
                    : <span className="text-ink-400">–</span>}
                </InfoRow>
                <InfoRow label="Nutzung">
                  {overview.connectedUsers} verbundene{overview.connectedUsers === 1 ? 'r' : ''} Nutzer
                  {' · '}{overview.activityCount} synchronisierte Aktivitäten
                  {' · '}Polling: {overview.pollIntervalMinutes > 0 ? `alle ${overview.pollIntervalMinutes} Min.` : 'deaktiviert'}
                </InfoRow>
              </div>

              {/* Webhook subscription */}
              {overview.configured && (
                <div className="panel p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Webhook size={14} className="text-ink-500" />
                    <span className="text-sm font-semibold text-ink-800">Webhook-Abonnement</span>
                  </div>
                  <p className="text-xs text-ink-400">
                    Mit aktivem Webhook meldet Strava neue, geänderte und gelöschte Aktivitäten
                    sofort. Die Instanz muss dafür unter der öffentlichen Basis-URL per HTTPS
                    erreichbar sein — Strava prüft das beim Anlegen.
                  </p>

                  {subError && <Alert tone="error">{subError}</Alert>}

                  {Array.isArray(subscriptions) && subscriptions.length > 0 ? (
                    subscriptions.map(sub => (
                      <div key={sub.id} className="flex items-center justify-between gap-3 bg-surface border hairline rounded-xl px-3.5 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink-800 flex items-center gap-1.5">
                            <Check size={13} className="text-emerald-600" /> Aktiv (ID {sub.id})
                          </p>
                          <p className="text-xs text-ink-400 font-mono truncate">{sub.callback_url}</p>
                        </div>
                        <Button
                          variant="danger" size="sm" icon={Trash2} loading={busy}
                          onClick={() => deleteSubscription(sub.id)}
                        >
                          Löschen
                        </Button>
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        icon={Webhook} loading={busy}
                        disabled={!overview.webhookCallbackUrl}
                        onClick={createSubscription}
                      >
                        Webhook-Abo anlegen
                      </Button>
                      <Button variant="ghost" size="sm" icon={RefreshCw} onClick={load}>
                        Aktualisieren
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <Alert tone="info" title="Hinweise zur Strava-API">
                <ul className="text-xs space-y-1 mt-1 list-disc pl-4">
                  <li>
                    Neue Strava-Anwendungen dürfen standardmäßig nur <strong>einen Athleten</strong> (dich selbst)
                    verbinden. Für weitere Nutzer musst du bei Strava eine Kapazitätserhöhung beantragen.
                  </li>
                  <li>
                    Es gelten Rate-Limits pro Anwendung (Standard: 100 Anfragen/15 Min., 1.000/Tag).
                    Pro synchronisierter Aktivität fallen ca. 3 Anfragen an.
                  </li>
                  <li>
                    Für kommerzielle Nutzung gelten zusätzliche Bedingungen des Strava-API-Agreements —
                    Details in <code>docs/STRAVA.md</code>.
                  </li>
                </ul>
              </Alert>
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
