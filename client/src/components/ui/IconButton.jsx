// Small round icon-only button for card corners and list rows.

const TONES = {
  default: 'text-ink-300 hover:text-ink-600 hover:bg-ink-900/[.05]',
  brand: 'text-ink-300 hover:text-brand-600 hover:bg-brand-50',
  danger: 'text-ink-300 hover:text-red-600 hover:bg-red-50',
};

export default function IconButton({
  icon: Icon,
  label,
  tone = 'default',
  size = 15,
  active = false,
  className = '',
  ...rest
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`p-1.5 rounded-full transition-colors flex-shrink-0
        ${active ? 'text-brand-600 bg-brand-50' : TONES[tone]} ${className}`}
      {...rest}
    >
      <Icon size={size} />
    </button>
  );
}
