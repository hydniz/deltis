import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/api';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  Plus, Target, Trash2, X, Dumbbell, Sparkles, AlertTriangle, Check, Clock, Pencil, Activity,
  Layers, ChevronDown, ChevronUp, CornerDownRight, Share2,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine
} from 'recharts';
import {
  PageHeader, Button, Field, Input, Select, Chip, Segmented, Modal,
  IconButton, EmptyState, PageLoader, ProgressBar, useChart, Alert,
} from '../components/ui';
import ActivityTypeWizard from '../components/ActivityTypeWizard';
import ManageHabitsModal from '../components/ManageHabitsModal';
import StravaCriteriaBuilder, {
  normalizeCriteria, criteriaSummary, emptyGroup,
} from '../components/StravaCriteriaBuilder';
import GoalHeatmap from '../components/GoalHeatmap';

// Interval helpers

function unitLabel(value, unit) {
  if (unit === 'day') return value === 1 ? 'Tag' : 'Tage';
  if (unit === 'week') return value === 1 ? 'Woche' : 'Wochen';
  if (unit === 'month') return value === 1 ? 'Monat' : 'Monate';
  return '';
}

function intervalBadgeLabel(value, unit) {
  if (!value || !unit || (value === 1 && unit === 'week')) return 'Wöchentlich';
  if (value === 1 && unit === 'day') return 'Täglich';
  if (value === 1 && unit === 'month') return 'Monatlich';
  return `Alle ${value} ${unitLabel(value, unit)}`;
}

function intervalPeriodLabel(value, unit) {
  if (!value || !unit || (value === 1 && unit === 'week')) return 'Diese Woche';
  if (value === 1 && unit === 'day') return 'Heute';
  if (value === 1 && unit === 'month') return 'Diesen Monat';
  return `Letzte ${value} ${unitLabel(value, unit)}`;
}

function intervalTargetLabel(value, unit) {
  if (!value || !unit) return 'pro Woche';
  return `pro ${value === 1 ? '' : value + ' '}${unitLabel(value, unit)}`.trimStart();
}

function metricLabel(metric, customFields = []) {
  if (metric === 'subgoals') return 'Erfüllte Unterziele';
  if (!metric || metric === 'count') return 'Anzahl';
  if (metric === 'distance') return 'Distanz';
  if (metric === 'duration') return 'Dauer';
  if (metric === 'value') return 'Wert';
  if (metric.startsWith('custom_')) {
    const key = metric.slice(7);
    const cf = customFields.find(f => f.key === key);
    return cf?.label || key;
  }
  if (metric.startsWith('select_')) {
    const rest = metric.slice(7);
    const colonIdx = rest.indexOf(':');
    if (colonIdx === -1) return rest;
    const fieldKey = rest.slice(0, colonIdx);
    const optionValue = rest.slice(colonIdx + 1);
    const cf = customFields.find(f => f.key === fieldKey);
    return `${cf?.label || fieldKey} = ${optionValue}`;
  }
  return metric;
}

const CONDITION_OPTIONS = [
  { value: 'min', label: 'Mindestens' },
  { value: 'max', label: 'Maximal' },
  { value: 'exact', label: 'Genau' },
];

const STRAVA_ORANGE = '#FC4C02';

// Collapsible "Was zählt dazu?" breakdown: the entries contributing to the
// goal's current interval, loaded lazily from /goals/:id/items.
function GoalItemsBreakdown({ goalId }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);

  const toggle = () => {
    if (!open && items === null) {
      api.get(`/goals/${goalId}/items`)
        .then(r => setItems(r.data))
        .catch(() => setItems({ kind: 'error', entries: [] }));
    }
    setOpen(v => !v);
  };

  const renderEntry = (entry, i) => {
    if (items.kind === 'strava') {
      return (
        <li key={i} className="flex items-center gap-2 text-xs">
          <Activity size={11} style={{ color: STRAVA_ORANGE }} className="flex-shrink-0" />
          <span className="text-ink-700 font-medium truncate">{entry.name}</span>
          <span className="text-ink-400 whitespace-nowrap ml-auto">
            {format(parseISO(entry.date), 'd. MMM', { locale: de })}
            {entry.movingTime ? ` · ${Math.round(entry.movingTime / 60)} min` : ''}
            {entry.distance ? ` · ${(entry.distance / 1000).toFixed(1)} km` : ''}
          </span>
        </li>
      );
    }
    if (items.kind === 'activity') {
      return (
        <li key={i} className="flex items-center gap-2 text-xs">
          <Dumbbell size={11} className="text-brand-500 flex-shrink-0" />
          <span className="text-ink-700 font-medium truncate">{entry.name}</span>
          <span className="text-ink-400 whitespace-nowrap ml-auto">
            {format(parseISO(entry.date), 'd. MMM', { locale: de })}
            {entry.duration ? ` · ${entry.duration} min` : ''}
            {entry.distance ? ` · ${entry.distance} km` : ''}
          </span>
        </li>
      );
    }
    if (items.kind === 'habit') {
      return (
        <li key={i} className="flex items-center gap-2 text-xs">
          <Sparkles size={11} className="text-sage-500 flex-shrink-0" />
          <span className="text-ink-700 font-medium">{format(parseISO(entry.date), 'EEEE, d. MMM', { locale: de })}</span>
          <span className="text-ink-400 ml-auto">{entry.value}</span>
        </li>
      );
    }
    if (items.kind === 'meta') {
      return (
        <li key={i} className="flex items-center gap-2 text-xs">
          {entry.met
            ? <Check size={11} className="text-emerald-600 flex-shrink-0" />
            : <X size={11} className="text-red-500 flex-shrink-0" />}
          <span className="text-ink-700 font-medium truncate">{entry.name}</span>
          <span className={`ml-auto font-semibold ${entry.met ? 'text-emerald-600' : 'text-ink-400'}`}>
            {entry.met ? 'Erfüllt' : 'Offen'}
          </span>
        </li>
      );
    }
    return null;
  };

  return (
    <div className="mt-3 pt-3 border-t hairline">
      <button
        type="button"
        onClick={toggle}
        className="text-xs font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1"
      >
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        Was zählt dazu?
      </button>
      {open && (
        <div className="mt-2">
          {items === null ? (
            <p className="text-xs text-ink-300">Lade…</p>
          ) : items.entries.length === 0 ? (
            <p className="text-xs text-ink-400">Noch keine Einträge in diesem Zeitraum.</p>
          ) : (
            <ul className="space-y-1.5">{items.entries.map(renderEntry)}</ul>
          )}
        </div>
      )}
    </div>
  );
}

// Single goal progress display
// `actions` (edit/delete buttons) render inside the header row so they never
// overlap the chips on narrow screens.

