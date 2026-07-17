// Segmented control — a pill group where exactly one option is active.
// options: [{ value, label, tone? }] — tone 'warn' renders the active state amber.
// Never wider than its container: with many options the pills scroll
// horizontally inside the group instead of stretching the page.
export default function Segmented({ options, value, onChange, className = '' }) {
  return (
    <div className={`flex gap-1 bg-paper-100 border border-paper-200 rounded-full p-1 max-w-full overflow-x-auto no-scrollbar ${className}`}>
      {options.map(opt => {
        const active = value === opt.value;
        const activeCls = opt.tone === 'warn'
          ? 'bg-ocher-400 text-white shadow-sm'
          : 'bg-white dark:bg-ink-200 text-ink-900 shadow-sm';
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex-1 py-1.5 px-2.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap flex-shrink-0 ${
              active ? activeCls : 'text-ink-400 hover:text-ink-600'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
