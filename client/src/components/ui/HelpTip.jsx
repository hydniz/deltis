import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle } from 'lucide-react';
import Modal from './Modal';
import Button from './Button';

// Two-stage inline help: hovering the icon shows a one-line summary, clicking
// it opens the full explanation. Touch devices have no hover – there a tap
// goes straight to the modal, which carries the complete text anyway.
//
// The tooltip renders through a portal because the admin cards clip their
// content (`overflow-hidden`), which would cut off an absolutely positioned
// child.

const TIP_WIDTH = 260;
const EDGE_GAP = 8;
// Below this distance to the viewport top the tooltip flips underneath.
const FLIP_THRESHOLD = 96;

export default function HelpTip({ title, short, children, size = 13, className = '' }) {
  const [tip, setTip] = useState(null);
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);

  const showTip = useCallback(() => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const half = TIP_WIDTH / 2;
    const center = rect.left + rect.width / 2;
    const below = rect.top < FLIP_THRESHOLD;
    setTip({
      // Keep the box inside the viewport on narrow screens.
      left: Math.min(
        Math.max(center, half + EDGE_GAP),
        Math.max(window.innerWidth - half - EDGE_GAP, half + EDGE_GAP),
      ),
      top: below ? rect.bottom + 8 : rect.top - 8,
      below,
    });
  }, []);

  const hideTip = useCallback(() => setTip(null), []);

  // The position is measured once, so any scroll or resize invalidates it.
  useEffect(() => {
    if (!tip) return undefined;
    window.addEventListener('scroll', hideTip, true);
    window.addEventListener('resize', hideTip);
    return () => {
      window.removeEventListener('scroll', hideTip, true);
      window.removeEventListener('resize', hideTip);
    };
  }, [tip, hideTip]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={`Hilfe: ${title}`}
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
        onClick={() => { hideTip(); setOpen(true); }}
        className={`p-0.5 rounded-full text-ink-300 hover:text-brand-600 transition-colors
          flex-shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${className}`}
      >
        <HelpCircle size={size} />
      </button>

      {tip && short && createPortal(
        <div
          role="tooltip"
          className="fixed z-[60] pointer-events-none"
          style={{
            left: tip.left,
            top: tip.top,
            width: TIP_WIDTH,
            transform: `translate(-50%, ${tip.below ? '0' : '-100%'})`,
          }}
        >
          <div className="bg-charcoal text-cream/90 text-xs leading-snug rounded-lg px-3 py-2 shadow-pop">
            {short}
            <span className="block mt-1 text-[10px] text-cream/40">Klicken für Details</span>
          </div>
        </div>,
        document.body,
      )}

      {open && (
        <Modal
          onClose={() => setOpen(false)}
          title={title}
          icon={HelpCircle}
          size="md"
          // Stays above a host modal when help is used inside one.
          zIndex="z-[70]"
          footer={
            <Button variant="secondary" className="w-full" onClick={() => setOpen(false)}>
              Verstanden
            </Button>
          }
        >
          <div className="text-sm text-ink-600 space-y-3
            [&_code]:font-mono [&_code]:text-xs [&_code]:bg-ink-900/[.06] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded
            [&_strong]:font-semibold [&_strong]:text-ink-800
            [&_ul]:space-y-1.5 [&_ul]:list-disc [&_ul]:pl-4 [&_li]:pl-0.5">
            {children}
          </div>
        </Modal>
      )}
    </>
  );
}
