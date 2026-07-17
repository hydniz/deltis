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

  // Freeze the page while the modal is open: the background must not scroll
  // along with gestures inside the sheet, and Chrome's pull-to-refresh must
  // not fire on a downward swipe. Restores the previous values on unmount,
  // which also keeps stacked modals (zIndex prop) correct.
  useEffect(() => {
    const body = document.body.style;
    const prev = { overflow: body.overflow, overscroll: body.overscrollBehaviorY };
    body.overflow = 'hidden';
    body.overscrollBehaviorY = 'none';
    return () => {
      body.overflow = prev.overflow;
      body.overscrollBehaviorY = prev.overscroll;
    };
  }, []);

  // Swipe-down on the handle/header closes the sheet — a plain gesture
  // without following the finger (the drag-transform variant fought the
  // browser's own scrolling and jittered). Content scrolling in the body
  // never triggers it.
  const touchStartY = useRef(null);
  const onHeaderTouchStart = (e) => { touchStartY.current = e.touches[0].clientY; };
  const onHeaderTouchEnd = (e) => {
    if (touchStartY.current == null) return;
    const delta = e.changedTouches[0].clientY - touchStartY.current;
    touchStartY.current = null;
    if (delta > 60) onClose?.();
  };

  return createPortal(
    <div
      className={`fixed inset-0 ${zIndex} bg-scrim/40 dark:bg-scrim/60 backdrop-blur-[2px] flex items-end sm:items-center justify-center sm:p-4 anim-overlay`}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`bg-surface w-full ${SIZES[size]} rounded-t-3xl sm:rounded-3xl shadow-pop flex flex-col anim-modal`}
        style={{ maxHeight: '92dvh' }}
      >
        {/* Drag handle – mobile only; swiping down here closes too */}
        <div
          className="w-10 h-1 bg-ink-200 rounded-full mx-auto mt-3 sm:hidden flex-shrink-0"
          data-testid="sheet-handle"
          style={{ touchAction: 'none' }}
          onTouchStart={onHeaderTouchStart}
          onTouchEnd={onHeaderTouchEnd}
        />

        {/* Header — swipe-down here closes the sheet */}
        <div
          className="flex items-center justify-between px-5 sm:px-6 pt-4 pb-3.5 border-b hairline flex-shrink-0"
          style={{ touchAction: 'none' }}
          onTouchStart={onHeaderTouchStart}
          onTouchEnd={onHeaderTouchEnd}
        >
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
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 overscroll-contain">
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