function GoalProgress({ goal, actions }) {
  const CHART = useChart();
  const [progress, setProgress] = useState(null);
  const [showChart, setShowChart] = useState(false);

  useEffect(() => {
    api.get(`/goals/${goal._id}/progress`).then(r => setProgress(r.data)).catch(() => {});
  }, [goal._id]);

  const { conditions: condResults, conditionOperator: condOp, met: goalMet, weeklyData, stepResults = [], childResults = [] } = progress || {};
  const isLongTerm = goal.type.startsWith('long-term');
  const isHabit = goal.targetRefModel === 'HabitDefinition' || goal.targetRefModel === 'habit';
  const isStrava = goal.targetRefModel === 'StravaActivity';
  const isMeta = goal.type === 'meta';
  const iv = goal.intervalValue || 1;
  const iu = goal.intervalUnit || 'week';
  const customFields = goal.customFields || [];

  const firstCondTarget = condResults?.[0]?.targetValue ?? goal.targetValue;
  const nextStep = stepResults.find(s => !s.isPast);

  const sortedSteps = [...(goal.intermediateSteps || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
  const chartData = (weeklyData || []).map(d => {
    const weekDate = new Date(d.weekStart);
    let zielForWeek = firstCondTarget;
    for (const step of sortedSteps) {
      if (weekDate <= new Date(step.date)) { zielForWeek = step.targetValue; break; }
    }
    return { date: format(parseISO(d.weekStart), 'd. MMM', { locale: de }), Wert: d.value, Ziel: zielForWeek };
  });

  const renderConditionBar = (cond, idx) => {
    const { condition, currentValue, targetValue, unitSymbol, met: condMet } = cond;
    let pct = 0, tone = 'danger', statusText = '';
    if (currentValue !== undefined) {
      if (condition === 'min') {
        pct = Math.min(100, (currentValue / targetValue) * 100);
        tone = 'auto';
        statusText = pct >= 100 ? 'Erreicht' : `${currentValue} / ${targetValue}`;
      } else if (condition === 'max') {
        pct = currentValue <= targetValue ? 100 : Math.max(0, 100 - ((currentValue - targetValue) / targetValue) * 100);
        tone = currentValue <= targetValue ? 'success' : 'danger';
        statusText = currentValue <= targetValue ? 'Im Zielbereich' : `${currentValue} (max. ${targetValue})`;
      } else {
        pct = currentValue === targetValue ? 100 : (currentValue / targetValue) * 100;
        tone = currentValue === targetValue ? 'success' : 'warning';
        statusText = `${currentValue} / ${targetValue}`;
      }
    }

    const condLabel = condition === 'min' ? 'mindestens' : condition === 'max' ? 'maximal' : 'genau';
    const scopeSuffix = cond.aggregation === 'max'
      ? ' · Bestleistung'
      : cond.valueScope === 'perActivity' ? ' · Ø pro Aktivität' : '';

    return (
      <div key={idx} className="space-y-1.5">
        <div className="flex items-center justify-between text-xs gap-2">
          <span className="text-ink-500">
            {metricLabel(cond.metric, customFields)} ({condLabel} {targetValue}{unitSymbol ? ` ${unitSymbol}` : ''}{scopeSuffix}):
            {' '}<span className="text-ink-800 font-semibold">{currentValue} {unitSymbol}</span>
          </span>
          <span className={`font-semibold whitespace-nowrap ${condMet ? 'text-emerald-600' : pct >= 60 ? 'text-ocher-600' : 'text-red-600'}`}>
            {statusText}
          </span>
        </div>
        <ProgressBar pct={pct} tone={tone} />
      </div>
    );
  };


  // Category accent: habits lean sage, activities lean terracotta.
  const accentBorder = isHabit ? 'border-l-sage-400' : 'border-l-brand-400';
  const accentText = isHabit ? 'text-sage-600' : 'text-brand-600';

  return (
    <div className={`card p-5 border-l-4 ${accentBorder}`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="display text-lg leading-snug">{goal.name}</h3>
          <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
            {isMeta ? (
              <Chip variant="soft" color="amber" icon={Layers}>Gesamtziel</Chip>
            ) : (<>
              <Chip variant="soft" color={isLongTerm ? 'amber' : 'olive'}>
                {isLongTerm ? 'Langfristig' : intervalBadgeLabel(iv, iu)}
              </Chip>
              <Chip variant="soft" color={isHabit ? 'sage' : 'clay'} icon={isHabit ? Sparkles : isStrava ? Activity : Dumbbell}>
                {isHabit ? 'Gewohnheit' : isStrava ? 'Strava' : 'Aktivität'}
              </Chip>
            </>)}
            {goal.parentGoal && (
              <Chip variant="soft" color="stone" icon={CornerDownRight}>
                Teil von: {goal.parentGoal.name}
              </Chip>
            )}
          </div>
          {goal.description && <p className="text-xs text-ink-400 mt-1.5">{goal.description}</p>}
          {goal.metricWarnings?.length > 0 && (
            <div className="mt-1.5 flex flex-col gap-0.5">
              {goal.metricWarnings.map((w, i) => (
                <p key={i} className="text-xs text-ocher-600 flex items-center gap-1">
                  <AlertTriangle size={11} className="flex-shrink-0" />
                  {w}
                </p>
              ))}
            </div>
          )}
          <p className="text-xs text-ink-400 mt-1">
            {goal.targetName && <span className="text-ink-600 font-medium">{goal.targetName}</span>}
            {!isLongTerm && <> {intervalTargetLabel(iv, iu)}</>}
          </p>
          {isStrava && (
            <p className="text-xs text-ink-400 mt-0.5">{criteriaSummary(goal.stravaCriteria)}</p>
          )}
          {goal.endDate && (
            <p className="text-xs text-ink-300 mt-0.5">Bis {format(parseISO(goal.endDate), 'd. MMMM yyyy', { locale: de })}</p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-0.5 flex-shrink-0 -mt-1 -mr-1.5">
            {actions}
          </div>
        )}
      </div>

      {progress && condResults && condResults.length > 0 && (
        <div className="space-y-3 mb-3">
          <div className={`text-[11px] uppercase tracking-[0.09em] font-semibold ${accentText}`}>
            {isLongTerm ? 'Gesamt' : intervalPeriodLabel(iv, iu)}
          </div>
          {condResults.map((cond, idx) => (
            <div key={idx}>
              {idx > 0 && (
                <div className="flex items-center gap-2 my-1.5">
                  <div className="flex-1 h-px bg-paper-200" />
                  <span className="text-xs font-semibold text-ink-400 px-1">
                    {condOp === 'OR' ? 'ODER' : 'UND'}
                  </span>
                  <div className="flex-1 h-px bg-paper-200" />
                </div>
              )}
              {renderConditionBar(cond, idx)}
            </div>
          ))}
          {condResults.length > 1 && (
            <div className={`text-xs font-semibold mt-1 ${goalMet ? 'text-emerald-600' : 'text-red-600'}`}>
              Gesamtziel: {goalMet ? 'Erfüllt' : 'Nicht erfüllt'}
            </div>
          )}
        </div>
      )}

      {/* Meta goals: per-child status */}
      {isMeta && childResults.length > 0 && (
        <div className="mb-3 space-y-1.5">
          <div className="text-[11px] text-ink-400 uppercase tracking-[0.09em] font-semibold">Unterziele</div>
          {childResults.map(child => (
            <div key={child._id} className="flex items-center gap-2 text-xs">
              {child.met
                ? <Check size={12} className="text-emerald-600 flex-shrink-0" />
                : <Clock size={12} className="text-ink-300 flex-shrink-0" />}
              <span className={`font-medium truncate ${child.met ? 'text-emerald-700' : 'text-ink-600'}`}>
                {child.name}
              </span>
              <span className={`ml-auto font-semibold whitespace-nowrap ${child.met ? 'text-emerald-600' : 'text-ink-400'}`}>
                {child.met ? 'Erfüllt' : 'Offen'}
              </span>
            </div>
          ))}
        </div>
      )}

      {isLongTerm && stepResults.length > 0 && (
        <div className="mb-3 space-y-2">
          <div className="text-[11px] text-ocher-600 uppercase tracking-[0.09em] font-semibold">Zwischenziele</div>

          {/* Progress towards the next milestone */}
          {nextStep && condResults?.length > 0 && (() => {
            const firstResult = condResults[0];
            const current = firstResult?.currentValue ?? 0;
            const isMaxAgg = firstResult?.aggregation === 'max';
            const pct = Math.min(100, (current / nextStep.targetValue) * 100);
            return (
              <div className="bg-ocher-100/60 border border-ocher-200 rounded-xl px-3.5 py-3">
                <div className="flex items-center justify-between text-xs mb-1 gap-2">
                  <span className="text-ocher-700 font-semibold">
                    Nächstes Zwischenziel: {nextStep.targetValue} {goal.unitSymbol}
                    {isMaxAgg && <span className="font-normal opacity-70"> (Bestleistung)</span>}
                  </span>
                  <span className="text-ink-400 whitespace-nowrap">
                    bis {format(parseISO(nextStep.date), 'd. MMM yyyy', { locale: de })}
                  </span>
                </div>
                {nextStep.description && <div className="text-xs text-ink-500 mb-1">{nextStep.description}</div>}
                <div className="flex justify-between text-xs text-ink-500 mb-1.5">
                  <span>{isMaxAgg ? 'Beste Einzelleistung' : 'Aktuell'}: {current} / {nextStep.targetValue} {goal.unitSymbol}</span>
                  <span>{Math.round(pct)}%</span>
                </div>
                <ProgressBar pct={pct} className="!h-1.5" />
              </div>
            );
          })()}

          {/* Milestone timeline */}
          <div className="space-y-1.5">
            {stepResults.map((step, idx) => {
              const isPast = step.isPast;
              const met = step.met;
              const iconClass = !isPast
                ? 'border border-ink-200 text-ink-400 bg-surface'
                : met
                  ? 'bg-emerald-50 border border-emerald-400 text-emerald-600'
                  : 'bg-red-50 border border-red-300 text-red-500';
              return (
                <div key={idx} className="flex items-start gap-2 text-xs">
                  <div className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${iconClass}`}>
                    {!isPast ? <Clock size={8} /> : met ? <Check size={8} /> : <X size={8} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`font-medium ${isPast ? (met ? 'text-emerald-700' : 'text-red-600') : 'text-ink-700'}`}>
                      {step.targetValue} {goal.unitSymbol}
                    </span>
                    <span className="text-ink-400"> bis {format(parseISO(step.date), 'd. MMM yyyy', { locale: de })}</span>
                    {isPast && step.actualValue !== null && (
                      <span className="text-ink-300"> · Erreicht: {step.actualValue} {goal.unitSymbol}</span>
                    )}
                    {step.description && <div className="text-ink-400 mt-0.5">{step.description}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isLongTerm && chartData.length > 0 && (
        <>
          <button
            onClick={() => setShowChart(v => !v)}
            className="text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors mb-2"
          >
            {showChart ? 'Verlauf ausblenden' : 'Verlauf anzeigen'}
          </button>
          {showChart && (
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                <XAxis dataKey="date" tick={CHART.tick} tickLine={false} />
                <YAxis tick={CHART.tick} tickLine={false} axisLine={false} width={30} />
                <Tooltip contentStyle={CHART.tooltip} />
                <Line type="monotone" dataKey="Wert" stroke={CHART.line} strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Ziel" stroke={CHART.lineMuted} strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                {stepResults.map((step, idx) => (
                  <ReferenceLine
                    key={idx}
                    y={step.targetValue}
                    stroke={!step.isPast ? '#d4a44e' : step.met ? '#10b981' : '#ef4444'}
                    strokeDasharray="3 2"
                    strokeWidth={1}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </>
      )}

      {/* Daily contribution heatmap — meta goals have no daily contribution */}
      {!isMeta && <GoalHeatmap goal={goal} />}

      {/* Contribution breakdown — why does this goal have this progress? */}
      <GoalItemsBreakdown goalId={goal._id} />
    </div>
  );
}

// Shared "what is measured" scope selector

function ScopeSelector({ cond, isActivityGoal, isLongTerm, onChange }) {
  if (isActivityGoal) {
    const value = cond.aggregation === 'max' ? 'best' : cond.valueScope === 'perActivity' ? 'avg' : 'total';
    return (
      <>
        <Segmented
          value={value}
          onChange={v => onChange(
            v === 'best' ? { valueScope: 'total', aggregation: 'max' }
            : v === 'avg' ? { valueScope: 'perActivity', aggregation: 'sum' }
            : { valueScope: 'total', aggregation: 'sum' }
          )}
          options={[
            { value: 'total', label: isLongTerm ? 'Gesamt' : 'pro Intervall' },
            { value: 'avg', label: 'Ø / Aktivität' },
            { value: 'best', label: 'Bestleistung', tone: 'warn' },
          ]}
        />
        <p className="text-xs text-ink-400 mt-1.5">
          {cond.aggregation === 'max' ? 'Höchster Wert in einer einzelnen Aktivität.'
            : cond.valueScope === 'perActivity' ? 'Durchschnitt aller Aktivitäten.'
            : isLongTerm ? 'Alle Aktivitäten werden summiert.' : 'Summe im Intervall.'}
        </p>
      </>
    );
  }
  return (
    <Segmented
      value={cond.valueScope === 'perActivity' ? 'avg' : 'total'}
      onChange={v => onChange(
        v === 'avg' ? { valueScope: 'perActivity', aggregation: 'sum' } : { valueScope: 'total', aggregation: 'sum' }
      )}
      options={[
        { value: 'total', label: 'Gesamt' },
        { value: 'avg', label: 'Ø pro Tag' },
      ]}
    />
  );
}

// Shared activity filter editor (used by create & edit for "Bestleistung")

function ActivityFilterEditor({ filters, filterFields, onAdd, onUpdate, onRemove, onToggleValue }) {
  if (!filterFields.length) return null;
  return (
    <div className="panel p-3.5 space-y-2.5">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-semibold text-ink-700">In derselben Aktivität</span>
          <p className="text-xs text-ink-400 mt-0.5">Felder, die in der Bestleistungs-Aktivität erfüllt sein müssen</p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="text-xs font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1 flex-shrink-0"
        >
          <Plus size={11} /> Filter
        </button>
      </div>
      {filters.length === 0 && (
        <p className="text-xs text-ink-300">Kein Filter – gilt für alle Aktivitäten.</p>
      )}
      {filters.map((filter, fi) => {
        const field = filterFields.find(f => f.key === filter.fieldKey) || filterFields[0];
        const isNum = (filter.fieldType || 'select') === 'number';
        return (
          <div key={fi} className="bg-surface border hairline rounded-xl p-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <Select
                className="!text-xs !py-1.5 flex-1"
                value={filter.fieldKey}
                onChange={e => {
                  const nf = filterFields.find(f => f.key === e.target.value) || filterFields[0];
                  onUpdate(fi, { fieldKey: nf.key, fieldType: nf.type, values: [], numValue: '', numOperator: 'min' });
                }}
              >
                {filterFields.map(f => <option key={f.key} value={f.key}>{f.label}{f.unit ? ` (${f.unit})` : ''}</option>)}
              </Select>
              <IconButton icon={X} label="Filter entfernen" tone="danger" size={13} onClick={() => onRemove(fi)} />
            </div>
            {isNum ? (
              <div className="space-y-1.5">
                <Segmented
                  value={filter.numOperator || 'min'}
                  onChange={v => onUpdate(fi, { numOperator: v })}
                  options={CONDITION_OPTIONS}
                />
                <div className="flex gap-2 items-center">
                  <Input
                    type="number"
                    className="flex-1 !text-sm !py-1.5"
                    value={filter.numValue ?? ''}
                    onChange={e => onUpdate(fi, { numValue: e.target.value === '' ? '' : +e.target.value })}
                    placeholder="Wert"
                    min="0"
                    step="0.1"
                  />
                  {field?.unit && <span className="text-xs text-ink-500 flex-shrink-0">{field.unit}</span>}
                </div>
              </div>
            ) : (
              <div>
                <p className="text-xs text-ink-400 mb-1.5">Muss einen dieser Werte haben:</p>
                <div className="flex flex-wrap gap-1.5">
                  {(field?.options || []).map(opt => (
                    <Chip
                      key={opt}
                      color="clay"
                      active={(filter.values || []).includes(opt)}
                      onClick={() => onToggleValue(fi, opt)}
                    >
                      {opt}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Goal creation wizard

function CreateGoalModal({ activityTypes, habits, strava, existingGoals = [], trainingTypes = [], onSave, onClose, onTargetsChanged }) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    isLongTerm: false,
    isMeta: false,
    targetCategory: 'activity',
    intervalValue: 1,
    intervalUnit: 'week',
    targetRef: activityTypes[0]?._id || '',
    targetRefModel: 'ActivityType',
    conditionOperator: 'AND',
    conditions: [{ metric: 'count', condition: 'min', targetValue: '', unitSymbol: 'Mal', valueScope: 'total', aggregation: 'sum', activityFilters: [] }],
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
    stravaCriteria: null,
    trainingTypeId: '',
  });
  const [steps, setSteps] = useState([]);
  const [saving, setSaving] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  // Strava goals: saved training type vs ad-hoc criteria
  const [stravaMode, setStravaMode] = useState('custom'); // 'custom' | 'type'
  // Meta goals: child selection + threshold
  const [metaChildIds, setMetaChildIds] = useState([]);
  const [metaTargetValue, setMetaTargetValue] = useState('');
  // Eligible children: regular goals without another parent
  const eligibleChildren = existingGoals.filter(g => g.type !== 'meta' && !g.parentGoal);

  // Inline creation of missing targets — the goal wizard stays mounted with
  // all its state, and the freshly created item is selected on return.
  const [showCreateType, setShowCreateType] = useState(false);
  const [showCreateHabit, setShowCreateHabit] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleTypeCreated = async (typeForm) => {
    const res = await api.post('/activity-types', typeForm);
    const created = res.data;
    await onTargetsChanged?.();
    setForm(f => ({ ...f, targetRef: created._id }));
    setShowCreateType(false);
  };

  // The central manage modal reports the most recently created habit so the
  // wizard can preselect it as the goal target.
  const handleHabitsManaged = async (lastCreated) => {
    await onTargetsChanged?.();
    if (lastCreated) {
      setForm(f => ({
        ...f,
        targetRef: lastCreated._id,
        conditions: f.conditions.map(c =>
          c.metric === 'value' ? { ...c, unitSymbol: lastCreated.unitSymbol || '' } : c
        ),
      }));
    }
    setShowCreateHabit(false);
  };

  const isActivityGoal = form.targetCategory === 'activity';
  const isStravaGoal = form.targetCategory === 'strava';
  const selectedActivityType = activityTypes.find(t => t._id === form.targetRef);
  const selectedHabit = habits.find(h => h._id === form.targetRef);

  const unitForMetric = (metric, actType, habit) => {
    if (metric === 'count') return form.targetCategory === 'habit' ? 'Tage' : 'Mal';
    if (metric === 'distance') return 'km';
    if (metric === 'duration') return 'min';
    if (metric === 'value') return habit?.unitSymbol || '';
    if (metric?.startsWith('custom_')) {
      const key = metric.slice(7);
      const field = actType?.customFields?.find(f => f.key === key);
      return field?.unit || '';
    }
    if (metric?.startsWith('select_')) return 'Mal';
    return '';
  };

  const handleCategoryChange = (category) => {
    if (category === 'strava') {
      setForm(f => ({
        ...f,
        targetCategory: 'strava',
        targetRefModel: 'StravaActivity',
        // Strava goals reference no document — the criteria tree is the target.
        targetRef: 'strava',
        stravaCriteria: f.stravaCriteria || emptyGroup(),
        conditions: [{ metric: 'count', condition: 'min', targetValue: '', unitSymbol: 'Mal', valueScope: 'total', aggregation: 'sum', activityFilters: [] }],
      }));
      return;
    }
    const isAct = category === 'activity';
    const firstHabit = habits[0];
    const defaultMetric = isAct ? 'count' : 'value';
    const defaultUnit = isAct ? 'Mal' : (firstHabit?.unitSymbol || '');
    setForm(f => ({
      ...f,
      targetCategory: category,
      targetRefModel: isAct ? 'ActivityType' : 'HabitDefinition',
      targetRef: isAct ? (activityTypes[0]?._id || '') : (firstHabit?._id || ''),
      conditions: [{ metric: defaultMetric, condition: 'min', targetValue: '', unitSymbol: defaultUnit, valueScope: 'total', aggregation: 'sum', activityFilters: [] }],
    }));
  };

  // Long-term Strava goals are not supported (yet) — switching to long-term
  // falls back to the activity category.
  const handleLongTermChange = (isLongTerm) => {
    if (isLongTerm && form.targetCategory === 'strava') {
      handleCategoryChange('activity');
    }
    set('isLongTerm', isLongTerm);
  };

  // Zielart: periodisch | langfristig | Gesamtziel (meta)
  const handleZielartChange = (zielart) => {
    if (zielart === 'meta') {
      setForm(f => ({ ...f, isMeta: true, isLongTerm: false }));
      return;
    }
    setForm(f => ({ ...f, isMeta: false }));
    handleLongTermChange(zielart === 'longterm');
  };

  const toggleMetaChild = (id) => {
    setMetaChildIds(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]);
  };

  const handleRefChange = (ref) => {
    if (!isActivityGoal) {
      const h = habits.find(h => h._id === ref);
      setForm(f => ({
        ...f,
        targetRef: ref,
        conditions: f.conditions.map(c =>
          c.metric === 'value' ? { ...c, unitSymbol: h?.unitSymbol || '' } : c
        ),
      }));
    } else {
      const newActType = activityTypes.find(t => t._id === ref);
      const validCustomKeys = (newActType?.customFields || []).map(cf => `custom_${cf.key}`);
      setForm(f => ({
        ...f,
        targetRef: ref,
        conditions: f.conditions.map(c => {
          let newMetric = c.metric;
          if (newMetric === 'distance' && !newActType?.showDistance) newMetric = 'count';
          if (newMetric === 'duration' && newActType?.showDuration === false) newMetric = 'count';
          if (newMetric?.startsWith('custom_') && !validCustomKeys.includes(newMetric)) newMetric = 'count';
          const newUnit = unitForMetric(newMetric, newActType, null);
          return { ...c, metric: newMetric, unitSymbol: newUnit };
        }),
      }));
    }
  };

  const addCondition = () => {
    const defaultMetric = isActivityGoal ? 'count' : 'value';
    const defaultUnit = unitForMetric(defaultMetric, selectedActivityType, selectedHabit);
    setForm(f => ({
      ...f,
      conditions: [...f.conditions, { metric: defaultMetric, condition: 'min', targetValue: '', unitSymbol: defaultUnit, valueScope: 'total', aggregation: 'sum', activityFilters: [] }],
    }));
  };

  const updateCondition = (i, key, value) => {
    setForm(f => ({
      ...f,
      conditions: f.conditions.map((c, idx) => idx === i ? { ...c, [key]: value } : c),
    }));
  };

  const removeCondition = (i) => {
    setForm(f => ({
      ...f,
      conditions: f.conditions.filter((_, idx) => idx !== i),
    }));
  };

  const scopeApplies = (metric) =>
    metric && metric !== 'count' && !metric.startsWith('select_');

  const updateConditionFields = (i, changes) =>
    setForm(f => ({
      ...f,
      conditions: f.conditions.map((c, idx) => idx === i ? { ...c, ...changes } : c),
    }));

  const getFilterableFields = () => {
    const fields = [];
    if (selectedActivityType?.showDuration !== false)
      fields.push({ key: 'duration', label: 'Dauer', type: 'number', unit: 'min' });
    if (selectedActivityType?.showDistance)
      fields.push({ key: 'distance', label: 'Distanz', type: 'number', unit: 'km' });
    for (const f of selectedActivityType?.customFields || []) {
      fields.push({
        key: f.key, label: f.label,
        type: (f.type === 'select' || f.type === 'multiselect') ? 'select' : 'number',
        unit: f.unit, options: f.options,
      });
    }
    return fields;
  };

  const addActivityFilter = (ci) => {
    const fields = getFilterableFields();
    if (!fields.length) return;
    const first = fields[0];
    updateConditionFields(ci, {
      activityFilters: [...(form.conditions[ci].activityFilters || []), {
        fieldKey: first.key, fieldType: first.type,
        operator: 'anyOf', values: [], numOperator: 'min', numValue: ''
      }]
    });
  };
  const updateActivityFilter = (ci, fi, changes) =>
    setForm(f => ({
      ...f,
      conditions: f.conditions.map((c, i) => i !== ci ? c : {
        ...c, activityFilters: (c.activityFilters || []).map((af, j) => j !== fi ? af : { ...af, ...changes })
      })
    }));
  const removeActivityFilter = (ci, fi) =>
    setForm(f => ({
      ...f,
      conditions: f.conditions.map((c, i) => i !== ci ? c : {
        ...c, activityFilters: (c.activityFilters || []).filter((_, j) => j !== fi)
      })
    }));
  const toggleFilterValue = (ci, fi, value) => {
    const filter = form.conditions[ci]?.activityFilters?.[fi];
    if (!filter) return;
    const values = filter.values.includes(value)
      ? filter.values.filter(v => v !== value)
      : [...filter.values, value];
    updateActivityFilter(ci, fi, { values });
  };

  const handleMetricChangeForCondition = (i, metric) => {
    const newUnit = unitForMetric(metric, selectedActivityType, selectedHabit);
    const applies = scopeApplies(metric);
    setForm(f => ({
      ...f,
      conditions: f.conditions.map((c, idx) =>
        idx === i
          ? { ...c, metric, unitSymbol: newUnit, valueScope: applies ? c.valueScope : 'total', aggregation: applies ? c.aggregation : 'sum' }
          : c
      ),
    }));
  };

  const addStep = () => setSteps(s => [...s, { date: '', targetValue: '', description: '' }]);
  const updateStep = (i, k, v) => setSteps(s => s.map((step, idx) => idx === i ? { ...step, [k]: v } : step));
  const removeStep = (i) => setSteps(s => s.filter((_, idx) => idx !== i));

  const handleSubmit = async () => {
    if (form.isMeta) {
      setSaving(true);
      try {
        await api.post('/goals', {
          name: form.name,
          description: form.description || undefined,
          type: 'meta',
          targetValue: +metaTargetValue,
          childGoalIds: metaChildIds,
        });
        onSave();
      } catch (err) {
        alert('Fehler: ' + (err.response?.data?.error || err.message));
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!form.targetRef) return;
    setSaving(true);

    const goalType = form.isLongTerm
      ? `long-term-${form.targetCategory}`
      : `periodic-${form.targetCategory}`;

    const validConditions = form.conditions.filter(c => c.targetValue !== '');
    if (validConditions.length === 0) return;

    const firstCond = validConditions[0];

    try {
      await api.post('/goals', {
        name: form.name,
        description: form.description || undefined,
        type: goalType,
        targetRef: form.targetRef,
        targetRefModel: form.targetRefModel,
        stravaCriteria: isStravaGoal && stravaMode !== 'type' ? normalizeCriteria(form.stravaCriteria) : undefined,
        trainingTypeId: isStravaGoal && stravaMode === 'type' ? form.trainingTypeId : undefined,
        conditionOperator: form.conditionOperator,
        conditions: validConditions.map(c => ({ ...c, targetValue: +c.targetValue })),
        // Legacy fields from first condition for backward compat
        condition: firstCond.condition,
        targetValue: +firstCond.targetValue,
        unitSymbol: firstCond.unitSymbol,
        metric: firstCond.metric,
        intervalValue: !form.isLongTerm ? form.intervalValue : undefined,
        intervalUnit: !form.isLongTerm ? form.intervalUnit : undefined,
        startDate: form.isLongTerm ? (form.startDate || undefined) : undefined,
        endDate: form.isLongTerm ? (form.endDate || undefined) : undefined,
        intermediateSteps: form.isLongTerm
          ? steps.filter(s => s.date && s.targetValue).map(s => ({ ...s, targetValue: +s.targetValue }))
          : [],
      });
      onSave();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const targetLabel = intervalTargetLabel(form.intervalValue, form.intervalUnit);
  const totalSteps = form.isLongTerm ? 3 : 2;
  const stepTitles = form.isMeta
    ? ['Grundlagen', 'Unterziele']
    : ['Grundlagen', 'Was & Bedingungen', 'Meilensteine'];

  const metaTargetNum = +metaTargetValue;
  const metaValid = form.name.trim() && metaChildIds.length > 0 &&
    Number.isInteger(metaTargetNum) && metaTargetNum >= 1 && metaTargetNum <= metaChildIds.length;

  return (
    <>
    <Modal
      onClose={() => {
        // Keep the wizard (and its state) open while a nested creation
        // modal is on top — Escape/backdrop should only close the top one.
        if (!showCreateType && !showCreateHabit) onClose();
      }}
      title="Neues Ziel"
      subtitle={stepTitles[currentStep - 1]}
      size="lg"
      steps={totalSteps}
      step={currentStep}
      footer={
        <>
          {currentStep > 1
            ? <Button variant="secondary" className="flex-1" onClick={() => setCurrentStep(s => s - 1)}>Zurück</Button>
            : <Button variant="secondary" className="flex-1" onClick={onClose}>Abbrechen</Button>
          }
          {currentStep < totalSteps ? (
            <Button
              className="flex-1"
              disabled={currentStep === 1 && !form.name.trim()}
              onClick={() => setCurrentStep(s => s + 1)}
            >
              Weiter
            </Button>
          ) : (
            <Button
              className="flex-1"
              loading={saving}
              disabled={form.isMeta
                ? !metaValid
                : (!form.name.trim() || !form.targetRef || !form.conditions.some(c => c.targetValue !== ''))}
              onClick={handleSubmit}
            >
              Ziel erstellen
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {/* Step 1: basics */}
        {currentStep === 1 && (<>
          <Field label="Name">
            <Input
              className="!text-base"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="z.B. Öfter laufen gehen"
              autoFocus
            />
          </Field>

          <div>
            <label className="label">Zielart</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleZielartChange('periodic')}
                className={`p-3.5 rounded-xl border text-left transition-colors ${
                  !form.isLongTerm && !form.isMeta
                    ? 'border-brand-400 bg-brand-50 text-ink-900'
                    : 'border-paper-200 bg-paper-50 text-ink-400 hover:text-ink-600'
                }`}
              >
                <div className="font-semibold text-sm">Periodisch</div>
                <div className="text-xs opacity-70 mt-0.5">Täglich, wöchentlich…</div>
              </button>
              <button
                type="button"
                onClick={() => handleZielartChange('longterm')}
                className={`p-3.5 rounded-xl border text-left transition-colors ${
                  form.isLongTerm
                    ? 'border-ocher-400 bg-ocher-100/60 text-ink-900'
                    : 'border-paper-200 bg-paper-50 text-ink-400 hover:text-ink-600'
                }`}
              >
                <div className="font-semibold text-sm">Langfristig</div>
                <div className="text-xs opacity-70 mt-0.5">Enddatum & Meilensteine</div>
              </button>
              <button
                type="button"
                onClick={() => handleZielartChange('meta')}
                className={`p-3.5 rounded-xl border text-left transition-colors ${
                  form.isMeta
                    ? 'border-ocher-400 bg-ocher-100/60 text-ink-900'
                    : 'border-paper-200 bg-paper-50 text-ink-400 hover:text-ink-600'
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-sm"><Layers size={13} /> Gesamtziel</div>
                <div className="text-xs opacity-70 mt-0.5">Bündelt andere Ziele</div>
              </button>
            </div>
            <p className="text-xs text-ink-400 mt-2">
              {form.isMeta
                ? 'Erfüllt, wenn genügend Unterziele erfüllt sind — z. B. „3 von 4 Zielen“.'
                : !form.isLongTerm
                  ? 'Läuft dauerhaft. Fortschritt wird pro Intervall gemessen.'
                  : 'Hat ein Enddatum. Ideal für Projekte & persönliche Rekorde.'}
            </p>
          </div>

          {!form.isLongTerm && !form.isMeta && (
            <div className="panel p-4">
              <label className="label">Intervall</label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  className="!w-20"
                  min="1"
                  max="365"
                  value={form.intervalValue}
                  onChange={e => set('intervalValue', Math.max(1, parseInt(e.target.value) || 1))}
                />
                <Select className="flex-1" value={form.intervalUnit} onChange={e => set('intervalUnit', e.target.value)}>
                  <option value="day">Tag(e)</option>
                  <option value="week">Woche(n)</option>
                  <option value="month">Monat(e)</option>
                </Select>
              </div>
              <p className="text-xs text-ink-400 mt-2">Fortschritt wird {targetLabel} gemessen</p>
            </div>
          )}

          {form.isLongTerm && (
            <div className="panel p-4">
              <label className="label">Zeitraum</label>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start">
                  <Input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} />
                </Field>
                <Field label="Ende">
                  <Input type="date" value={form.endDate} onChange={e => set('endDate', e.target.value)} />
                </Field>
              </div>
            </div>
          )}

          <Field label="Beschreibung" optional>
            <Input value={form.description} onChange={e => set('description', e.target.value)} placeholder="Kurze Notiz" />
          </Field>
        </>)}

        {/* Step 2 (meta): pick sub-goals + threshold */}
        {currentStep === 2 && form.isMeta && (<>
          <div>
            <label className="label">Unterziele</label>
            {eligibleChildren.length === 0 ? (
              <p className="text-sm text-ink-400 border-2 border-dashed border-ink-200 rounded-2xl py-6 px-4 text-center">
                Keine verfügbaren Ziele. Lege zuerst normale Ziele an — danach kannst du
                sie hier zu einem Gesamtziel bündeln. (Ziele, die bereits zu einem anderen
                Gesamtziel gehören, tauchen hier nicht auf.)
              </p>
            ) : (
              <div className="space-y-2">
                {eligibleChildren.map(g => {
                  const selected = metaChildIds.includes(g._id);
                  return (
                    <button
                      key={g._id}
                      type="button"
                      onClick={() => toggleMetaChild(g._id)}
                      className={`w-full flex items-center gap-2.5 p-3 rounded-xl border text-left transition-colors ${
                        selected
                          ? 'border-brand-400 bg-brand-50'
                          : 'border-paper-200 bg-paper-50 hover:border-ink-300'
                      }`}
                    >
                      <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${
                        selected ? 'bg-brand-500 border-brand-500' : 'border-ink-200 bg-surface'
                      }`}>
                        {selected && <Check size={12} className="text-white" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink-800 truncate">{g.name}</span>
                        <span className="block text-xs text-ink-400">{g.targetName}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {metaChildIds.length > 0 && (
            <Field
              label="Erfüllt, wenn mindestens … Unterziele erfüllt sind"
              hint={`z. B. ${Math.max(metaChildIds.length - 1, 1)} von ${metaChildIds.length}`}
            >
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  className="!w-24"
                  min="1"
                  max={metaChildIds.length}
                  value={metaTargetValue}
                  onChange={e => setMetaTargetValue(e.target.value)}
                  placeholder={String(metaChildIds.length)}
                />
                <span className="text-sm text-ink-500">von {metaChildIds.length} Unterzielen</span>
              </div>
            </Field>
          )}
        </>)}

        {/* Step 2: target & conditions */}
        {currentStep === 2 && !form.isMeta && (<>
          <div>
            <label className="label">Kategorie</label>
            <div className={`grid grid-cols-2 gap-2 ${strava?.configured && !form.isLongTerm ? 'sm:grid-cols-3' : ''}`}>
              <button
                type="button"
                onClick={() => handleCategoryChange('activity')}
                className={`p-3.5 rounded-xl border text-left transition-colors ${
                  form.targetCategory === 'activity'
                    ? 'border-brand-400 bg-brand-50 text-ink-900'
                    : 'border-paper-200 bg-paper-50 text-ink-400 hover:text-ink-600'
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-sm"><Dumbbell size={13} /> Aktivität</div>
                <div className="text-xs opacity-70 mt-0.5">Sport, Training…</div>
              </button>
              <button
                type="button"
                onClick={() => handleCategoryChange('habit')}
                className={`p-3.5 rounded-xl border text-left transition-colors ${
                  form.targetCategory === 'habit'
                    ? 'border-sage-400 bg-sage-100/70 text-ink-900'
                    : 'border-paper-200 bg-paper-50 text-ink-400 hover:text-ink-600'
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-sm"><Sparkles size={13} /> Gewohnheit</div>
                <div className="text-xs opacity-70 mt-0.5">Tägliche Routinen…</div>
              </button>
              {strava?.configured && !form.isLongTerm && (
                <button
                  type="button"
                  onClick={() => handleCategoryChange('strava')}
                  className={`p-3.5 rounded-xl border text-left transition-colors ${
                    form.targetCategory === 'strava'
                      ? 'border-brand-400 bg-brand-50 text-ink-900'
                      : 'border-paper-200 bg-paper-50 text-ink-400 hover:text-ink-600'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-semibold text-sm"><Activity size={13} /> Strava</div>
                  <div className="text-xs opacity-70 mt-0.5">Nach Kriterien…</div>
                </button>
              )}
            </div>
          </div>

          {isStravaGoal && (<>
            {!strava?.connected && (
              <Alert tone="warning">
                Du hast noch kein Strava-Konto verbunden — ohne Verbindung kann der
                Fortschritt dieses Ziels nicht gemessen werden.{' '}
                <Link to="/settings/integrations" className="underline font-semibold whitespace-nowrap">
                  Jetzt in den Einstellungen verbinden →
                </Link>
              </Alert>
            )}

            {trainingTypes.length > 0 && (
              <Field label="Was zählt als Training?">
                <Segmented
                  value={stravaMode}
                  onChange={mode => {
                    setStravaMode(mode);
                    if (mode === 'type' && !form.trainingTypeId) set('trainingTypeId', trainingTypes[0]._id);
                  }}
                  options={[
                    { value: 'custom', label: 'Eigene Kriterien' },
                    { value: 'type', label: 'Trainingstyp' },
                  ]}
                />
              </Field>
            )}

            {stravaMode === 'type' && trainingTypes.length > 0 ? (
              <Field
                label="Trainingstyp"
                hint={criteriaSummary(trainingTypes.find(t => t._id === form.trainingTypeId)?.criteria?.strava)}
              >
                <Select value={form.trainingTypeId} onChange={e => set('trainingTypeId', e.target.value)}>
                  {trainingTypes.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
                </Select>
              </Field>
            ) : (
              <StravaCriteriaBuilder
                criteria={form.stravaCriteria}
                onChange={c => set('stravaCriteria', c)}
                sportTypes={strava?.sportTypes || []}
              />
            )}
          </>)}

          {!isStravaGoal && (
          <Field label={isActivityGoal ? 'Welche Aktivität?' : 'Welche Gewohnheit?'}>
            {(isActivityGoal ? activityTypes.length > 0 : habits.length > 0) ? (
              <>
                <Select value={form.targetRef} onChange={e => handleRefChange(e.target.value)}>
                  {isActivityGoal
                    ? activityTypes.map(t => <option key={t._id} value={t._id}>{t.label}</option>)
                    : habits.map(h => <option key={h._id} value={h._id}>{h.name} ({h.unitSymbol})</option>)
                  }
                </Select>
                <button
                  type="button"
                  onClick={() => isActivityGoal ? setShowCreateType(true) : setShowCreateHabit(true)}
                  className="mt-2 flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors"
                >
                  <Plus size={12} />
                  {isActivityGoal ? 'Neuen Aktivitätstyp erstellen' : 'Neue Gewohnheit erstellen'}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => isActivityGoal ? setShowCreateType(true) : setShowCreateHabit(true)}
                className="w-full border-2 border-dashed border-ink-200 hover:border-brand-400 rounded-2xl py-6 px-4 text-ink-400 hover:text-brand-600 transition-colors flex flex-col items-center gap-1.5"
              >
                <Plus size={20} />
                <span className="text-sm font-medium">
                  {isActivityGoal
                    ? 'Noch keine Aktivitätstypen – jetzt erstellen'
                    : 'Noch keine Gewohnheiten – jetzt erstellen'}
                </span>
                <span className="text-xs">Danach geht es hier direkt weiter.</span>
              </button>
            )}
          </Field>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label !mb-0">Bedingungen</label>
              <button
                type="button"
                onClick={addCondition}
                className="text-xs font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1"
              >
                <Plus size={12} /> Hinzufügen
              </button>
            </div>
            <div className="space-y-3">
              {form.conditions.map((cond, i) => (
                <div key={i} className="panel p-3.5 space-y-3">
                  {form.conditions.length > 1 && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-ink-700">Bedingung {i + 1}</span>
                      <IconButton icon={X} label="Bedingung entfernen" tone="danger" size={14} onClick={() => removeCondition(i)} />
                    </div>
                  )}
                  <Field label="Messgröße">
                    <Select value={cond.metric} onChange={e => handleMetricChangeForCondition(i, e.target.value)}>
                      {isStravaGoal ? (<>
                        <option value="count">Anzahl Aktivitäten</option>
                        <option value="duration">Dauer (min)</option>
                        <option value="distance">Distanz (km)</option>
                      </>) : isActivityGoal ? (<>
                        <option value="count">Anzahl Aktivitäten</option>
                        {selectedActivityType?.showDuration !== false && <option value="duration">Dauer (min)</option>}
                        {selectedActivityType?.showDistance && <option value="distance">Distanz (km)</option>}
                        {(selectedActivityType?.customFields || []).filter(f => f.type === 'number').map(f => (
                          <option key={f.key} value={`custom_${f.key}`}>{f.label}{f.unit ? ` (${f.unit})` : ''}</option>
                        ))}
                        {(selectedActivityType?.customFields || []).filter(f => f.type === 'select' || f.type === 'multiselect').map(f =>
                          (f.options || []).map(opt => (
                            <option key={`${f.key}:${opt}`} value={`select_${f.key}:${opt}`}>{f.label} = {opt}</option>
                          ))
                        )}
                      </>) : (<>
                        <option value="value">Summe der Werte{selectedHabit ? ` (${selectedHabit.unitSymbol})` : ''}</option>
                        <option value="count">Anzahl Tage</option>
                      </>)}
                    </Select>
                  </Field>
                  <Field label="Bedingung">
                    <Segmented
                      value={cond.condition}
                      onChange={v => updateCondition(i, 'condition', v)}
                      options={CONDITION_OPTIONS}
                    />
                  </Field>
                  <Field label="Zielwert">
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        className="flex-1"
                        value={cond.targetValue}
                        onChange={e => updateCondition(i, 'targetValue', e.target.value)}
                        min="0"
                        step="0.1"
                        placeholder="z.B. 3"
                      />
                      <Input
                        className="!w-20 text-center"
                        value={cond.unitSymbol}
                        onChange={e => updateCondition(i, 'unitSymbol', e.target.value)}
                        placeholder="Einheit"
                      />
                    </div>
                  </Field>
                  {scopeApplies(cond.metric) && (
                    <Field label="Was wird gemessen?">
                      <ScopeSelector
                        cond={cond}
                        isActivityGoal={isActivityGoal || isStravaGoal}
                        isLongTerm={form.isLongTerm}
                        onChange={changes => updateConditionFields(i, changes)}
                      />
                    </Field>
                  )}

                  {/* Activity filters – for best-performance activity goals */}
                  {cond.aggregation === 'max' && isActivityGoal && (
                    <ActivityFilterEditor
                      filters={cond.activityFilters || []}
                      filterFields={getFilterableFields()}
                      onAdd={() => addActivityFilter(i)}
                      onUpdate={(fi, changes) => updateActivityFilter(i, fi, changes)}
                      onRemove={fi => removeActivityFilter(i, fi)}
                      onToggleValue={(fi, v) => toggleFilterValue(i, fi, v)}
                    />
                  )}
                </div>
              ))}
            </div>
            {form.conditions.length >= 2 && (
              <div className="flex items-center gap-2 mt-3">
                <span className="text-xs text-ink-400">Verknüpfung:</span>
                <Segmented
                  className="w-40"
                  value={form.conditionOperator}
                  onChange={v => set('conditionOperator', v)}
                  options={[{ value: 'AND', label: 'UND' }, { value: 'OR', label: 'ODER' }]}
                />
              </div>
            )}
          </div>
        </>)}

        {/* Step 3: milestones (long-term only) */}
        {currentStep === 3 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <div>
                <p className="display text-base">Meilensteine</p>
                <p className="text-xs text-ink-400 mt-0.5">Optional – hilft den Fortschritt einzuschätzen</p>
              </div>
              <button
                type="button"
                onClick={addStep}
                className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
              >
                <Plus size={12} /> Hinzufügen
              </button>
            </div>
            {steps.length === 0 && (
              <button
                type="button"
                onClick={addStep}
                className="w-full mt-3 border-2 border-dashed border-ink-200 hover:border-brand-400 rounded-2xl py-8 text-ink-400 hover:text-brand-600 transition-colors flex flex-col items-center gap-2"
              >
                <Plus size={22} />
                <span className="text-sm font-medium">Ersten Meilenstein hinzufügen</span>
              </button>
            )}
            <div className="space-y-2.5 mt-2">
              {steps.map((milestone, i) => {
                const firstCond = form.conditions[0];
                const cLabel = firstCond?.condition === 'max' ? 'maximal' : firstCond?.condition === 'exact' ? 'genau' : 'mindestens';
                const unit = firstCond?.unitSymbol || '';
                const mLabel = metricLabel(firstCond?.metric, selectedActivityType?.customFields);
                return (
                  <div key={i} className="panel p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-ink-700">Meilenstein {i + 1}</span>
                      <IconButton icon={X} label="Meilenstein entfernen" tone="danger" size={14} onClick={() => removeStep(i)} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Bis Datum">
                        <Input type="date" className="!text-sm !py-1.5" value={milestone.date} onChange={e => updateStep(i, 'date', e.target.value)} />
                      </Field>
                      <Field label={<>{mLabel}{unit ? <span className="normal-case"> ({unit})</span> : ''}</>}>
                        <Input
                          type="number"
                          className="!text-sm !py-1.5"
                          value={milestone.targetValue}
                          onChange={e => updateStep(i, 'targetValue', e.target.value)}
                          placeholder={`${cLabel}…`}
                          min="0"
                          step="0.1"
                        />
                      </Field>
                    </div>
                    <Field label="Beschreibung" optional>
                      <Input
                        className="!text-sm !py-1.5"
                        value={milestone.description}
                        onChange={e => updateStep(i, 'description', e.target.value)}
                        placeholder="z.B. Halbzeitmarke"
                      />
                    </Field>
                    {milestone.date && milestone.targetValue !== '' && (
                      <p className="text-xs text-brand-700 bg-brand-50 border border-brand-100 rounded-xl px-2.5 py-1.5">
                        → Bis {format(parseISO(milestone.date), 'd. MMMM yyyy', { locale: de })}: {cLabel} {milestone.targetValue}{unit ? ` ${unit}` : ''}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>

    {/* Inline creation — layered above the goal wizard, which keeps its state */}
    {showCreateType && (
      <ActivityTypeWizard
        title="Neuer Aktivitätstyp"
        submitLabel="Erstellen"
        initialForm={{ label: '', showDuration: true, showDistance: false, customFields: [] }}
        onSubmit={handleTypeCreated}
        onClose={() => setShowCreateType(false)}
      />
    )}
    {showCreateHabit && (
      <ManageHabitsModal
        zIndex="z-[60]"
        initialShowAdd
        onSave={handleHabitsManaged}
        onClose={() => setShowCreateHabit(false)}
      />
    )}
    </>
  );
}

// Edit modal for meta goals (name, threshold, child set)

function EditMetaGoalModal({ goal, allGoals, onSave, onClose }) {
  const [name, setName] = useState(goal.name);
  const [description, setDescription] = useState(goal.description || '');
  const [childIds, setChildIds] = useState((goal.childGoals || []).map(c => String(c._id)));
  const [targetValue, setTargetValue] = useState(String(goal.targetValue ?? ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Eligible: regular goals that are free or already belong to this meta goal
  const eligible = allGoals.filter(g =>
    g.type !== 'meta' && (!g.parentGoal || String(g.parentGoal._id) === String(goal._id))
  );

  const toggleChild = (id) => {
    setChildIds(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]);
  };

  const targetNum = +targetValue;
  const valid = name.trim() && childIds.length > 0 &&
    Number.isInteger(targetNum) && targetNum >= 1 && targetNum <= childIds.length;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.put(`/goals/${goal._id}`, {
        name,
        description: description || undefined,
        targetValue: targetNum,
        childGoalIds: childIds,
      });
      onSave();
    } catch (err) {
      setError(err.response?.data?.error || 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title="Gesamtziel bearbeiten"
      subtitle={goal.name}
      icon={Layers}
      size="lg"
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>Abbrechen</Button>
          <Button type="submit" form="edit-meta-form" className="flex-1" loading={saving} disabled={!valid}>
            Speichern
          </Button>
        </>
      }
    >
      <form id="edit-meta-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={e => setName(e.target.value)} required />
        </Field>
        <Field label="Beschreibung" optional>
          <Input value={description} onChange={e => setDescription(e.target.value)} />
        </Field>

        <div>
          <label className="label">Unterziele</label>
          <div className="space-y-2">
            {eligible.map(g => {
              const selected = childIds.includes(String(g._id));
              return (
                <button
                  key={g._id}
                  type="button"
                  onClick={() => toggleChild(String(g._id))}
                  className={`w-full flex items-center gap-2.5 p-3 rounded-xl border text-left transition-colors ${
                    selected ? 'border-brand-400 bg-brand-50' : 'border-paper-200 bg-paper-50 hover:border-ink-300'
                  }`}
                >
                  <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${
                    selected ? 'bg-brand-500 border-brand-500' : 'border-ink-200 bg-surface'
                  }`}>
                    {selected && <Check size={12} className="text-white" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink-800 truncate">{g.name}</span>
                    <span className="block text-xs text-ink-400">{g.targetName}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {childIds.length > 0 && (
          <Field label="Erfüllt, wenn mindestens … Unterziele erfüllt sind">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                className="!w-24"
                min="1"
                max={childIds.length}
                value={targetValue}
                onChange={e => setTargetValue(e.target.value)}
              />
              <span className="text-sm text-ink-500">von {childIds.length} Unterzielen</span>
            </div>
          </Field>
        )}

        {error && <Alert tone="error">{error}</Alert>}
      </form>
    </Modal>
  );
}

// Edit modal (periodic & long-term)

function EditGoalModal({ goal, stravaSportTypes = [], trainingTypes = [], onSave, onClose }) {
  const isActivityGoal = goal.targetRefModel === 'ActivityType' || goal.targetRefModel === 'activity';
  const isStravaGoal = goal.targetRefModel === 'StravaActivity';
  const isLongTerm = goal.type.startsWith('long-term');
  const [stravaCriteria, setStravaCriteria] = useState(goal.stravaCriteria || emptyGroup());
  const [stravaMode, setStravaMode] = useState(goal.trainingTypeId ? 'type' : 'custom');
  const [editTrainingTypeId, setEditTrainingTypeId] = useState(
    goal.trainingTypeId ? String(goal.trainingTypeId) : (trainingTypes[0]?._id || '')
  );

  const getFilterableFieldsEdit = () => {
    const fields = [];
    if (isActivityGoal) {
      fields.push({ key: 'duration', label: 'Dauer', type: 'number', unit: 'min' });
      fields.push({ key: 'distance', label: 'Distanz', type: 'number', unit: 'km' });
    }
    for (const f of goal.customFields || []) {
      fields.push({
        key: f.key, label: f.label,
        type: (f.type === 'select' || f.type === 'multiselect') ? 'select' : 'number',
        unit: f.unit, options: f.options,
      });
    }
    return fields;
  };
  const filterableFieldsEdit = getFilterableFieldsEdit();

  const [form, setForm] = useState({
    name: goal.name,
    description: goal.description || '',
    startDate: goal.startDate ? goal.startDate.slice(0, 10) : '',
    endDate: goal.endDate ? goal.endDate.slice(0, 10) : '',
    intervalValue: goal.intervalValue || 1,
    intervalUnit: goal.intervalUnit || 'week',
  });
  const [conditions, setConditions] = useState(
    (goal.conditions?.length > 0 ? goal.conditions : [{
      metric: goal.metric || 'count',
      condition: goal.condition || 'min',
      targetValue: goal.targetValue != null ? goal.targetValue : '',
      unitSymbol: goal.unitSymbol || '',
      valueScope: 'total', aggregation: 'sum', activityFilters: []
    }]).map(c => ({
      metric: c.metric || 'count',
      condition: c.condition || 'min',
      targetValue: String(c.targetValue ?? ''),
      unitSymbol: c.unitSymbol || '',
      valueScope: c.valueScope || 'total',
      aggregation: c.aggregation || 'sum',
      activityFilters: (c.activityFilters || []).map(af => ({ ...af, values: [...(af.values || [])] }))
    }))
  );
  const [steps, setSteps] = useState(
    [...(goal.intermediateSteps || [])]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map(s => ({ date: s.date ? s.date.slice(0, 10) : '', targetValue: String(s.targetValue), description: s.description || '' }))
  );
  const [saving, setSaving] = useState(false);
  const [editTab, setEditTab] = useState('basics'); // 'basics' | 'conditions' | 'milestones'

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const addStep = () => setSteps(s => [...s, { date: '', targetValue: '', description: '' }]);
  const updateStep = (i, k, v) => setSteps(s => s.map((step, idx) => idx === i ? { ...step, [k]: v } : step));
  const removeStep = (i) => setSteps(s => s.filter((_, idx) => idx !== i));

  const [condOpEdit, setCondOpEdit] = useState(goal.conditionOperator || 'AND');

  // Condition helpers
  const updateCond = (i, key, value) => setConditions(cs => cs.map((c, idx) => idx === i ? { ...c, [key]: value } : c));
  const updateCondFields = (i, changes) => setConditions(cs => cs.map((c, idx) => idx === i ? { ...c, ...changes } : c));
  const removeCondEdit = (i) => setConditions(cs => cs.filter((_, idx) => idx !== i));
  const addCondEdit = () => setConditions(cs => [...cs, {
    metric: isActivityGoal ? 'count' : 'value',
    condition: 'min', targetValue: '', unitSymbol: '', valueScope: 'total', aggregation: 'sum', activityFilters: []
  }]);
  const scopeAppliesEdit = m => m && m !== 'count' && !m.startsWith('select_');

  // Activity filter helpers
  const addFilterEdit = (ci) => {
    if (!filterableFieldsEdit.length) return;
    const first = filterableFieldsEdit[0];
    setConditions(cs => cs.map((c, i) => i !== ci ? c : {
      ...c, activityFilters: [...(c.activityFilters || []), {
        fieldKey: first.key, fieldType: first.type,
        operator: 'anyOf', values: [], numOperator: 'min', numValue: ''
      }]
    }));
  };
  const updateFilterEdit = (ci, fi, changes) =>
    setConditions(cs => cs.map((c, i) => i !== ci ? c : {
      ...c, activityFilters: (c.activityFilters || []).map((af, j) => j !== fi ? af : { ...af, ...changes })
    }));
  const removeFilterEdit = (ci, fi) =>
    setConditions(cs => cs.map((c, i) => i !== ci ? c : {
      ...c, activityFilters: (c.activityFilters || []).filter((_, j) => j !== fi)
    }));
  const toggleFilterValueEdit = (ci, fi, value) => {
    const filter = conditions[ci]?.activityFilters?.[fi];
    if (!filter) return;
    const values = filter.values.includes(value)
      ? filter.values.filter(v => v !== value)
      : [...filter.values, value];
    updateFilterEdit(ci, fi, { values });
  };

  // Derive display info from first condition for milestone preview
  const firstCond = conditions[0];
  const condLabelEdit = firstCond?.condition === 'max' ? 'maximal' : firstCond?.condition === 'exact' ? 'genau' : 'mindestens';
  const unitEdit = firstCond?.unitSymbol || goal.unitSymbol || '';
  const mLabelEdit = metricLabel(firstCond?.metric, goal.customFields);
  const aggregationNoteEdit = firstCond?.aggregation === 'max' ? ' (Bestleistung)' : '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const validSteps = steps
        .filter(s => s.date && s.targetValue !== '')
        .map(s => ({ date: s.date, targetValue: +s.targetValue, description: s.description || undefined }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));
      const validConditions = conditions.filter(c => c.targetValue !== '');
      const fc = validConditions[0];
      await api.put(`/goals/${goal._id}`, {
        name: form.name,
        description: form.description || undefined,
        ...(isLongTerm ? {
          startDate: form.startDate || undefined,
          endDate: form.endDate || undefined,
          intermediateSteps: validSteps,
        } : {
          intervalValue: form.intervalValue,
          intervalUnit: form.intervalUnit,
        }),
        conditionOperator: condOpEdit,
        conditions: validConditions.map(c => ({ ...c, targetValue: +c.targetValue })),
        condition: fc?.condition || goal.condition,
        targetValue: fc ? +fc.targetValue : goal.targetValue,
        unitSymbol: fc?.unitSymbol || goal.unitSymbol,
        metric: fc?.metric || goal.metric,
        ...(isStravaGoal ? (stravaMode === 'type' && editTrainingTypeId
          ? { trainingTypeId: editTrainingTypeId, stravaCriteria: null }
          : { trainingTypeId: null, stravaCriteria: normalizeCriteria(stravaCriteria) }) : {}),
      });
      onSave();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: 'basics', label: 'Grundlagen' },
    { id: 'conditions', label: 'Bedingungen' },
    ...(isLongTerm ? [{ id: 'milestones', label: 'Meilensteine' }] : []),
  ];

  return (
    <Modal
      onClose={onClose}
      title="Ziel bearbeiten"
      subtitle={goal.name}
      icon={Pencil}
      size="lg"
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>Abbrechen</Button>
          <Button type="submit" form="edit-goal-form" className="flex-1" loading={saving} disabled={!form.name}>
            Speichern
          </Button>
        </>
      }
    >
      <form id="edit-goal-form" onSubmit={handleSubmit}>
        {/* Tabs */}
        <Segmented
          className="mb-5"
          value={editTab}
          onChange={setEditTab}
          options={tabs.map(t => ({ value: t.id, label: t.label }))}
        />

        <div className="space-y-4">
          {/* Basics */}
          {editTab === 'basics' && (<>
            <Field label="Name">
              <Input value={form.name} onChange={e => set('name', e.target.value)} required />
            </Field>
            <Field label="Beschreibung" optional>
              <Input value={form.description} onChange={e => set('description', e.target.value)} />
            </Field>

            {/* Interval only for periodic goals */}
            {!isLongTerm && (
              <div className="panel p-4">
                <label className="label">Intervall</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    className="!w-20"
                    min="1"
                    max="365"
                    value={form.intervalValue}
                    onChange={e => set('intervalValue', Math.max(1, parseInt(e.target.value) || 1))}
                  />
                  <Select className="flex-1" value={form.intervalUnit} onChange={e => set('intervalUnit', e.target.value)}>
                    <option value="day">Tag(e)</option>
                    <option value="week">Woche(n)</option>
                    <option value="month">Monat(e)</option>
                  </Select>
                </div>
                <p className="text-xs text-ink-400 mt-2">
                  Fortschritt wird {intervalTargetLabel(form.intervalValue, form.intervalUnit)} gemessen
                </p>
              </div>
            )}

            {/* Time range only for long-term goals */}
            {isLongTerm && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Startdatum">
                  <Input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} />
                </Field>
                <Field label="Enddatum">
                  <Input type="date" value={form.endDate} onChange={e => set('endDate', e.target.value)} />
                </Field>
              </div>
            )}
          </>)}

          {/* Conditions */}
          {editTab === 'conditions' && (
            <div className="space-y-3">
              {isStravaGoal && (<>
                {trainingTypes.length > 0 && (
                  <Field label="Was zählt als Training?">
                    <Segmented
                      value={stravaMode}
                      onChange={mode => {
                        setStravaMode(mode);
                        if (mode === 'type' && !editTrainingTypeId) setEditTrainingTypeId(trainingTypes[0]._id);
                      }}
                      options={[
                        { value: 'custom', label: 'Eigene Kriterien' },
                        { value: 'type', label: 'Trainingstyp' },
                      ]}
                    />
                  </Field>
                )}
                {stravaMode === 'type' && trainingTypes.length > 0 ? (
                  <Field
                    label="Trainingstyp"
                    hint={criteriaSummary(trainingTypes.find(t => t._id === editTrainingTypeId)?.criteria?.strava)}
                  >
                    <Select value={editTrainingTypeId} onChange={e => setEditTrainingTypeId(e.target.value)}>
                      {trainingTypes.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
                    </Select>
                  </Field>
                ) : (
                  <StravaCriteriaBuilder
                    criteria={stravaCriteria}
                    onChange={setStravaCriteria}
                    sportTypes={stravaSportTypes}
                  />
                )}
              </>)}
              <div className="flex items-center justify-between">
                <p className="text-xs text-ink-400">Was muss erfüllt sein, damit das Ziel gilt?</p>
                <button
                  type="button"
                  onClick={addCondEdit}
                  className="text-xs font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1"
                >
                  <Plus size={12} /> Hinzufügen
                </button>
              </div>
              {conditions.map((cond, i) => (
                <div key={i} className="panel p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-ink-700">
                      {conditions.length > 1 ? `Bedingung ${i + 1}` : 'Bedingung'}
                    </span>
                    {conditions.length > 1 && (
                      <IconButton icon={X} label="Bedingung entfernen" tone="danger" size={14} onClick={() => removeCondEdit(i)} />
                    )}
                  </div>

                  <Field label="Messgröße">
                    <Select
                      value={cond.metric}
                      onChange={e => {
                        const m = e.target.value;
                        updateCondFields(i, {
                          metric: m,
                          valueScope: scopeAppliesEdit(m) ? cond.valueScope : 'total',
                          aggregation: scopeAppliesEdit(m) ? cond.aggregation : 'sum',
                          activityFilters: scopeAppliesEdit(m) ? (cond.activityFilters || []) : [],
                        });
                      }}
                    >
                      {isStravaGoal ? (<>
                        <option value="count">Anzahl Aktivitäten</option>
                        <option value="duration">Dauer (min)</option>
                        <option value="distance">Distanz (km)</option>
                      </>) : isActivityGoal ? (<>
                        <option value="count">Anzahl Aktivitäten</option>
                        <option value="duration">Dauer (min)</option>
                        <option value="distance">Distanz (km)</option>
                        {(goal.customFields || []).filter(f => f.type === 'number').map(f => (
                          <option key={f.key} value={`custom_${f.key}`}>{f.label}{f.unit ? ` (${f.unit})` : ''}</option>
                        ))}
                        {(goal.customFields || []).filter(f => f.type === 'select' || f.type === 'multiselect').map(f =>
                          (f.options || []).map(opt => (
                            <option key={`${f.key}:${opt}`} value={`select_${f.key}:${opt}`}>{f.label} = {opt}</option>
                          ))
                        )}
                      </>) : (<>
                        <option value="value">Summe der Werte</option>
                        <option value="count">Anzahl Tage</option>
                      </>)}
                    </Select>
                  </Field>

                  <Field label="Bedingung">
                    <Segmented
                      value={cond.condition}
                      onChange={v => updateCond(i, 'condition', v)}
                      options={CONDITION_OPTIONS}
                    />
                  </Field>

                  <Field label="Zielwert">
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        className="flex-1"
                        value={cond.targetValue}
                        onChange={e => updateCond(i, 'targetValue', e.target.value)}
                        min="0"
                        step="0.1"
                        placeholder="z.B. 3"
                      />
                      <Input
                        className="!w-20 text-center"
                        value={cond.unitSymbol}
                        onChange={e => updateCond(i, 'unitSymbol', e.target.value)}
                        placeholder="Einheit"
                      />
                    </div>
                  </Field>

                  {scopeAppliesEdit(cond.metric) && (
                    <Field label="Was wird gemessen?">
                      <ScopeSelector
                        cond={cond}
                        isActivityGoal={isActivityGoal || isStravaGoal}
                        isLongTerm={isLongTerm}
                        onChange={changes => updateCondFields(i, changes)}
                      />
                    </Field>
                  )}

                  {/* Activity filters for best-performance */}
                  {cond.aggregation === 'max' && isActivityGoal && (
                    <ActivityFilterEditor
                      filters={cond.activityFilters || []}
                      filterFields={filterableFieldsEdit}
                      onAdd={() => addFilterEdit(i)}
                      onUpdate={(fi, changes) => updateFilterEdit(i, fi, changes)}
                      onRemove={fi => removeFilterEdit(i, fi)}
                      onToggleValue={(fi, v) => toggleFilterValueEdit(i, fi, v)}
                    />
                  )}
                </div>
              ))}
              {conditions.length >= 2 && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs text-ink-400">Verknüpfung:</span>
                  <Segmented
                    className="w-40"
                    value={condOpEdit}
                    onChange={setCondOpEdit}
                    options={[{ value: 'AND', label: 'UND' }, { value: 'OR', label: 'ODER' }]}
                  />
                </div>
              )}
            </div>
          )}

          {/* Milestones */}
          {editTab === 'milestones' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-ink-400">Etappenziele auf dem Weg zum Gesamtziel</p>
                <button
                  type="button"
                  onClick={addStep}
                  className="text-xs font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1"
                >
                  <Plus size={12} /> Hinzufügen
                </button>
              </div>
              {steps.length === 0 && (
                <button
                  type="button"
                  onClick={addStep}
                  className="w-full mt-2 border-2 border-dashed border-ink-200 hover:border-brand-400 rounded-2xl py-6 text-ink-400 hover:text-brand-600 transition-colors flex flex-col items-center gap-2"
                >
                  <Plus size={20} />
                  <span className="text-sm font-medium">Ersten Meilenstein hinzufügen</span>
                </button>
              )}
              <div className="space-y-2.5">
                {steps.map((step, i) => (
                  <div key={i} className="panel p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-ink-700">Meilenstein {i + 1}</span>
                      <IconButton icon={X} label="Meilenstein entfernen" tone="danger" size={14} onClick={() => removeStep(i)} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Bis Datum">
                        <Input type="date" className="!text-sm !py-1.5" value={step.date} onChange={e => updateStep(i, 'date', e.target.value)} />
                      </Field>
                      <Field label={<>{mLabelEdit}{unitEdit ? <span className="normal-case"> ({unitEdit})</span> : ''}</>}>
                        <Input
                          type="number"
                          className="!text-sm !py-1.5"
                          value={step.targetValue}
                          onChange={e => updateStep(i, 'targetValue', e.target.value)}
                          placeholder={`${condLabelEdit}…`}
                          min="0"
                          step="0.1"
                        />
                      </Field>
                    </div>
                    <Field label="Beschreibung" optional>
                      <Input
                        className="!text-sm !py-1.5"
                        value={step.description}
                        onChange={e => updateStep(i, 'description', e.target.value)}
                        placeholder="z.B. Halbzeitmarke"
                      />
                    </Field>
                    {step.date && step.targetValue !== '' && (
                      <p className="text-xs text-brand-700 bg-brand-50 border border-brand-100 rounded-xl px-2.5 py-1.5">
                        → Bis {format(parseISO(step.date), 'd. MMMM yyyy', { locale: de })}: {condLabelEdit} {step.targetValue}{unitEdit ? ` ${unitEdit}` : ''}{aggregationNoteEdit}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}

// Main page

export default function Goals() {
  const [goals, setGoals] = useState([]);
  const [activityTypes, setActivityTypes] = useState([]);
  const [habits, setHabits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editGoal, setEditGoal] = useState(null);
  const [strava, setStrava] = useState({ configured: false, connected: false, sportTypes: [] });
  const [trainingTypes, setTrainingTypes] = useState([]);

  // Strava availability decides whether the goal wizard offers the Strava
  // category — loaded separately so a failure never blocks the goals page.
  useEffect(() => {
    api.get('/strava/status')
      .then(async res => {
        let sportTypes = [];
        if (res.data.connected) {
          try { sportTypes = (await api.get('/strava/sport-types')).data; } catch { /* optional */ }
        }
        setStrava({ configured: res.data.configured, connected: res.data.connected, sportTypes });
      })
      .catch(() => {});
    api.get('/training-types').then(res => setTrainingTypes(res.data)).catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [goalsRes, typesRes, habitsRes] = await Promise.all([
        api.get('/goals'),
        api.get('/activity-types'),
        api.get('/habits/definitions'),
      ]);
      setGoals(goalsRes.data);
      setActivityTypes(typesRes.data);
      setHabits(habitsRes.data.filter(h => h.selected));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Refresh only the selectable targets (types + habits) so an open goal
  // wizard keeps its state while its option lists update.
  const reloadTargets = useCallback(async () => {
    const [typesRes, habitsRes] = await Promise.all([
      api.get('/activity-types'),
      api.get('/habits/definitions'),
    ]);
    setActivityTypes(typesRes.data);
    setHabits(habitsRes.data.filter(h => h.selected));
  }, []);

  const handleDelete = async (id) => {
    if (!confirm('Ziel löschen?')) return;
    await api.delete(`/goals/${id}`);
    load();
  };

  const metaGoals = goals.filter(g => g.type === 'meta');
  const periodic = goals.filter(g => g.type !== 'meta' && !g.type.startsWith('long-term'));
  const longTerm = goals.filter(g => g.type.startsWith('long-term'));

  const GROUP_STYLES = {
    olive: { text: 'text-lime-700', dot: 'bg-lime-600' },
    amber: { text: 'text-ocher-600', dot: 'bg-ocher-400' },
    brand: { text: 'text-brand-600', dot: 'bg-brand-500' },
  };

  const renderGoalGroup = (title, groupGoals, tone) => (
    <div>
      <h2 className={`flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] font-semibold mb-3 ${GROUP_STYLES[tone].text}`}>
        <span className={`w-2 h-2 rounded-full ${GROUP_STYLES[tone].dot}`} />
        {title}
      </h2>
      <div className="space-y-3 anim-list">
        {groupGoals.map(g => (
          <GoalProgress
            key={g._id}
            goal={g}
            actions={
              <>
                <IconButton icon={Pencil} label="Bearbeiten" tone="brand" size={15} onClick={() => setEditGoal(g)} />
                <IconButton icon={Trash2} label="Löschen" tone="danger" size={15} onClick={() => handleDelete(g._id)} />
              </>
            }
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ziele"
        subtitle={`${goals.length} aktive Ziele`}
        icon={Target}
        tone="amber"
        action={
          <div className="flex items-center gap-1.5">
            <Link to="/share">
              <Button variant="secondary" icon={Share2}>
                <span className="hidden sm:inline">Share-Ansicht</span>
              </Button>
            </Link>
            <Button icon={Plus} onClick={() => setShowCreate(true)}>
              <span className="hidden sm:inline">Neues Ziel</span>
            </Button>
          </div>
        }
      />

      {loading ? (
        <PageLoader />
      ) : goals.length === 0 ? (
        <EmptyState
          icon={Target}
          tone="amber"
          title="Noch keine Ziele definiert"
          text="Setze dir Ziele für Aktivitäten und Gewohnheiten – periodisch oder langfristig mit Meilensteinen."
          action={
            <Button icon={Plus} onClick={() => setShowCreate(true)}>
              Ziel erstellen
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          {metaGoals.length > 0 && renderGoalGroup('Gesamtziele', metaGoals, 'brand')}
          {periodic.length > 0 && renderGoalGroup('Periodische Ziele', periodic, 'olive')}
          {longTerm.length > 0 && renderGoalGroup('Langfristige Ziele', longTerm, 'amber')}
        </div>
      )}

      {showCreate && (
        <CreateGoalModal
          activityTypes={activityTypes}
          habits={habits}
          strava={strava}
          existingGoals={goals}
          trainingTypes={trainingTypes}
          onSave={() => { setShowCreate(false); load(); }}
          onClose={() => setShowCreate(false)}
          onTargetsChanged={reloadTargets}
        />
      )}

      {editGoal && editGoal.type === 'meta' && (
        <EditMetaGoalModal
          goal={editGoal}
          allGoals={goals}
          onSave={() => { setEditGoal(null); load(); }}
          onClose={() => setEditGoal(null)}
        />
      )}
      {editGoal && editGoal.type !== 'meta' && (
        <EditGoalModal
          goal={editGoal}
          stravaSportTypes={strava.sportTypes}
          trainingTypes={trainingTypes}
          onSave={() => { setEditGoal(null); load(); }}
          onClose={() => setEditGoal(null)}
        />
      )}
    </div>
  );
}
