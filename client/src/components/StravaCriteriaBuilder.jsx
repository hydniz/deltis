// Criteria editor for Strava goals: builds the rule tree evaluated by the
// backend criteria engine (server/services/stravaCriteria.js). Rule kinds and
// metric definitions mirror the backend registry.
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Field, Input, Select, Chip, Segmented, IconButton } from './ui';

export const STRAVA_METRICS = [
  { value: 'movingTime', label: 'Dauer (in Bewegung)', unit: 'min' },
  { value: 'elapsedTime', label: 'Dauer (gesamt)', unit: 'min' },
  { value: 'distance', label: 'Distanz', unit: 'km' },
  { value: 'totalElevationGain', label: 'Höhenmeter', unit: 'm' },
  { value: 'averageSpeed', label: 'Ø Geschwindigkeit', unit: 'km/h' },
  { value: 'averageHeartrate', label: 'Ø Herzfrequenz', unit: 'bpm' },
  { value: 'maxHeartrate', label: 'Max. Herzfrequenz', unit: 'bpm' },
  { value: 'averageWatts', label: 'Ø Leistung', unit: 'W' },
  { value: 'calories', label: 'Kalorien', unit: 'kcal' },
  { value: 'sufferScore', label: 'Relative Anstrengung', unit: '' },
];

// Frequent Strava sport types as quick picks — the full list is long and
// grows; unknown types can always be added via free text.
export const COMMON_SPORT_TYPES = [
  'Run', 'TrailRun', 'VirtualRun', 'Ride', 'GravelRide', 'MountainBikeRide',
  'VirtualRide', 'Swim', 'Walk', 'Hike', 'WeightTraining', 'Workout',
  'Crossfit', 'Yoga', 'Rowing', 'Elliptical', 'StairStepper', 'InlineSkate',
  'NordicSki', 'AlpineSki', 'Snowboard', 'Soccer', 'Tennis', 'Golf',
];

export function emptyGroup(operator = 'AND') {
  return { operator, rules: [] };
}

function newRule(kind) {
  if (kind === 'sportType') return { kind, values: [] };
  if (kind === 'metricRange') return { kind, metric: 'movingTime', min: '', max: '' };
  if (kind === 'hrPercentInRange') return { kind, minHr: '', maxHr: '', minPercent: 85 };
  if (kind === 'hrZonePercent') return { kind, zone: 2, minPercent: 85 };
  return { kind: 'group', operator: 'OR', rules: [] };
}

// Converts the edit state into the backend payload: numeric strings become
// numbers, incomplete rules are dropped, an empty tree becomes null
// ("every activity counts").
export function normalizeCriteria(group) {
  if (!group) return null;
  const rules = (group.rules || []).map(normalizeRule).filter(Boolean);
  if (rules.length === 0) return null;
  return { operator: group.operator === 'OR' ? 'OR' : 'AND', rules };
}

function num(v) {
  return v === '' || v == null ? undefined : +v;
}

function normalizeRule(rule) {
  if (!rule) return null;
  if (rule.kind === 'sportType') {
    return rule.values?.length ? { kind: 'sportType', values: rule.values } : null;
  }
  if (rule.kind === 'metricRange') {
    const min = num(rule.min);
    const max = num(rule.max);
    if (min === undefined && max === undefined) return null;
    return {
      kind: 'metricRange',
      metric: rule.metric,
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
    };
  }
  if (rule.kind === 'hrPercentInRange') {
    const minHr = num(rule.minHr);
    const maxHr = num(rule.maxHr);
    const minPercent = num(rule.minPercent);
    if (minHr === undefined || maxHr === undefined || minPercent === undefined) return null;
    return { kind: 'hrPercentInRange', minHr, maxHr, minPercent };
  }
  if (rule.kind === 'hrZonePercent') {
    const minPercent = num(rule.minPercent);
    if (minPercent === undefined) return null;
    return { kind: 'hrZonePercent', zone: +rule.zone || 2, minPercent };
  }
  if (rule.kind === 'group') {
    const nested = normalizeCriteria({ operator: rule.operator, rules: rule.rules });
    return nested ? { kind: 'group', ...nested } : null;
  }
  return null;
}

