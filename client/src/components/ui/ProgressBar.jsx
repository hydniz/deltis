// Slim progress bar. Tone is derived from pct when set to 'auto'.
const TONES = {
  brand: 'bg-brand-500',
  success: 'bg-emerald-500',
  warning: 'bg-ocher-400',
  danger: 'bg-red-500',
};

export default function ProgressBar({ pct, tone = 'auto', className = '' }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const resolved = tone === 'auto'
    ? clamped >= 100 ? 'success' : clamped >= 60 ? 'warning' : 'danger'
    : tone;
  return (
    <div className={`h-2 bg-paper-200 rounded-full overflow-hidden ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-500 ${TONES[resolved]}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
