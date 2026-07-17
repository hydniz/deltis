import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// Unified modal: bottom sheet on mobile, centered dialog from `sm` upwards.
// Supports wizard step dots via `steps` (total) + `step` (1-based current).
// Body scrolls; header and footer stay fixed.
//
// Rendered through a portal on document.body: pages animate with transforms
// (page-enter, anim-list), and a transformed ancestor would otherwise become
// the containing block for position:fixed — shifting the overlay and dialog.

const SIZES = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
};

export function StepDots({ steps, step }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`Schritt ${step} von ${steps}`}>
      {Array.from({ length: steps }).map((_, i) => (
        <div
          key={i}
          className={`rounded-full transition-all duration-200 ${
            i + 1 === step ? 'w-5 h-1.5 bg-brand-500'
            : i + 1 < step ? 'w-1.5 h-1.5 bg-brand-400'
            : 'w-1.5 h-1.5 bg-ink-200'
          }`}
        />
      ))}
    </div>
  );
}

export default function Modal({
  onClose,
  title,
  subtitle,
  icon: Icon,
  size = 'md',
  steps,
  step,
  footer,
  children,
  zIndex = 'z-50',
}) {
  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Swipe-down to close (touch devices): dragging the sheet downwards — from
  // the header/handle, or from the body while it is scrolled to the top —
  // follows the finger and closes past a small threshold. Upward drags and
  // scrolling inside the body keep working normally.
  const sheetRef = useRef(null);
  const bodyRef = useRef(null);
  const drag = useRef({ active: false, startY: 0, delta: 0 });

  const onTouchStart = (e) => {
    const body = bodyRef.current;
    const fromBody = body && body.contains(e.target);
    if (fromBody && body.scrollTop > 0) return; // inner scroll wins
    drag.current = { active: true, startY: e.touches[0].clientY, delta: 0 };
  };
  const onTouchMove = (e) => {
    if (!drag.current.active || !sheetRef.current) return;
    const delta = e.touches[0].clientY - drag.current.startY;
    drag.current.delta = Math.max(0, delta);
    sheetRef.current.style.transition = 'none';
    sheetRef.current.style.transform = drag.current.delta > 0
      ? `translateY(${drag.current.delta}px)`
      : '';
  };
  const onTouchEnd = () => {
    if (!drag.current.active) return;
    const el = sheetRef.current;
    drag.current.active = false;
    if (drag.current.delta > 90) {
      onClose?.();
      return;
    }
    if (el) {
      el.style.transition = 'transform 200ms ease';
      el.style.transform = '';
      setTimeout(() => { if (el) el.style.transition = ''; }, 220);
    }
  };

  return createPortal(
    <div
      className={`fixed inset-0 ${zIndex} bg-scrim/40 dark:bg-scrim/60 backdrop-blur-[2px] flex items-end sm:items-center justify-center sm:p-4 anim-overlay`}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        className={`bg-surface w-full ${SIZES[size]} rounded-t-3xl sm:rounded-3xl shadow-pop flex flex-col anim-modal`}
        style={{ maxHeight: '92dvh' }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {/* Drag handle – mobile only */}
        <div className="w-10 h-1 bg-ink-200 rounded-full mx-auto mt-3 sm:hidden flex-shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 pt-4 pb-3.5 border-b hairline flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {Icon && (
              <div className="w-9 h-9 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center flex-shrink-0">
                <Icon size={16} />
              </div>
            )}
            <div className="min-w-0">
              <h2 className="display text-lg leading-snug truncate">{title}</h2>
              {subtitle && <p className="text-xs text-ink-400 mt-0.5 truncate">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0 ml-3">
            {steps > 1 && <StepDots steps={steps} step={step} />}
            <button
              type="button"
              onClick={onClose}
              aria-label="Schließen"
              className="p-1.5 -mr-1.5 rounded-full text-ink-300 hover:text-ink-700 hover:bg-ink-900/[.05] transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 overscroll-contain">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex gap-3 px-5 sm:px-6 py-4 border-t hairline flex-shrink-0
            pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
