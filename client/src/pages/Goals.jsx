import { useState, useEffect } from 'react';
import api from '../utils/api';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { Plus, Target, Trash2, X, Dumbbell, Sparkles, AlertTriangle, Check, Clock, Pencil } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine
} from 'recharts';

// ── Interval helpers ────────────────────────────────────────────────

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

// ── Single goal progress display ────────────────────────────

function GoalProgress({ goal }) {
  const [progress, setProgress] = useState(null);
  const [showChart, setShowChart] = useState(false);

  useEffect(() => {
    api.get(`/goals/${goal._id}/progress`).then(r => setProgress(r.data)).catch(() => {});
  }, [goal._id]);

  const { conditions: condResults, conditionOperator: condOp, met: goalMet, weeklyData, stepResults = [] } = progress || {};
  const isLongTerm = goal.type.startsWith('long-term');
  const isHabit = goal.targetRefModel === 'HabitDefinition' || goal.targetRefModel === 'habit';
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
    let pct = 0, barColor = 'bg-slate-700', statusText = '';
    if (currentValue !== undefined) {
      if (condition === 'min') {
        pct = Math.min(100, (currentValue / targetValue) * 100);
        barColor = pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500';
        statusText = pct >= 100 ? 'Erreicht' : `${currentValue} / ${targetValue}`;
      } else if (condition === 'max') {
        pct = currentValue <= targetValue ? 100 : Math.max(0, 100 - ((currentValue - targetValue) / targetValue) * 100);
        barColor = currentValue <= targetValue ? 'bg-emerald-500' : 'bg-red-500';
        statusText = currentValue <= targetValue ? 'Im Zielbereich' : `${currentValue} (max. ${targetValue})`;
      } else {
        pct = currentValue === targetValue ? 100 : (currentValue / targetValue) * 100;
        barColor = currentValue === targetValue ? 'bg-emerald-500' : 'bg-amber-500';
        statusText = `${currentValue} / ${targetValue}`;
      }
    }

    const condLabel = condition === 'min' ? 'mindestens' : condition === 'max' ? 'maximal' : 'genau';
    const scopeSuffix = cond.aggregation === 'max'
      ? ' · Bestleistung'
      : cond.valueScope === 'perActivity' ? ' · Ø pro Aktivität' : '';

    return (
      <div key={idx} className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">
            {metricLabel(cond.metric, customFields)} ({condLabel} {targetValue}{unitSymbol ? ` ${unitSymbol}` : ''}{scopeSuffix}):
            {' '}<span className="text-slate-200 font-medium">{currentValue} {unitSymbol}</span>
          </span>
          <span className={`font-medium ${condMet ? 'text-emerald-400' : pct >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
            {statusText}
          </span>
        </div>
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  };


  return (
    <div className="card p-5">
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-white">{goal.name}</h3>
            <span className={`badge text-xs ${isLongTerm ? 'bg-amber-950/60 text-amber-500' : 'bg-brand-600/20 text-brand-300'}`}>
              {isLongTerm ? 'Langfristig' : intervalBadgeLabel(iv, iu)}
            </span>
            <span className={`badge text-xs ${isHabit ? 'bg-green-600/20 text-green-300' : 'bg-white/[.08] text-white/45'}`}>
              {isHabit ? <><Sparkles size={10} className="inline mr-1" />Gewohnheit</> : <><Dumbbell size={10} className="inline mr-1" />Aktivität</>}
            </span>
          </div>
          {goal.description && <p className="text-xs text-slate-500 mt-0.5">{goal.description}</p>}
          {goal.metricWarnings?.length > 0 && (
            <div className="mt-1.5 flex flex-col gap-0.5">
              {goal.metricWarnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-400 flex items-center gap-1">
                  <AlertTriangle size={11} className="flex-shrink-0" />
                  {w}
                </p>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-500 mt-1">
            {goal.targetName && <span className="text-slate-400 font-medium">{goal.targetName}</span>}
            {!isLongTerm && <> {intervalTargetLabel(iv, iu)}</>}
          </p>
          {goal.endDate && (
            <p className="text-xs text-slate-600 mt-0.5">Bis {format(parseISO(goal.endDate), 'd. MMMM yyyy', { locale: de })}</p>
          )}
        </div>
      </div>

      {progress && condResults && condResults.length > 0 && (
        <div className="space-y-3 mb-3">
          <div className="text-xs text-slate-500">
            {isLongTerm ? 'Gesamt' : intervalPeriodLabel(iv, iu)}
          </div>
          {condResults.map((cond, idx) => (
            <div key={idx}>
              {idx > 0 && (
                <div className="flex items-center gap-2 my-1">
                  <div className="flex-1 h-px bg-slate-700" />
                  <span className="text-xs font-semibold text-slate-500 px-1">
                    {condOp === 'OR' ? 'ODER' : 'UND'}
                  </span>
                  <div className="flex-1 h-px bg-slate-700" />
                </div>
              )}
              {renderConditionBar(cond, idx)}
            </div>
          ))}
          {condResults.length > 1 && (
            <div className={`text-xs font-medium mt-1 ${goalMet ? 'text-emerald-400' : 'text-red-400'}`}>
              Gesamtziel: {goalMet ? 'Erfüllt' : 'Nicht erfüllt'}
            </div>
          )}
        </div>
      )}

      {isLongTerm && stepResults.length > 0 && (
        <div className="mb-3 space-y-2">
          <div className="text-xs text-slate-500">Zwischenziele</div>

          {/* Fortschrittsbar zum nächsten Zwischenziel */}
          {nextStep && condResults?.length > 0 && (() => {
            const firstResult = condResults[0];
            const current = firstResult?.currentValue ?? 0;
            const isMaxAgg = firstResult?.aggregation === 'max';
            const pct = Math.min(100, (current / nextStep.targetValue) * 100);
            const barColor = pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500';
            return (
              <div className="bg-amber-500/10 border border-amber-400/20 rounded-xl px-3 py-2">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-amber-400 font-medium">
                    Nächstes Zwischenziel: {nextStep.targetValue} {goal.unitSymbol}
                    {isMaxAgg && <span className="text-amber-600 font-normal"> (Bestleistung)</span>}
                  </span>
                  <span className="text-slate-500">
                    bis {format(parseISO(nextStep.date), 'd. MMM yyyy', { locale: de })}
                  </span>
                </div>
                {nextStep.description && <div className="text-xs text-slate-500 mb-1">{nextStep.description}</div>}
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>{isMaxAgg ? 'Beste Einzelleistung' : 'Aktuell'}: {current} / {nextStep.targetValue} {goal.unitSymbol}</span>
                  <span>{Math.round(pct)}%</span>
                </div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })()}

          {/* Timeline aller Zwischenziele */}
          <div className="space-y-1">
            {stepResults.map((step, idx) => {
              const isPast = step.isPast;
              const met = step.met;
              const iconClass = !isPast
                ? 'border border-slate-600 text-slate-500'
                : met
                  ? 'bg-emerald-900/30 border border-emerald-600 text-emerald-400'
                  : 'bg-red-900/30 border border-red-600 text-red-400';
              return (
                <div key={idx} className="flex items-start gap-2 text-xs">
                  <div className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${iconClass}`}>
                    {!isPast ? <Clock size={8} /> : met ? <Check size={8} /> : <X size={8} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={isPast ? (met ? 'text-emerald-300' : 'text-red-300') : 'text-slate-300'}>
                      {step.targetValue} {goal.unitSymbol}
                    </span>
                    <span className="text-slate-500"> bis {format(parseISO(step.date), 'd. MMM yyyy', { locale: de })}</span>
                    {isPast && step.actualValue !== null && (
                      <span className="text-slate-600"> · Erreicht: {step.actualValue} {goal.unitSymbol}</span>
                    )}
                    {step.description && <div className="text-slate-600 mt-0.5">{step.description}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isLongTerm && chartData.length > 0 && (
        <>
          <button onClick={() => setShowChart(v => !v)} className="text-xs text-brand-400 hover:text-brand-300 transition-colors mb-2">
            {showChart ? 'Verlauf ausblenden' : 'Verlauf anzeigen'}
          </button>
          {showChart && (
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.30)', fontSize: 10 }} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.30)', fontSize: 10 }} tickLine={false} axisLine={false} width={30} />
                <Tooltip contentStyle={{ background: 'rgba(30,28,50,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, color: '#fff', backdropFilter: 'blur(8px)' }} />
                <Line type="monotone" dataKey="Wert" stroke="#c4623a" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Ziel" stroke="rgba(255,255,255,0.15)" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                {stepResults.map((step, idx) => (
                  <ReferenceLine
                    key={idx}
                    y={step.targetValue}
                    stroke={!step.isPast ? '#f59e0b' : step.met ? '#10b981' : '#ef4444'}
                    strokeDasharray="3 2"
                    strokeWidth={1}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </>
      )}
    </div>
  );
}

// ── Goal creation form ───────────────────────────────────

function CreateGoalModal({ activityTypes, habits, onSave, onClose }) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    isLongTerm: false,
    targetCategory: 'activity',
    intervalValue: 1,
    intervalUnit: 'week',
    targetRef: activityTypes[0]?._id || '',
    targetRefModel: 'ActivityType',
    conditionOperator: 'AND',
    conditions: [{ metric: 'count', condition: 'min', targetValue: '', unitSymbol: 'Mal', valueScope: 'total', aggregation: 'sum', activityFilters: [] }],
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
  });
  const [steps, setSteps] = useState([]);
  const [saving, setSaving] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const isActivityGoal = form.targetCategory === 'activity';
  const selectedActivityType = activityTypes.find(t => t._id === form.targetRef);
  const selectedHabit = habits.find(h => h._id === form.targetRef);

  const unitForMetric = (metric, actType, habit) => {
    if (metric === 'count') return isActivityGoal ? 'Mal' : 'Tage';
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
  const stepTitles = ['Grundlagen', 'Was & Bedingungen', 'Meilensteine'];

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center z-50">
      <div className="bg-[#1e1e30]/95 backdrop-blur-2xl border border-white/[.1] w-full max-w-lg rounded-t-2xl sm:rounded-2xl flex flex-col" style={{ maxHeight: '92dvh' }}>

        {/* Drag handle – mobile only */}
        <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mt-3 sm:hidden flex-shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-800 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-white">Neues Ziel</h2>
            <p className="text-xs text-slate-500 mt-0.5">{stepTitles[currentStep - 1]}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <div key={i} className={`rounded-full transition-all duration-200 ${i + 1 === currentStep ? 'w-5 h-1.5 bg-brand-500' : i + 1 < currentStep ? 'w-1.5 h-1.5 bg-brand-600' : 'w-1.5 h-1.5 bg-slate-700'}`} />
              ))}
            </div>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200 p-1 -mr-1">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">

          {/* ── Step 1: Grundlagen ── */}
          {currentStep === 1 && (<>
            <div>
              <label className="label">Name</label>
              <input className="input text-base" value={form.name} onChange={e => set('name', e.target.value)} placeholder="z.B. Öfter laufen gehen" autoFocus />
            </div>

            <div>
              <label className="label">Zielart</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => set('isLongTerm', false)}
                  className={`p-3 rounded-lg border text-left transition-colors ${!form.isLongTerm ? 'border-brand-500 bg-brand-950/60 text-white' : 'border-white/[.12] bg-white/[.07] text-white/45'}`}
                >
                  <div className="font-semibold text-sm">Periodisch</div>
                  <div className="text-xs opacity-60 mt-0.5">Täglich, wöchentlich…</div>
                </button>
                <button type="button" onClick={() => set('isLongTerm', true)}
                  className={`p-3 rounded-lg border text-left transition-colors ${form.isLongTerm ? 'border-amber-500 bg-amber-950/60 text-white' : 'border-white/[.12] bg-white/[.07] text-white/45'}`}
                >
                  <div className="font-semibold text-sm">Langfristig</div>
                  <div className="text-xs opacity-60 mt-0.5">Enddatum & Meilensteine</div>
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                {!form.isLongTerm
                  ? 'Läuft dauerhaft. Fortschritt wird pro Intervall gemessen.'
                  : 'Hat ein Enddatum. Ideal für Projekte & persönliche Rekorde.'}
              </p>
            </div>

            {!form.isLongTerm && (
              <div className="bg-white/[.05] border border-white/[.09] rounded-2xl p-4">
                <label className="label text-xs mb-2">Intervall</label>
                <div className="flex gap-2">
                  <input type="number" className="input w-20" min="1" max="365" value={form.intervalValue} onChange={e => set('intervalValue', Math.max(1, parseInt(e.target.value) || 1))} />
                  <select className="input flex-1" value={form.intervalUnit} onChange={e => set('intervalUnit', e.target.value)}>
                    <option value="day">Tag(e)</option>
                    <option value="week">Woche(n)</option>
                    <option value="month">Monat(e)</option>
                  </select>
                </div>
                <p className="text-xs text-slate-500 mt-2">Fortschritt wird {targetLabel} gemessen</p>
              </div>
            )}

            {form.isLongTerm && (
              <div className="bg-white/[.05] border border-white/[.09] rounded-2xl p-4">
                <label className="label text-xs mb-2">Zeitraum</label>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label text-xs mb-1">Start</label>
                    <input type="date" className="input" value={form.startDate} onChange={e => set('startDate', e.target.value)} />
                  </div>
                  <div>
                    <label className="label text-xs mb-1">Ende</label>
                    <input type="date" className="input" value={form.endDate} onChange={e => set('endDate', e.target.value)} />
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="label">Beschreibung <span className="text-slate-600 font-normal">(optional)</span></label>
              <input className="input" value={form.description} onChange={e => set('description', e.target.value)} placeholder="Kurze Notiz" />
            </div>
          </>)}

          {/* ── Step 2: Was & Bedingungen ── */}
          {currentStep === 2 && (<>
            <div>
              <label className="label">Kategorie</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => handleCategoryChange('activity')}
                  className={`p-3 rounded-lg border text-left transition-colors ${form.targetCategory === 'activity' ? 'border-brand-500 bg-brand-950/60 text-white' : 'border-white/[.12] bg-white/[.07] text-white/45'}`}
                >
                  <div className="flex items-center gap-1.5 font-semibold text-sm"><Dumbbell size={13} /> Aktivität</div>
                  <div className="text-xs opacity-60 mt-0.5">Sport, Training…</div>
                </button>
                <button type="button" onClick={() => handleCategoryChange('habit')}
                  className={`p-3 rounded-lg border text-left transition-colors ${form.targetCategory === 'habit' ? 'border-emerald-500 bg-emerald-950/60 text-white' : 'border-white/[.12] bg-white/[.07] text-white/45'}`}
                >
                  <div className="flex items-center gap-1.5 font-semibold text-sm"><Sparkles size={13} /> Gewohnheit</div>
                  <div className="text-xs opacity-60 mt-0.5">Tägliche Routinen…</div>
                </button>
              </div>
            </div>

            <div>
              <label className="label">{isActivityGoal ? 'Welche Aktivität?' : 'Welche Gewohnheit?'}</label>
              <select className="input" value={form.targetRef} onChange={e => handleRefChange(e.target.value)}>
                {isActivityGoal
                  ? activityTypes.map(t => <option key={t._id} value={t._id}>{t.label}</option>)
                  : habits.map(h => <option key={h._id} value={h._id}>{h.name} ({h.unitSymbol})</option>)
                }
              </select>
              {isActivityGoal && activityTypes.length === 0 && <p className="text-xs text-amber-400 mt-1">Keine Aktivitätstypen gefunden.</p>}
              {!isActivityGoal && habits.length === 0 && <p className="text-xs text-amber-400 mt-1">Keine Gewohnheiten gefunden.</p>}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label mb-0">Bedingungen</label>
                <button type="button" onClick={addCondition} className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1"><Plus size={12} /> Hinzufügen</button>
              </div>
              <div className="space-y-3">
                {form.conditions.map((cond, i) => (
                  <div key={i} className="bg-white/[.05] border border-white/[.09] rounded-2xl p-3 space-y-3">
                    {form.conditions.length > 1 && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-300">Bedingung {i + 1}</span>
                        <button type="button" onClick={() => removeCondition(i)} className="text-slate-600 hover:text-red-400"><X size={14} /></button>
                      </div>
                    )}
                    <div>
                      <label className="label text-xs mb-1">Messgröße</label>
                      <select className="input" value={cond.metric} onChange={e => handleMetricChangeForCondition(i, e.target.value)}>
                        {isActivityGoal ? (<>
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
                      </select>
                    </div>
                    <div>
                      <label className="label text-xs mb-1">Bedingung</label>
                      <div className="flex gap-1.5">
                        {[{ v: 'min', l: 'Mindestens' }, { v: 'max', l: 'Maximal' }, { v: 'exact', l: 'Genau' }].map(({ v, l }) => (
                          <button key={v} type="button" onClick={() => updateCondition(i, 'condition', v)}
                            className={`flex-1 py-2 rounded-md text-xs font-semibold transition-colors ${cond.condition === v ? 'bg-brand-600 text-white' : 'bg-white/[.08] text-white/45'}`}
                          >{l}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="label text-xs mb-1">Zielwert</label>
                      <div className="flex gap-2">
                        <input type="number" className="input flex-1" value={cond.targetValue} onChange={e => updateCondition(i, 'targetValue', e.target.value)} min="0" step="0.1" placeholder="z.B. 3" />
                        <input className="input w-20 text-center" value={cond.unitSymbol} onChange={e => updateCondition(i, 'unitSymbol', e.target.value)} placeholder="Einheit" />
                      </div>
                    </div>
                    {scopeApplies(cond.metric) && (
                      <div>
                        <label className="label text-xs mb-1">Was wird gemessen?</label>
                        {isActivityGoal ? (<>
                          <div className="flex gap-1.5">
                            <button type="button" onClick={() => updateConditionFields(i, { valueScope: 'total', aggregation: 'sum' })}
                              className={`flex-1 py-2 rounded-md text-xs font-semibold transition-colors ${cond.aggregation !== 'max' && cond.valueScope !== 'perActivity' ? 'bg-brand-600 text-white' : 'bg-white/[.08] text-white/45'}`}
                            >{form.isLongTerm ? 'Gesamt' : 'pro Intervall'}</button>
                            <button type="button" onClick={() => updateConditionFields(i, { valueScope: 'perActivity', aggregation: 'sum' })}
                              className={`flex-1 py-2 rounded-md text-xs font-semibold transition-colors ${cond.aggregation !== 'max' && cond.valueScope === 'perActivity' ? 'bg-brand-600 text-white' : 'bg-white/[.08] text-white/45'}`}
                            >Ø / Aktivität</button>
                            <button type="button" onClick={() => updateConditionFields(i, { valueScope: 'total', aggregation: 'max' })}
                              className={`flex-1 py-2 rounded-md text-xs font-semibold transition-colors ${cond.aggregation === 'max' ? 'bg-amber-600 text-white' : 'bg-white/[.08] text-white/45'}`}
                            >Bestleistung</button>
                          </div>
                          <p className="text-xs text-slate-600 mt-1.5">
                            {cond.aggregation === 'max' ? 'Höchster Wert in einer einzelnen Aktivität.'
                              : cond.valueScope === 'perActivity' ? 'Durchschnitt aller Aktivitäten.'
                              : form.isLongTerm ? 'Alle Aktivitäten werden summiert.' : 'Summe im Intervall.'}
                          </p>
                        </>) : (
                          <div className="flex gap-1.5">
                            <button type="button" onClick={() => updateConditionFields(i, { valueScope: 'total', aggregation: 'sum' })}
                              className={`flex-1 py-2 rounded-md text-xs font-semibold transition-colors ${cond.valueScope !== 'perActivity' ? 'bg-brand-600 text-white' : 'bg-white/[.08] text-white/45'}`}
                            >Gesamt</button>
                            <button type="button" onClick={() => updateConditionFields(i, { valueScope: 'perActivity', aggregation: 'sum' })}
                              className={`flex-1 py-2 rounded-md text-xs font-semibold transition-colors ${cond.valueScope === 'perActivity' ? 'bg-brand-600 text-white' : 'bg-white/[.08] text-white/45'}`}
                            >Ø pro Tag</button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Aktivitätsfilter – bei Bestleistung + Aktivitätsziel */}
                    {cond.aggregation === 'max' && isActivityGoal && (() => {
                      const filterFields = getFilterableFields();
                      if (!filterFields.length) return null;
                      const filters = cond.activityFilters || [];
                      return (
                        <div className="border border-white/[.1] rounded-2xl p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-xs font-semibold text-slate-200">In derselben Aktivität</span>
                              <p className="text-xs text-slate-500 mt-0.5">Felder, die in der Bestleistungs-Aktivität erfüllt sein müssen</p>
                            </div>
                            <button type="button" onClick={() => addActivityFilter(i)} className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1 flex-shrink-0">
                              <Plus size={11} /> Filter
                            </button>
                          </div>
                          {filters.length === 0 && (
                            <p className="text-xs text-slate-600">Kein Filter – gilt für alle Aktivitäten.</p>
                          )}
                          {filters.map((filter, fi) => {
                            const field = filterFields.find(f => f.key === filter.fieldKey) || filterFields[0];
                            const isNum = (filter.fieldType || 'select') === 'number';
                            return (
                              <div key={fi} className="bg-white/[.06] rounded-xl p-2.5 space-y-2">
                                <div className="flex items-center gap-2">
                                  <select className="input text-xs py-1.5 flex-1" value={filter.fieldKey}
                                    onChange={e => {
                                      const nf = filterFields.find(f => f.key === e.target.value) || filterFields[0];
                                      updateActivityFilter(i, fi, { fieldKey: nf.key, fieldType: nf.type, values: [], numValue: '', numOperator: 'min' });
                                    }}
                                  >
                                    {filterFields.map(f => <option key={f.key} value={f.key}>{f.label}{f.unit ? ` (${f.unit})` : ''}</option>)}
                                  </select>
                                  <button type="button" onClick={() => removeActivityFilter(i, fi)} className="text-slate-600 hover:text-red-400 flex-shrink-0">
                                    <X size={13} />
                                  </button>
                                </div>
                                {isNum ? (
                                  <div className="space-y-1.5">
                                    <div className="flex gap-1.5">
                                      {[{ v: 'min', l: 'Mindestens' }, { v: 'max', l: 'Maximal' }, { v: 'exact', l: 'Genau' }].map(({ v, l }) => (
                                        <button key={v} type="button"
                                          onClick={() => updateActivityFilter(i, fi, { numOperator: v })}
                                          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${(filter.numOperator || 'min') === v ? 'bg-brand-600 text-white' : 'bg-white/[.08] text-white/45'}`}
                                        >{l}</button>
                                      ))}
                                    </div>
                                    <div className="flex gap-2 items-center">
                                      <input type="number" className="input flex-1 text-sm py-1.5"
                                        value={filter.numValue ?? ''}
                                        onChange={e => updateActivityFilter(i, fi, { numValue: e.target.value === '' ? '' : +e.target.value })}
                                        placeholder="Wert" min="0" step="0.1"
                                      />
                                      {field?.unit && <span className="text-xs text-slate-400 flex-shrink-0">{field.unit}</span>}
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    <p className="text-xs text-slate-500 mb-1.5">Muss einen dieser Werte haben:</p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {(field?.options || []).map(opt => (
                                        <button key={opt} type="button"
                                          onClick={() => toggleFilterValue(i, fi, opt)}
                                          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${(filter.values || []).includes(opt) ? 'bg-brand-600 text-white' : 'bg-white/[.08] text-white/45'}`}
                                        >{opt}</button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
              {form.conditions.length >= 2 && (
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-xs text-slate-500">Verknüpfung:</span>
                  {['AND', 'OR'].map(op => (
                    <button key={op} type="button" onClick={() => set('conditionOperator', op)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${form.conditionOperator === op ? 'bg-brand-600 text-white' : 'bg-white/[.08] text-white/45'}`}
                    >{op === 'AND' ? 'UND' : 'ODER'}</button>
                  ))}
                </div>
              )}
            </div>
          </>)}

          {/* ── Step 3: Meilensteine (nur langfristig) ── */}
          {currentStep === 3 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div>
                  <p className="text-sm font-semibold text-white">Meilensteine</p>
                  <p className="text-xs text-slate-500 mt-0.5">Optional – hilft den Fortschritt einzuschätzen</p>
                </div>
                <button type="button" onClick={addStep} className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300"><Plus size={12} /> Hinzufügen</button>
              </div>
              {steps.length === 0 && (
                <button type="button" onClick={addStep}
                  className="w-full mt-3 border-2 border-dashed border-white/20 hover:border-brand-400/60 rounded-2xl py-8 text-slate-500 hover:text-brand-400 transition-colors flex flex-col items-center gap-2"
                >
                  <Plus size={22} />
                  <span className="text-sm">Ersten Meilenstein hinzufügen</span>
                </button>
              )}
              <div className="space-y-2 mt-2">
                {steps.map((milestone, i) => {
                  const firstCond = form.conditions[0];
                  const cLabel = firstCond?.condition === 'max' ? 'maximal' : firstCond?.condition === 'exact' ? 'genau' : 'mindestens';
                  const unit = firstCond?.unitSymbol || '';
                  const mLabel = metricLabel(firstCond?.metric, selectedActivityType?.customFields);
                  return (
                    <div key={i} className="bg-white/[.05] border border-white/[.09] rounded-2xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-300">Meilenstein {i + 1}</span>
                        <button type="button" onClick={() => removeStep(i)} className="text-slate-600 hover:text-red-400"><X size={14} /></button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="label text-xs mb-1">Bis Datum</label>
                          <input type="date" className="input text-sm py-1.5" value={milestone.date} onChange={e => updateStep(i, 'date', e.target.value)} />
                        </div>
                        <div>
                          <label className="label text-xs mb-1">{mLabel}{unit ? ` (${unit})` : ''}</label>
                          <input type="number" className="input text-sm py-1.5" value={milestone.targetValue} onChange={e => updateStep(i, 'targetValue', e.target.value)} placeholder={`${cLabel}…`} min="0" step="0.1" />
                        </div>
                      </div>
                      <div>
                        <label className="label text-xs mb-1">Beschreibung <span className="text-slate-600 font-normal">(optional)</span></label>
                        <input className="input text-sm py-1.5" value={milestone.description} onChange={e => updateStep(i, 'description', e.target.value)} placeholder="z.B. Halbzeitmarke" />
                      </div>
                      {milestone.date && milestone.targetValue !== '' && (
                        <p className="text-xs text-brand-300/80 bg-brand-500/10 rounded-xl px-2 py-1">
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

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-slate-800 flex-shrink-0">
          {currentStep > 1
            ? <button type="button" onClick={() => setCurrentStep(s => s - 1)} className="btn-secondary flex-1">Zurück</button>
            : <button type="button" onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
          }
          {currentStep < totalSteps ? (
            <button type="button"
              onClick={() => setCurrentStep(s => s + 1)}
              disabled={currentStep === 1 && !form.name.trim()}
              className="btn-primary flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
            >Weiter</button>
          ) : (
            <button type="button"
              onClick={handleSubmit}
              disabled={saving || !form.name.trim() || !form.targetRef || !form.conditions.some(c => c.targetValue !== '')}
              className="btn-primary flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
            >{saving ? 'Speichern…' : 'Ziel erstellen'}</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Edit modal (periodic & long-term) ───────────────────────────

function EditGoalModal({ goal, onSave, onClose }) {
  const isActivityGoal = goal.targetRefModel === 'ActivityType' || goal.targetRefModel === 'activity';
  const isLongTerm = goal.type.startsWith('long-term');

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
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center z-50">
      <form onSubmit={handleSubmit} className="bg-[#1e1e30]/95 backdrop-blur-2xl border border-white/[.1] w-full max-w-lg rounded-t-2xl sm:rounded-2xl flex flex-col" style={{ maxHeight: '92dvh' }}>
        <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mt-3 sm:hidden flex-shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-800 flex-shrink-0">
          <h2 className="text-base font-semibold text-white">Ziel bearbeiten</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200 p-1 -mr-1"><X size={20} /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800 flex-shrink-0">
          {tabs.map(t => (
            <button key={t.id} type="button" onClick={() => setEditTab(t.id)}
              className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${editTab === t.id ? 'text-brand-400 border-b-2 border-brand-500 -mb-px' : 'text-zinc-500 hover:text-zinc-300'}`}
            >{t.label}</button>
          ))}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* ── Grundlagen ── */}
          {editTab === 'basics' && (<>
            <div>
              <label className="label">Name</label>
              <input className="input" value={form.name} onChange={e => set('name', e.target.value)} required />
            </div>
            <div>
              <label className="label">Beschreibung <span className="text-slate-600 font-normal">(optional)</span></label>
              <input className="input" value={form.description} onChange={e => set('description', e.target.value)} />
            </div>

            {/* Intervall nur für periodische Ziele */}
            {!isLongTerm && (
              <div className="bg-white/[.05] border border-white/[.09] rounded-2xl p-4">
                <label className="label text-xs mb-2">Intervall</label>
                <div className="flex gap-2">
                  <input
                    type="number" className="input w-20" min="1" max="365"
                    value={form.intervalValue}
                    onChange={e => set('intervalValue', Math.max(1, parseInt(e.target.value) || 1))}
                  />
                  <select className="input flex-1" value={form.intervalUnit} onChange={e => set('intervalUnit', e.target.value)}>
                    <option value="day">Tag(e)</option>
                    <option value="week">Woche(n)</option>
                    <option value="month">Monat(e)</option>
                  </select>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Fortschritt wird {intervalTargetLabel(form.intervalValue, form.intervalUnit)} gemessen
                </p>
              </div>
            )}

            {/* Zeitraum nur für langfristige Ziele */}
            {isLongTerm && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Startdatum</label>
                  <input type="date" className="input" value={form.startDate} onChange={e => set('startDate', e.target.value)} />
                </div>
                <div>
                  <label className="label">Enddatum</label>
                  <input type="date" className="input" value={form.endDate} onChange={e => set('endDate', e.target.value)} />
                </div>
              </div>
            )}
          </>)}

          {/* ── Bedingungen ── */}
          {editTab === 'conditions' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">Was muss erfüllt sein, damit das Ziel gilt?</p>
                <button type="button" onClick={addCondEdit} className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1">
                  <Plus size={12} /> Hinzufügen
                </button>
              </div>
              {conditions.map((cond, i) => (
                <div key={i} className="bg-white/[.05] border border-white/[.09] rounded-2xl p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">
                      {conditions.length > 1 ? `Bedingung ${i + 1}` : 'Bedingung'}
                    </span>
                    {conditions.length > 1 && (
                      <button type="button" onClick={() => removeCondEdit(i)} className="text-slate-600 hover:text-red-400">
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  <div>
                    <label className="label text-xs mb-1">Messgröße</label>
                    <select className="input" value={cond.metric} onChange={e => {
                      const m = e.target.value;
                      updateCondFields(i, {
                        metric: m,
                        valueScope: scopeAppliesEdit(m) ? cond.valueScope : 'total',
                        aggregation: scopeAppliesEdit(m) ? cond.aggregation : 'sum',
                        activityFilters: scopeAppliesEdit(m) ? (cond.activityFilters || []) : [],
                      });
                    }}>
                      {isActivityGoal ? (<>
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
                    </select>
                  </div>

                  <div>
                    <label className="label text-xs mb-1">Bedingung</label>
                    <div className="flex gap-1.5">
                      {[{ v: 'min', l: 'Mindestens' }, { v: 'max', l: 'Maximal' }, { v: 'exact', l: 'Genau' }].map(({ v, l }) => (
                        <button key={v} type="button" onClick={() => updateCond(i, 'condition', v)}
                          className={`flex-1 py-2 rounded-md text-xs font-semibold transition-colors ${cond.condition === v ? 'bg-brand-600 text-white' : 'bg-white/[.08] text-white/45'}`}
                        >{l}</button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="label text-xs mb-1">Zielwert</label>
                    <div className="flex gap-2">
                      <input type="number" className="input flex-1" value={cond.targetValue} onChange={e => updateCond(i, 'targetValue', e.target.value)} min="0" step="0.1" placeholder="z.B. 3" />
                      <input className="input w-20 text-center" value={cond.unitSymbol} onChange={e => updateCond(i, 'unitSymbol', e.target.value)} placeholder="Einheit" />
                    </div>
                  </div>

                  {scopeAppliesEdit(cond.metric) && (
                    <div>
                      <label className="label text-xs mb-1">Was wird gemessen?</label>
                      {isActivityGoal ? (
                        <div className="flex gap-1.5">
                          <button type="button" onClick={() => updateCondFields(i, { valueScope: 'total', aggregation: 'sum' })}
                            className={`flex-1 py-2 rounded-md text-xs font-semibold transition-colors ${cond.aggregation !== 'max' && cond.valueScope !== 'perActivity' ? 'bg-brand-600 text-white' : 'bg-white/[.08] text-white/45'}`}
                          >Gesamt</button>
                          <button type="button" onClick={() => updateCondFields(i, { valueScope: 'perActivity', aggregation: 'sum' })}
                            className={`flex-1 py-2 rounded-md text-xs font-semibold transition-colors ${cond.aggregation !== 'max' && cond.valueScope === 'perActivity' ? 'bg-brand-600 text-white' : 'bg-white/[.08] text-white/45'}`}
                          >Ø / Aktivität</button>
                          <button type="button" onClick={() => updateCondFields(i, { valueScope: 'total', aggregation: 'max' })}
                            className={`flex-1 py-2 rounded-md text-xs font-semibold transition-colors ${cond.aggregation === 'max' ? 'bg-amber-600 text-white' : 'bg-white/[.08] text-white/45'}`}
                          >Bestleistung</button>
                        </div>
                      ) : (
                        <div className="flex gap-1.5">
                          <button type="button" onClick={() => updateCondFields(i, { valueScope: 'total', aggregation: 'sum' })}
                            className={`flex-1 py-2 rounded-md text-xs font-semibold transition-colors ${cond.valueScope !== 'perActivity' ? 'bg-brand-600 text-white' : 'bg-white/[.08] text-white/45'}`}
                          >Gesamt</button>
                          <button type="button" onClick={() => updateCondFields(i, { valueScope: 'perActivity', aggregation: 'sum' })}
                            className={`flex-1 py-2 rounded-md text-xs font-semibold transition-colors ${cond.valueScope === 'perActivity' ? 'bg-brand-600 text-white' : 'bg-white/[.08] text-white/45'}`}
                          >Ø pro Tag</button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Aktivitätsfilter bei Bestleistung */}
                  {cond.aggregation === 'max' && isActivityGoal && filterableFieldsEdit.length > 0 && (
                    <div className="border border-white/[.1] rounded-2xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-semibold text-slate-200">In derselben Aktivität</span>
                          <p className="text-xs text-slate-500 mt-0.5">Felder, die in der Bestleistungs-Aktivität erfüllt sein müssen</p>
                        </div>
                        <button type="button" onClick={() => addFilterEdit(i)} className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1 flex-shrink-0">
                          <Plus size={11} /> Filter
                        </button>
                      </div>
                      {(cond.activityFilters || []).length === 0 && (
                        <p className="text-xs text-slate-600">Kein Filter – gilt für alle Aktivitäten.</p>
                      )}
                      {(cond.activityFilters || []).map((filter, fi) => {
                        const field = filterableFieldsEdit.find(f => f.key === filter.fieldKey) || filterableFieldsEdit[0];
                        const isNum = (filter.fieldType || 'select') === 'number';
                        return (
                          <div key={fi} className="bg-white/[.06] rounded-xl p-2.5 space-y-2">
                            <div className="flex items-center gap-2">
                              <select className="input text-xs py-1.5 flex-1" value={filter.fieldKey}
                                onChange={e => {
                                  const nf = filterableFieldsEdit.find(f => f.key === e.target.value) || filterableFieldsEdit[0];
                                  updateFilterEdit(i, fi, { fieldKey: nf.key, fieldType: nf.type, values: [], numValue: '', numOperator: 'min' });
                                }}
                              >
                                {filterableFieldsEdit.map(f => <option key={f.key} value={f.key}>{f.label}{f.unit ? ` (${f.unit})` : ''}</option>)}
                              </select>
                              <button type="button" onClick={() => removeFilterEdit(i, fi)} className="text-slate-600 hover:text-red-400 flex-shrink-0">
                                <X size={13} />
                              </button>
                            </div>
                            {isNum ? (
                              <div className="space-y-1.5">
                                <div className="flex gap-1.5">
                                  {[{ v: 'min', l: 'Mindestens' }, { v: 'max', l: 'Maximal' }, { v: 'exact', l: 'Genau' }].map(({ v, l }) => (
                                    <button key={v} type="button"
                                      onClick={() => updateFilterEdit(i, fi, { numOperator: v })}
                                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${(filter.numOperator || 'min') === v ? 'bg-brand-600 text-white' : 'bg-white/[.08] text-white/45'}`}
                                    >{l}</button>
                                  ))}
                                </div>
                                <div className="flex gap-2 items-center">
                                  <input type="number" className="input flex-1 text-sm py-1.5"
                                    value={filter.numValue ?? ''}
                                    onChange={e => updateFilterEdit(i, fi, { numValue: e.target.value === '' ? '' : +e.target.value })}
                                    placeholder="Wert" min="0" step="0.1"
                                  />
                                  {field?.unit && <span className="text-xs text-slate-400 flex-shrink-0">{field.unit}</span>}
                                </div>
                              </div>
                            ) : (
                              <div>
                                <p className="text-xs text-slate-500 mb-1.5">Muss einen dieser Werte haben:</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {(field?.options || []).map(opt => (
                                    <button key={opt} type="button"
                                      onClick={() => toggleFilterValueEdit(i, fi, opt)}
                                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${(filter.values || []).includes(opt) ? 'bg-brand-600 text-white' : 'bg-white/[.08] text-white/45'}`}
                                    >{opt}</button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
              {conditions.length >= 2 && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs text-slate-500">Verknüpfung:</span>
                  {['AND', 'OR'].map(op => (
                    <button key={op} type="button" onClick={() => setCondOpEdit(op)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${condOpEdit === op ? 'bg-brand-600 text-white' : 'bg-white/[.08] text-white/45'}`}
                    >{op === 'AND' ? 'UND' : 'ODER'}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Meilensteine ── */}
          {editTab === 'milestones' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-slate-500">Etappenziele auf dem Weg zum Gesamtziel</p>
                <button type="button" onClick={addStep} className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1">
                  <Plus size={12} /> Hinzufügen
                </button>
              </div>
              {steps.length === 0 && (
                <button type="button" onClick={addStep}
                  className="w-full mt-2 border-2 border-dashed border-white/20 hover:border-brand-400/60 rounded-2xl py-6 text-slate-500 hover:text-brand-400 transition-colors flex flex-col items-center gap-2"
                >
                  <Plus size={20} />
                  <span className="text-sm">Ersten Meilenstein hinzufügen</span>
                </button>
              )}
              <div className="space-y-2">
                {steps.map((step, i) => (
                  <div key={i} className="bg-white/[.05] border border-white/[.09] rounded-2xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-300">Meilenstein {i + 1}</span>
                      <button type="button" onClick={() => removeStep(i)} className="text-slate-600 hover:text-red-400"><X size={14} /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="label text-xs mb-0.5">Bis Datum</label>
                        <input type="date" className="input text-sm py-1.5" value={step.date} onChange={e => updateStep(i, 'date', e.target.value)} />
                      </div>
                      <div>
                        <label className="label text-xs mb-0.5">
                          {mLabelEdit}{unitEdit ? <span className="text-slate-500 font-normal"> ({unitEdit})</span> : ''}
                        </label>
                        <input type="number" className="input text-sm py-1.5" value={step.targetValue}
                          onChange={e => updateStep(i, 'targetValue', e.target.value)}
                          placeholder={`${condLabelEdit}…`} min="0" step="0.1"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="label text-xs mb-0.5">Beschreibung <span className="text-slate-600 font-normal">(optional)</span></label>
                      <input className="input text-sm py-1.5" value={step.description}
                        onChange={e => updateStep(i, 'description', e.target.value)}
                        placeholder="z.B. Halbzeitmarke"
                      />
                    </div>
                    {step.date && step.targetValue !== '' && (
                      <p className="text-xs text-brand-300/80 bg-brand-500/10 rounded-xl px-2 py-1">
                        → Bis {format(parseISO(step.date), 'd. MMMM yyyy', { locale: de })}: {condLabelEdit} {step.targetValue}{unitEdit ? ` ${unitEdit}` : ''}{aggregationNoteEdit}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-slate-800 flex-shrink-0">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
          <button type="submit" disabled={saving || !form.name} className="btn-primary flex-1">
            {saving ? 'Speichern…' : 'Speichern'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function Goals() {
  const [goals, setGoals] = useState([]);
  const [activityTypes, setActivityTypes] = useState([]);
  const [habits, setHabits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editGoal, setEditGoal] = useState(null);

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

  const handleDelete = async (id) => {
    if (!confirm('Ziel löschen?')) return;
    await api.delete(`/goals/${id}`);
    load();
  };

  const periodic = goals.filter(g => !g.type.startsWith('long-term'));
  const longTerm = goals.filter(g => g.type.startsWith('long-term'));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Ziele</h1>
          <p className="text-slate-400 text-sm mt-0.5">{goals.length} aktive Ziele</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          <span className="hidden sm:inline">Neues Ziel</span>
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-brand-500 rounded-full animate-spin" />
        </div>
      ) : goals.length === 0 ? (
        <div className="card p-12 text-center">
          <Target size={32} className="text-zinc-700 mx-auto mb-3" />
          <p className="text-slate-400">Noch keine Ziele definiert</p>
          <p className="text-slate-600 text-sm mt-1">Für Aktivitäten und Gewohnheiten</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary mt-4 inline-flex items-center gap-2">
            <Plus size={16} /> Ziel erstellen
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {periodic.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Periodische Ziele</h2>
              <div className="space-y-3">
                {periodic.map(g => (
                  <div key={g._id} className="relative">
                    <GoalProgress goal={g} />
                    <div className="absolute top-4 right-4 flex items-center gap-2">
                      <button onClick={() => setEditGoal(g)} className="text-slate-600 hover:text-brand-400 transition-colors">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => handleDelete(g._id)} className="text-slate-600 hover:text-red-400 transition-colors">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {longTerm.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Langfristige Ziele</h2>
              <div className="space-y-3">
                {longTerm.map(g => (
                  <div key={g._id} className="relative">
                    <GoalProgress goal={g} />
                    <div className="absolute top-4 right-4 flex items-center gap-2">
                      <button onClick={() => setEditGoal(g)} className="text-slate-600 hover:text-brand-400 transition-colors">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => handleDelete(g._id)} className="text-slate-600 hover:text-red-400 transition-colors">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <CreateGoalModal
          activityTypes={activityTypes}
          habits={habits}
          onSave={() => { setShowCreate(false); load(); }}
          onClose={() => setShowCreate(false)}
        />
      )}

      {editGoal && (
        <EditGoalModal
          goal={editGoal}
          onSave={() => { setEditGoal(null); load(); }}
          onClose={() => setEditGoal(null)}
        />
      )}
    </div>
  );
}
