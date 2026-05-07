import { useState, useEffect } from 'react';
import api from '../utils/api';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { Plus, Target, Trash2, X, Dumbbell, Sparkles } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip, CartesianGrid
} from 'recharts';

// ─── Intervall-Hilfsfunktionen ────────────────────────────────────────────────

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

// ─── Fortschrittsanzeige für ein einzelnes Ziel ────────────────────────────

function GoalProgress({ goal }) {
  const [progress, setProgress] = useState(null);
  const [showChart, setShowChart] = useState(false);

  useEffect(() => {
    api.get(`/goals/${goal._id}/progress`).then(r => setProgress(r.data)).catch(() => {});
  }, [goal._id]);

  const { conditions: condResults, conditionOperator: condOp, met: goalMet, weeklyData } = progress || {};
  const isLongTerm = goal.type.startsWith('long-term');
  const isHabit = goal.targetRefModel === 'HabitDefinition' || goal.targetRefModel === 'habit';
  const iv = goal.intervalValue || 1;
  const iu = goal.intervalUnit || 'week';
  const customFields = goal.customFields || [];

  const firstCondTarget = condResults?.[0]?.targetValue ?? goal.targetValue;

  const chartData = (weeklyData || []).map(d => ({
    date: format(parseISO(d.weekStart), 'd. MMM', { locale: de }),
    Wert: d.value,
    Ziel: firstCondTarget,
  }));

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

    return (
      <div key={idx} className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">
            {metricLabel(cond.metric, customFields)} ({condLabel} {targetValue}{unitSymbol ? ` ${unitSymbol}` : ''}):
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

  const currentStep = goal.intermediateSteps
    ?.filter(s => new Date(s.date) >= new Date())
    ?.sort((a, b) => new Date(a.date) - new Date(b.date))[0];

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-white">{goal.name}</h3>
            <span className={`badge text-xs ${isLongTerm ? 'bg-amber-900/50 text-amber-400' : 'bg-brand-900/50 text-brand-400'}`}>
              {isLongTerm ? 'Langfristig' : intervalBadgeLabel(iv, iu)}
            </span>
            <span className={`badge text-xs ${isHabit ? 'bg-emerald-900/40 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
              {isHabit ? <><Sparkles size={10} className="inline mr-1" />Gewohnheit</> : <><Dumbbell size={10} className="inline mr-1" />Aktivität</>}
            </span>
          </div>
          {goal.description && <p className="text-xs text-slate-500 mt-0.5">{goal.description}</p>}
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

      {currentStep && (
        <div className="bg-amber-900/20 border border-amber-800/30 rounded-xl px-3 py-2 text-xs mb-3">
          <span className="text-amber-400 font-medium">Nächster Schritt: </span>
          <span className="text-slate-300">
            {currentStep.targetValue} {goal.unitSymbol} bis {format(parseISO(currentStep.date), 'd. MMM yyyy', { locale: de })}
          </span>
          {currentStep.description && <span className="text-slate-500"> · {currentStep.description}</span>}
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
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} width={30} />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9' }} />
                <Line type="monotone" dataKey="Wert" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Ziel" stroke="#334155" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </>
      )}
    </div>
  );
}

// ─── Formular zum Erstellen eines Ziels ───────────────────────────────────

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
    conditions: [{ metric: 'count', condition: 'min', targetValue: '', unitSymbol: 'Mal' }],
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
  });
  const [steps, setSteps] = useState([]);
  const [saving, setSaving] = useState(false);

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
      conditions: [{ metric: defaultMetric, condition: 'min', targetValue: '', unitSymbol: defaultUnit }],
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
      conditions: [...f.conditions, { metric: defaultMetric, condition: 'min', targetValue: '', unitSymbol: defaultUnit }],
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

  const handleMetricChangeForCondition = (i, metric) => {
    const newUnit = unitForMetric(metric, selectedActivityType, selectedHabit);
    setForm(f => ({
      ...f,
      conditions: f.conditions.map((c, idx) => idx === i ? { ...c, metric, unitSymbol: newUnit } : c),
    }));
  };

  const addStep = () => setSteps(s => [...s, { date: '', targetValue: '', description: '' }]);
  const updateStep = (i, k, v) => setSteps(s => s.map((step, idx) => idx === i ? { ...step, [k]: v } : step));
  const removeStep = (i) => setSteps(s => s.filter((_, idx) => idx !== i));

  const handleSubmit = async (e) => {
    e.preventDefault();
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

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="card w-full max-w-lg p-6 my-4">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white">Neues Ziel</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="z.B. Öfter joggen gehen" required />
          </div>
          <div>
            <label className="label">Beschreibung <span className="text-slate-600">(optional)</span></label>
            <input className="input" value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional" />
          </div>

          {/* Zielart */}
          <div>
            <label className="label">Zielart</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => set('isLongTerm', false)}
                className={`py-2 rounded-xl text-sm font-medium transition-colors ${!form.isLongTerm ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
              >
                Periodisch
              </button>
              <button
                type="button"
                onClick={() => set('isLongTerm', true)}
                className={`py-2 rounded-xl text-sm font-medium transition-colors ${form.isLongTerm ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
              >
                Langfristig
              </button>
            </div>
          </div>

          {/* Intervall (nur bei periodisch) */}
          {!form.isLongTerm && (
            <div>
              <label className="label">Intervall</label>
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
              <p className="text-xs text-slate-500 mt-1">
                Fortschritt wird {targetLabel} gemessen
              </p>
            </div>
          )}

          {/* Kategorie */}
          <div>
            <label className="label">Kategorie</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleCategoryChange('activity')}
                className={`py-2 rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${form.targetCategory === 'activity' ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
              >
                <Dumbbell size={13} /> Aktivität
              </button>
              <button
                type="button"
                onClick={() => handleCategoryChange('habit')}
                className={`py-2 rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${form.targetCategory === 'habit' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
              >
                <Sparkles size={13} /> Gewohnheit
              </button>
            </div>
          </div>

          {/* Ziel (Aktivität oder Gewohnheit) */}
          <div>
            <label className="label flex items-center gap-1.5">
              {isActivityGoal
                ? <><Dumbbell size={13} className="text-brand-400" /> Aktivität</>
                : <><Sparkles size={13} className="text-emerald-400" /> Gewohnheit</>
              }
            </label>
            <select className="input" value={form.targetRef} onChange={e => handleRefChange(e.target.value)}>
              {isActivityGoal
                ? activityTypes.map(t => <option key={t._id} value={t._id}>{t.label}</option>)
                : habits.map(h => <option key={h._id} value={h._id}>{h.name} ({h.unitSymbol})</option>)
              }
            </select>
            {isActivityGoal && activityTypes.length === 0 && (
              <p className="text-xs text-amber-400 mt-1">Keine Aktivitätstypen gefunden. Erstelle zuerst welche unter Aktivitäten.</p>
            )}
            {!isActivityGoal && habits.length === 0 && (
              <p className="text-xs text-amber-400 mt-1">Keine Gewohnheiten gefunden.</p>
            )}
          </div>

          {/* Bedingungen */}
          <div>
            <label className="label">Bedingungen</label>
            <div className="space-y-3">
              {form.conditions.map((cond, i) => (
                <div key={i} className="bg-slate-800/50 border border-slate-700 rounded-xl p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    {/* Messgröße */}
                    <div>
                      <label className="label text-xs mb-1">Messgröße</label>
                      <select
                        className="input text-sm py-1.5"
                        value={cond.metric}
                        onChange={e => handleMetricChangeForCondition(i, e.target.value)}
                      >
                        {isActivityGoal ? (
                          <>
                            <option value="count">Anzahl Einträge</option>
                            {selectedActivityType?.showDuration !== false && <option value="duration">Dauer (min)</option>}
                            {selectedActivityType?.showDistance && <option value="distance">Distanz (km)</option>}
                            {(selectedActivityType?.customFields || []).filter(f => f.type === 'number').map(f => (
                              <option key={f.key} value={`custom_${f.key}`}>{f.label}{f.unit ? ` (${f.unit})` : ''}</option>
                            ))}
                            {(selectedActivityType?.customFields || []).filter(f => f.type === 'select').map(f =>
                              (f.options || []).map(opt => (
                                <option key={`${f.key}:${opt}`} value={`select_${f.key}:${opt}`}>
                                  {f.label} = {opt}
                                </option>
                              ))
                            )}
                          </>
                        ) : (
                          <>
                            <option value="value">Summe der Werte{selectedHabit ? ` (${selectedHabit.unitSymbol})` : ''}</option>
                            <option value="count">Anzahl Tage</option>
                          </>
                        )}
                      </select>
                    </div>
                    {/* Bedingung */}
                    <div>
                      <label className="label text-xs mb-1">Bedingung</label>
                      <select
                        className="input text-sm py-1.5"
                        value={cond.condition}
                        onChange={e => updateCondition(i, 'condition', e.target.value)}
                      >
                        <option value="min">Mindestens</option>
                        <option value="max">Maximal</option>
                        <option value="exact">Genau</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {/* Zielwert */}
                    <div>
                      <label className="label text-xs mb-1">
                        Zielwert {!form.isLongTerm && <span className="text-slate-500 font-normal">{targetLabel}</span>}
                      </label>
                      <input
                        type="number"
                        className="input text-sm py-1.5"
                        value={cond.targetValue}
                        onChange={e => updateCondition(i, 'targetValue', e.target.value)}
                        min="0" step="0.1" placeholder="z.B. 3"
                      />
                    </div>
                    {/* Einheit */}
                    <div>
                      <label className="label text-xs mb-1">Einheit</label>
                      <input
                        className="input text-sm py-1.5"
                        value={cond.unitSymbol}
                        onChange={e => updateCondition(i, 'unitSymbol', e.target.value)}
                        placeholder="z.B. Mal, g, h"
                      />
                    </div>
                  </div>
                  {form.conditions.length > 1 && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => removeCondition(i)}
                        className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
                      >
                        <X size={12} /> Bedingung entfernen
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* AND/OR toggle – shown only when 2+ conditions */}
            {form.conditions.length >= 2 && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-slate-500">Verknüpfung:</span>
                <button
                  type="button"
                  onClick={() => set('conditionOperator', 'AND')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${form.conditionOperator === 'AND' ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
                >
                  UND
                </button>
                <button
                  type="button"
                  onClick={() => set('conditionOperator', 'OR')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${form.conditionOperator === 'OR' ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
                >
                  ODER
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={addCondition}
              className="mt-2 text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1"
            >
              <Plus size={12} /> Bedingung hinzufügen
            </button>
          </div>

          {/* Langfristig: Datum + Zwischenschritte */}
          {form.isLongTerm && (
            <>
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

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">Zwischenschritte</label>
                  <button type="button" onClick={addStep} className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1">
                    <Plus size={12} /> Hinzufügen
                  </button>
                </div>
                <div className="space-y-2">
                  {steps.map((step, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <input type="date" className="input flex-1" value={step.date} onChange={e => updateStep(i, 'date', e.target.value)} />
                      <input type="number" className="input w-24" value={step.targetValue} onChange={e => updateStep(i, 'targetValue', e.target.value)} placeholder="Wert" min="0" step="0.1" />
                      <input className="input flex-1" value={step.description} onChange={e => updateStep(i, 'description', e.target.value)} placeholder="Beschreibung" />
                      <button type="button" onClick={() => removeStep(i)} className="text-red-400 hover:text-red-300 mt-2 flex-shrink-0">
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
            <button
              type="submit"
              disabled={saving || !form.targetRef || !form.conditions.some(c => c.targetValue !== '')}
              className="btn-primary flex-1"
            >
              {saving ? 'Speichern...' : 'Ziel erstellen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Hauptseite ─────────────────────────────────────────────────────────────

export default function Goals() {
  const [goals, setGoals] = useState([]);
  const [activityTypes, setActivityTypes] = useState([]);
  const [habits, setHabits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

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
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : goals.length === 0 ? (
        <div className="card p-12 text-center">
          <Target size={36} className="text-slate-600 mx-auto mb-3" />
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
                    <button onClick={() => handleDelete(g._id)} className="absolute top-4 right-4 text-slate-600 hover:text-red-400 transition-colors">
                      <Trash2 size={15} />
                    </button>
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
                    <button onClick={() => handleDelete(g._id)} className="absolute top-4 right-4 text-slate-600 hover:text-red-400 transition-colors">
                      <Trash2 size={15} />
                    </button>
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
    </div>
  );
}
