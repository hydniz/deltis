// Daily completion semantics for habits.
//
// A habit can define a target (`targetCondition` + `targetValue`, stored in
// the per-user settings): a logged day only counts as *fulfilled* when the
// value satisfies the condition. Without a target, any log fulfils the day.
// Boolean (Ja/Nein) habits are fulfilled by any value >= 1.

export const TARGET_CONDITIONS = [
  { value: 'none', label: 'Kein Ziel' },
  { value: 'min', label: 'Mindestens' },
  { value: 'max', label: 'Höchstens' },
  { value: 'exact', label: 'Genau' },
];

export function meetsTarget(habit, value) {
  if (value == null) return false;
  if (habit.type === 'boolean') return value >= 1;
  const condition = habit.targetCondition;
  if (!condition || condition === 'none') return true;
  const target = +habit.targetValue || 0;
  if (condition === 'min') return value >= target;
  if (condition === 'max') return value <= target;
  if (condition === 'exact') return value === target;
  return true;
}

// Saturation for the heatmap: null = no entry (empty cell), 1 = fulfilled,
// in between = partial progress towards a min/exact target. An exceeded
// max target renders dim (0.25) — logged, but the goal was missed.
export function progressRatio(habit, value) {
  if (value == null) return null;
  if (meetsTarget(habit, value)) return 1;
  const target = +habit.targetValue || 0;
  if ((habit.targetCondition === 'min' || habit.targetCondition === 'exact') && target > 0) {
    return Math.max(0.15, Math.min(value / target, 0.95));
  }
  return 0.25;
}

// Short human-readable target label, e.g. 'mind. 8 ml'.
export function formatTarget(habit) {
  const condition = habit.targetCondition;
  if (!condition || condition === 'none') return '';
  const prefix = condition === 'min' ? 'mind.' : condition === 'max' ? 'max.' : 'genau';
  return `${prefix} ${habit.targetValue} ${habit.unitSymbol}`;
}
