import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import Modal from '../components/ui/Modal';

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
  document.body.style.overscrollBehaviorY = '';
});

function renderModal(onClose = vi.fn()) {
  render(
    <Modal onClose={onClose} title="Testmodal" subtitle="Untertitel">
      <p>Inhalt</p>
    </Modal>
  );
  return onClose;
}

const touch = (y) => ({ clientY: y });

describe('Modal', () => {
  it('locks the page scroll while open and unlocks on close', () => {
    const { unmount } = render(
      <Modal onClose={() => {}} title="Lock"><p>x</p></Modal>
    );
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.overscrollBehaviorY).toBe('none');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes via the X button and via backdrop click', () => {
    const onClose = renderModal();
    fireEvent.click(screen.getByLabelText('Schließen'));
    expect(onClose).toHaveBeenCalledTimes(1);

    const onClose2 = vi.fn();
    render(<Modal onClose={onClose2} title="Zwei"><p>y</p></Modal>);
    const dialogs = screen.getAllByRole('dialog');
    fireEvent.mouseDown(dialogs[dialogs.length - 1].parentElement);
    expect(onClose2).toHaveBeenCalledTimes(1);
  });

  it('closes on a clear swipe down over the handle', () => {
    const onClose = renderModal();
    const handle = screen.getByTestId('sheet-handle');
    fireEvent.touchStart(handle, { touches: [touch(100)] });
    fireEvent.touchEnd(handle, { changedTouches: [touch(200)] });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores small downward movements and upward swipes on the header', () => {
    const onClose = renderModal();
    const handle = screen.getByTestId('sheet-handle');

    fireEvent.touchStart(handle, { touches: [touch(100)] });
    fireEvent.touchEnd(handle, { changedTouches: [touch(130)] }); // 30px — too small
    fireEvent.touchStart(handle, { touches: [touch(200)] });
    fireEvent.touchEnd(handle, { changedTouches: [touch(80)] });  // upward
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close when swiping inside the content body', () => {
    const onClose = renderModal();
    const content = screen.getByText('Inhalt');
    fireEvent.touchStart(content, { touches: [touch(100)] });
    fireEvent.touchEnd(content, { changedTouches: [touch(300)] });
    expect(onClose).not.toHaveBeenCalled();
  });
});
