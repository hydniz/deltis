import { Check } from 'lucide-react';

// Custom checkbox with optional label and description, rendered as a
// comfortable touch target. The native input stays for accessibility.
export default function Checkbox({ checked, onChange, label, description, className = '' }) {
  return (
    <label className={`flex items-center gap-3 cursor-pointer group ${className}`}>
      <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
        checked
          ? 'bg-brand-500 border-brand-500'
          : 'bg-surface border-ink-200 group-hover:border-ink-300'
      }`}>
        {checked && <Check size={12} className="text-white" strokeWidth={3} />}
      </span>
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-medium text-ink-800">{label}</span>}
          {description && <span className="block text-xs text-ink-400 mt-0.5">{description}</span>}
        </span>
      )}
    </label>
  );
}
