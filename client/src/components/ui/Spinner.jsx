// Loading indicators. `contrast` renders a white spinner for dark/brand surfaces.

const SIZES = {
  xs: 'w-3.5 h-3.5 border-2',
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-8 h-8 border-[3px]',
};

export function Spinner({ size = 'md', contrast = false, className = '' }) {
  const colors = contrast
    ? 'border-white/30 border-t-white'
    : 'border-ink-200 border-t-brand-500';
  return (
    <div className={`${SIZES[size]} ${colors} rounded-full animate-spin ${className}`} />
  );
}

// Full-area loader for page-level loading states. Fades in with a short
// delay so fast page loads never flash a spinner.
export function PageLoader() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 loader-delayed">
      <Spinner size="lg" />
      <p className="text-xs text-ink-300 font-medium">Lädt …</p>
    </div>
  );
}