// Compact human-readable summary for goal cards.
export function criteriaSummary(criteria) {
  if (!criteria?.rules?.length) return 'Alle Strava-Aktivitäten';
  const joiner = criteria.operator === 'OR' ? ' oder ' : ' und ';
  return criteria.rules.map(rule => {
    if (rule.kind === 'sportType') return (rule.values || []).join('/');
    if (rule.kind === 'metricRange') {
      const metric = STRAVA_METRICS.find(m => m.value === rule.metric);
      const label = metric?.label || rule.metric;
      const unit = metric?.unit ? ` ${metric.unit}` : '';
      if (rule.min != null && rule.max != null) return `${label} ${rule.min}–${rule.max}${unit}`;
      if (rule.min != null) return `${label} ≥ ${rule.min}${unit}`;
      return `${label} ≤ ${rule.max}${unit}`;
    }
    if (rule.kind === 'hrPercentInRange') return `≥ ${rule.minPercent} % Puls ${rule.minHr}–${rule.maxHr} bpm`;
    if (rule.kind === 'hrZonePercent') return `≥ ${rule.minPercent} % in HF-Zone ${rule.zone}`;
    if (rule.kind === 'group') return `(${criteriaSummary(rule)})`;
    return '';
  }).filter(Boolean).join(joiner);
}

const RULE_LABELS = {
  sportType: 'Sportart',
  metricRange: 'Messwert',
  hrPercentInRange: 'Puls-Anteil in Bereich',
  hrZonePercent: 'Strava-Herzzone',
  group: 'Untergruppe',
};

