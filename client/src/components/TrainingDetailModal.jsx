// Detail view of one planned training: what counts (criteria), current
// fulfilment state and every synced activity of the day that matched — each
// one opens the full Strava activity detail. Manual completion lives here
// too, so a training can be ticked off even without a synced activity.
import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  Activity, CheckCircle2, Circle, Pencil, Trash2, CalendarDays, FileText,
} from 'lucide-react';
import { Modal, Button, Chip } from './ui';
import { criteriaSummary } from './StravaCriteriaBuilder';

const STRAVA_ORANGE = '#FC4C02';

export function trainingLabel(plan) {
  return plan.name || plan.trainingTypeName || 'Training (eigene Kriterien)';
}

function formatMinutes(seconds) {
  return `${Math.round((seconds || 0) / 60)} min`;
}

// One matched activity as a clickable row (opens the Strava detail modal).
export function MatchedActivityRow({ activity, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen?.(activity.id)}
      className="w-full text-left rounded-xl border hairline bg-paper-50 p-2 border-l-4 hover:bg-paper-100 transition-colors"
      style={{ borderLeftColor: STRAVA_ORANGE }}
    >
      <div className="flex items-start gap-1.5">
        <Activity size={12} style={{ color: STRAVA_ORANGE }} className="flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold leading-tight text-ink-800 truncate">
            {activity.name || activity.sportType || 'Aktivität'}
          </p>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <p className="text-xs text-ink-500 truncate">
              {[
                activity.sportType,
                activity.movingTime ? formatMinutes(activity.movingTime) : null,
                activity.distance ? `${(activity.distance / 1000).toFixed(1)} km` : null,
              ].filter(Boolean).join(' · ')}
            </p>
            <p className="text-[10px] font-semibold flex-shrink-0" style={{ color: STRAVA_ORANGE }}>
              Strava
            </p>
          </div>
        </div>
      </div>
    </button>
  );
}

export default function TrainingDetailModal({
  plan, onClose, onEdit, onDelete, onToggleManual, onOpenActivity,
}) {
  const [busy, setBusy] = useState(false);
  const matches = plan.matchedActivities || (plan.fulfilledBy ? [plan.fulfilledBy] : []);
  const isCustom = !plan.trainingTypeId;
  const summary = criteriaSummary(
    isCustom ? plan.criteria?.strava : plan.trainingTypeCriteria?.strava
  );

  const handleToggle = async () => {
    setBusy(true);
    try {
      await onToggleManual(plan);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={trainingLabel(plan)}
      subtitle={format(parseISO(plan.scheduledDate), 'EEEE, d. MMMM yyyy', { locale: de })}
      icon={Activity}
      footer={
        <>
          <Button
            variant="secondary"
            className="flex-1"
            icon={Pencil}
            onClick={() => onEdit(plan)}
          >
            Bearbeiten
          </Button>
          <Button
            className="flex-1"
            loading={busy}
            icon={plan.manualCompleted ? Circle : CheckCircle2}
            onClick={handleToggle}
          >
            {plan.manualCompleted ? 'Als offen markieren' : 'Als absolviert markieren'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Status */}
        <div className={`rounded-xl border px-3.5 py-3 ${
          plan.completed ? 'border-emerald-200 bg-emerald-50/60' : 'border-ocher-200 bg-ocher-100/50'
        }`}>
          <div className="flex items-center gap-2">
            {plan.completed
              ? <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
              : <Circle size={16} className="text-ocher-500 flex-shrink-0" />}
            <p className={`text-sm font-semibold ${plan.completed ? 'text-emerald-700' : 'text-ocher-700'}`}>
              {plan.autoCompleted
                ? matches.length > 1
                  ? `Erfüllt durch ${matches.length} Aktivitäten`
                  : 'Erfüllt durch Aktivität'
                : plan.manualCompleted
                  ? 'Manuell absolviert'
                  : 'Noch offen'}
            </p>
          </div>
          {!plan.completed && (
            <p className="text-xs text-ink-400 mt-1">
              Wird automatisch erfüllt, sobald eine passende Aktivität synchronisiert wird —
              oder markiere es unten selbst als absolviert.
            </p>
          )}
          {plan.autoCompleted && plan.manualCompleted && (
            <p className="text-xs text-ink-400 mt-1">Zusätzlich manuell als absolviert markiert.</p>
          )}
        </div>

        {/* What counts */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-ink-400 mb-1.5">
            Was zählt
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Chip variant="soft" color="amber" icon={Activity}>
              {plan.trainingTypeName || 'Eigene Kriterien'}
            </Chip>
          </div>
          {summary && <p className="text-xs text-ink-500 mt-1.5">{summary}</p>}
        </div>

        {/* Matched activities */}
        {matches.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-ink-400 mb-1.5">
              {matches.length === 1 ? 'Passende Aktivität' : `Passende Aktivitäten (${matches.length})`}
            </p>
            <div className="space-y-1.5">
              {matches.map(activity => (
                <MatchedActivityRow key={activity.id} activity={activity} onOpen={onOpenActivity} />
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        {plan.notes && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-ink-400 mb-1.5 flex items-center gap-1">
              <FileText size={10} /> Notizen
            </p>
            <p className="text-sm text-ink-600 whitespace-pre-wrap">{plan.notes}</p>
          </div>
        )}

        {/* Planned for + provenance */}
        <p className="text-xs text-ink-400 flex items-center gap-1.5">
          <CalendarDays size={12} />
          Geplant für {format(parseISO(plan.scheduledDate), 'EEEE, d. MMMM yyyy', { locale: de })}
        </p>
        <p className="text-xs text-ink-400 -mt-2">
          {plan.source === 'copy-week' ? 'Aus der Vorwoche kopiert' : 'Von dir geplant'}
          {plan.createdAt && ` am ${format(parseISO(plan.createdAt), 'd. MMMM yyyy', { locale: de })}`}.
        </p>

        <button
          type="button"
          onClick={() => onDelete(plan)}
          className="text-xs font-semibold text-red-500 hover:text-red-600 transition-colors flex items-center gap-1"
        >
          <Trash2 size={12} /> Training löschen
        </button>
      </div>
    </Modal>
  );
}
