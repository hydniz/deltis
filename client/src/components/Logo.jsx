import { APP_NAME } from '../config/branding';

// Wordmark: terracotta delta mark + serif wordmark.
export function DeltaMark({ size = 'md' }) {
  const cls = size === 'lg' ? 'w-12 h-12 text-xl' : size === 'sm' ? 'w-7 h-7 text-xs' : 'w-9 h-9 text-sm';
  return (
    <div
      className={`${cls} rounded-full flex items-center justify-center flex-shrink-0 text-white font-display font-semibold`}
      style={{
        background: 'linear-gradient(135deg, var(--brand-400), var(--brand-600))',
        boxShadow: '0 2px 8px rgba(138, 60, 30, 0.35)',
      }}
      aria-hidden="true"
    >
      Δ
    </div>
  );
}

export default function Logo({ size = 'md' }) {
  const textCls = size === 'lg' ? 'text-2xl' : 'text-lg';
  return (
    <div className="flex items-center gap-2.5">
      <DeltaMark size={size === 'lg' ? 'md' : 'sm'} />
      <span className={`font-display font-semibold tracking-tight text-ink-900 ${textCls}`}>
        {APP_NAME}
      </span>
    </div>
  );
}
