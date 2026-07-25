import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

// Form building blocks: Field (label + hint/error wrapper) and thin
// Input/Select/Textarea wrappers around the shared `.input` style.

export function Field({ label, hint, error, optional = false, children, className = '' }) {
  return (
    <div className={className}>
      {label && (
        <label className="label">
          {label}
          {optional && (
            <span className="normal-case tracking-normal font-normal text-ink-300 ml-1">
              (optional)
            </span>
          )}
        </label>
      )}
      {children}
      {error
        ? <p className="text-xs text-red-600 mt-1.5">{error}</p>
        : hint && <p className="text-xs text-ink-400 mt-1.5">{hint}</p>}
    </div>
  );
}

// Red ring shown when a required field is left empty — used instead of a
// separate error message so the user sees exactly which field to fill.
const INVALID = '!border-red-400 ring-2 ring-red-300/60';

export const Input = forwardRef(function Input({ className = '', invalid = false, ...rest }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} {...rest} className={`input ${invalid ? INVALID : ''} ${className}`} />;
});

export const Select = forwardRef(function Select({ className = '', invalid = false, children, ...rest }, ref) {
  return <select ref={ref} aria-invalid={invalid || undefined} {...rest} className={`input ${invalid ? INVALID : ''} ${className}`}>{children}</select>;
});

export const Textarea = forwardRef(function Textarea({ className = '', invalid = false, ...rest }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} {...rest} className={`input resize-none ${invalid ? INVALID : ''} ${className}`} />;
});

// Password input with show/hide toggle — shared across login, settings,
// admin user management and the setup wizard.
export function PasswordInput({ className = '', mono = false, ...rest }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        {...rest}
        className={`input pr-11 ${mono ? 'font-mono' : ''} ${className}`}
      />
      <button
        type="button"
        onClick={() => setShow(v => !v)}
        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-300 hover:text-ink-600 transition-colors"
        tabIndex={-1}
        aria-label={show ? 'Passwort verbergen' : 'Passwort anzeigen'}
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}
