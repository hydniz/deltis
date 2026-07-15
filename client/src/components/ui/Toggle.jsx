// Small switch toggle.
export default function Toggle({ value, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={() => onChange(!value)}
      className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
        value ? 'bg-brand-500' : 'bg-ink-200'
      }`}
    >
      {/* left-0 anchors the knob explicitly — without it the absolute span
          starts at the button's centered text position and overflows. */}
      <span className={`absolute left-0 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
        value ? 'translate-x-5' : 'translate-x-1'
      }`} />
    </button>
  );
}
