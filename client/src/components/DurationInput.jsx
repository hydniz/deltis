import { Input } from './ui';

// A duration entry field — two plain number boxes, "Std" and "Min". It replaces
// a native <input type="time">, which renders as a CLOCK ("8:16 AM") and is the
// wrong mental model for a duration. The value in and out is a duration in
// fractional HOURS (the canonical unit for HH:MM habits), so 8 h 16 min ↔ 8.267.
export default function DurationInput({ value, onChange, invalid = false, className = '' }) {
  const empty = value === '' || value == null;
  const totalMin = empty ? null : Math.round(Number(value) * 60);
  const h = totalMin == null ? '' : Math.floor(totalMin / 60);
  const m = totalMin == null ? '' : totalMin % 60;

  const emit = (nh, nm) => {
    if (nh === '' && nm === '') { onChange(''); return; }
    const H = Math.max(0, parseInt(nh, 10) || 0);
    const M = Math.max(0, Math.min(59, parseInt(nm, 10) || 0));
    onChange((H * 60 + M) / 60);
  };

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <div className="relative flex-1 min-w-0">
        <Input
          type="number" inputMode="numeric" min="0" step="1"
          value={h} invalid={invalid}
          onChange={e => emit(e.target.value, m === '' ? '0' : String(m))}
          className="!pr-9 text-right"
          aria-label="Stunden"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-400 pointer-events-none">Std</span>
      </div>
      <div className="relative flex-1 min-w-0">
        <Input
          type="number" inputMode="numeric" min="0" max="59" step="1"
          value={m} invalid={invalid}
          onChange={e => emit(h === '' ? '0' : String(h), e.target.value)}
          className="!pr-9 text-right"
          aria-label="Minuten"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-400 pointer-events-none">Min</span>
      </div>
    </div>
  );
}