function SportTypeRuleEditor({ rule, sportTypes, onChange }) {
  const [custom, setCustom] = useState('');
  const values = rule.values || [];
  const options = [...new Set([...COMMON_SPORT_TYPES, ...sportTypes, ...values])];

  const toggle = (type) => {
    onChange({
      ...rule,
      values: values.includes(type) ? values.filter(v => v !== type) : [...values, type],
    });
  };

  const addCustom = () => {
    const value = custom.trim();
    if (!value) return;
    if (!values.includes(value)) onChange({ ...rule, values: [...values, value] });
    setCustom('');
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-400">Aktivität muss eine dieser Sportarten sein:</p>
      <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
        {options.map(type => (
          <Chip key={type} color="clay" active={values.includes(type)} onClick={() => toggle(type)}>
            {type}
          </Chip>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          className="flex-1 !text-xs !py-1.5"
          value={custom}
          onChange={e => setCustom(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
          placeholder="Andere Sportart (Strava-Name)"
        />
        <button
          type="button"
          onClick={addCustom}
          className="text-xs font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1 flex-shrink-0"
        >
          <Plus size={11} /> Hinzufügen
        </button>
      </div>
    </div>
  );
}

function MetricRangeRuleEditor({ rule, onChange }) {
  const metric = STRAVA_METRICS.find(m => m.value === rule.metric);
  return (
    <div className="space-y-2">
      <Select
        className="!text-xs !py-1.5"
        value={rule.metric}
        onChange={e => onChange({ ...rule, metric: e.target.value })}
      >
        {STRAVA_METRICS.map(m => (
          <option key={m.value} value={m.value}>{m.label}{m.unit ? ` (${m.unit})` : ''}</option>
        ))}
      </Select>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Mindestens" optional>
          <Input
            type="number" className="!text-sm !py-1.5" min="0" step="0.1"
            value={rule.min ?? ''}
            onChange={e => onChange({ ...rule, min: e.target.value })}
            placeholder={metric?.unit || 'Wert'}
          />
        </Field>
        <Field label="Höchstens" optional>
          <Input
            type="number" className="!text-sm !py-1.5" min="0" step="0.1"
            value={rule.max ?? ''}
            onChange={e => onChange({ ...rule, max: e.target.value })}
            placeholder={metric?.unit || 'Wert'}
          />
        </Field>
      </div>
    </div>
  );
}

function HrPercentRuleEditor({ rule, onChange }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-400">
        Mindestanteil der Trainingszeit, in dem der Puls im Bereich lag (braucht Herzfrequenz-Aufzeichnung):
      </p>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Puls von">
          <Input
            type="number" className="!text-sm !py-1.5" min="30" max="250"
            value={rule.minHr ?? ''}
            onChange={e => onChange({ ...rule, minHr: e.target.value })}
            placeholder="z.B. 120"
          />
        </Field>
        <Field label="Puls bis">
          <Input
            type="number" className="!text-sm !py-1.5" min="30" max="250"
            value={rule.maxHr ?? ''}
            onChange={e => onChange({ ...rule, maxHr: e.target.value })}
            placeholder="z.B. 145"
          />
        </Field>
        <Field label="Anteil (%)">
          <Input
            type="number" className="!text-sm !py-1.5" min="1" max="100"
            value={rule.minPercent ?? ''}
            onChange={e => onChange({ ...rule, minPercent: e.target.value })}
            placeholder="z.B. 85"
          />
        </Field>
      </div>
    </div>
  );
}

function HrZoneRuleEditor({ rule, onChange }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-400">
        Mindestanteil der Zeit in einer Strava-Herzfrequenzzone (nutzt deine Zonen-Einstellungen bei Strava):
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Zone">
          <Select
            className="!text-sm !py-1.5"
            value={rule.zone}
            onChange={e => onChange({ ...rule, zone: +e.target.value })}
          >
            {[1, 2, 3, 4, 5].map(z => <option key={z} value={z}>Zone {z}</option>)}
          </Select>
        </Field>
        <Field label="Anteil (%)">
          <Input
            type="number" className="!text-sm !py-1.5" min="1" max="100"
            value={rule.minPercent ?? ''}
            onChange={e => onChange({ ...rule, minPercent: e.target.value })}
            placeholder="z.B. 85"
          />
        </Field>
      </div>
    </div>
  );
}

function RuleEditor({ rule, sportTypes, depth, onChange, onRemove }) {
  return (
    <div className="bg-surface border hairline rounded-xl p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-ink-700">{RULE_LABELS[rule.kind] || rule.kind}</span>
        <IconButton icon={X} label="Regel entfernen" tone="danger" size={13} onClick={onRemove} />
      </div>
      {rule.kind === 'sportType' && <SportTypeRuleEditor rule={rule} sportTypes={sportTypes} onChange={onChange} />}
      {rule.kind === 'metricRange' && <MetricRangeRuleEditor rule={rule} onChange={onChange} />}
      {rule.kind === 'hrPercentInRange' && <HrPercentRuleEditor rule={rule} onChange={onChange} />}
      {rule.kind === 'hrZonePercent' && <HrZoneRuleEditor rule={rule} onChange={onChange} />}
      {rule.kind === 'group' && (
        <GroupEditor
          group={rule}
          sportTypes={sportTypes}
          depth={depth + 1}
          onChange={changes => onChange({ ...rule, ...changes })}
        />
      )}
    </div>
  );
}

// Editor for one rule group; the UI allows one nesting level (the backend
// schema supports more, an existing deeper tree is preserved untouched).
function GroupEditor({ group, sportTypes, depth, onChange }) {
  const rules = group.rules || [];

  const addRule = (kind) => onChange({ rules: [...rules, newRule(kind)] });
  const updateRule = (i, next) => onChange({ rules: rules.map((r, idx) => idx === i ? next : r) });
  const removeRule = (i) => onChange({ rules: rules.filter((_, idx) => idx !== i) });

  const addable = ['sportType', 'metricRange', 'hrPercentInRange', 'hrZonePercent',
    ...(depth === 0 ? ['group'] : [])];

  return (
    <div className="space-y-2.5">
      {rules.length >= 2 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-400">Verknüpfung:</span>
          <Segmented
            className="w-40"
            value={group.operator || 'AND'}
            onChange={v => onChange({ operator: v })}
            options={[{ value: 'AND', label: 'UND' }, { value: 'OR', label: 'ODER' }]}
          />
        </div>
      )}

      {rules.map((rule, i) => (
        <div key={i}>
          {i > 0 && (
            <div className="flex items-center gap-2 my-1.5">
              <div className="flex-1 h-px bg-paper-200" />
              <span className="text-xs font-semibold text-ink-400 px-1">
                {(group.operator || 'AND') === 'OR' ? 'ODER' : 'UND'}
              </span>
              <div className="flex-1 h-px bg-paper-200" />
            </div>
          )}
          <RuleEditor
            rule={rule}
            sportTypes={sportTypes}
            depth={depth}
            onChange={next => updateRule(i, next)}
            onRemove={() => removeRule(i)}
          />
        </div>
      ))}

      <div className="flex flex-wrap gap-1.5">
        {addable.map(kind => (
          <button
            key={kind}
            type="button"
            onClick={() => addRule(kind)}
            className="text-xs font-semibold text-brand-600 hover:text-brand-700 border border-dashed border-brand-300 hover:border-brand-400 rounded-full px-2.5 py-1 flex items-center gap-1 transition-colors"
          >
            <Plus size={11} /> {RULE_LABELS[kind]}
          </button>
        ))}
      </div>
    </div>
  );
}

// Public component. `criteria` is the edit state (may contain '' strings while
// typing); the parent converts it via normalizeCriteria() on submit.
export default function StravaCriteriaBuilder({ criteria, onChange, sportTypes = [] }) {
  const group = criteria || emptyGroup();
  return (
    <div className="panel p-3.5 space-y-2.5">
      <div>
        <span className="text-xs font-semibold text-ink-700">Welche Aktivitäten zählen?</span>
        <p className="text-xs text-ink-400 mt-0.5">
          {group.rules?.length
            ? 'Nur Aktivitäten, die diese Kriterien erfüllen, zählen für das Ziel.'
            : 'Ohne Kriterien zählt jede synchronisierte Strava-Aktivität.'}
        </p>
      </div>
      <GroupEditor
        group={group}
        sportTypes={sportTypes}
        depth={0}
        onChange={changes => onChange({ ...group, ...changes })}
      />
    </div>
  );
}
