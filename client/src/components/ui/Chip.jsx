// Outlined pill chips — the colour signature of the design.
// `color` picks a palette entry; `active` fills the chip solid.
// chipColorFor(key) deterministically assigns a colour to arbitrary keys
// (e.g. activity types) so each type keeps its colour everywhere.

export const CHIP_COLORS = ['clay', 'sage', 'amber', 'rose', 'olive'];

const OUTLINE = {
  clay: 'chip-clay',
  sage: 'chip-sage',
  amber: 'chip-amber',
  rose: 'chip-rose',
  olive: 'chip-olive',
  stone: 'chip-stone',
};

const SOLID = {
  clay: 'border-brand-500 bg-brand-500 text-white',
  sage: 'border-sage-500 bg-sage-500 text-white',
  amber: 'border-ocher-400 bg-ocher-400 text-white',
  rose: 'border-rose-500 bg-rose-500 text-white',
  // Olive and stone fills invert to light tones in dark mode, so their text
  // uses tokens that invert alongside instead of fixed white.
  olive: 'border-lime-700 bg-lime-700 text-lime-50',
  stone: 'border-ink-700 bg-ink-700 text-ink-50',
};

// Softly filled chips — carry more colour than outline, used for
// informational badges (goal types, categories).
const SOFT = {
  clay: 'border-brand-100 bg-brand-50 text-brand-700',
  sage: 'border-sage-200 bg-sage-100 text-sage-700',
  amber: 'border-ocher-200 bg-ocher-100 text-ocher-700',
  rose: 'border-rose-100 bg-rose-50 text-rose-600',
  olive: 'border-lime-100 bg-lime-50 text-lime-700',
  stone: 'border-paper-200 bg-paper-100 text-ink-500',
};

export function chipColorFor(key) {
  const hash = [...String(key ?? '')].reduce((h, c) => h + c.charCodeAt(0), 0);
  return CHIP_COLORS[hash % CHIP_COLORS.length];
}

export default function Chip({
  color = 'stone',
  variant = 'outline',
  active = false,
  icon: Icon,
  onClick,
  children,
  className = '',
  ...rest
}) {
  const colorCls = active ? SOLID[color] : variant === 'soft' ? SOFT[color] : OUTLINE[color];
  const base = `chip ${colorCls} ${className}`;
  if (!onClick) {
    return <span className={base} {...rest}>{Icon && <Icon size={12} />}{children}</span>;
  }
  return (
    <button type="button" onClick={onClick} className={`${base} cursor-pointer hover:shadow-sm`} {...rest}>
      {Icon && <Icon size={12} />}
      {children}
    </button>
  );
}
