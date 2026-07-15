import { TONE_BUBBLE } from './tones';

// Page header with editorial serif title, optional overline, tinted icon
// bubble (each page has its own accent colour) and action slot.
export default function PageHeader({ overline, title, subtitle, icon: Icon, tone = 'clay', action, className = '' }) {
  return (
    <header className={`flex items-end justify-between gap-4 ${className}`}>
      <div className="flex items-center gap-3.5 min-w-0">
        {Icon && (
          <div className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center flex-shrink-0 ${TONE_BUBBLE[tone]}`}>
            <Icon size={19} />
          </div>
        )}
        <div className="min-w-0">
          {overline && (
            <p className="text-[11px] text-ink-400 uppercase tracking-[0.14em] font-semibold mb-1.5">
              {overline}
            </p>
          )}
          <h1 className="display text-3xl sm:text-[2.5rem] sm:leading-tight">{title}</h1>
          {subtitle && <p className="text-ink-500 text-sm mt-1">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="flex-shrink-0 pb-1">{action}</div>}
    </header>
  );
}
