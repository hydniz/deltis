import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HelpTip from '../components/ui/HelpTip';

afterEach(() => { document.body.innerHTML = ''; });

const setup = () => render(
  <HelpTip title="Server-Port" short="Standard ist 3001.">
    <p>Der TCP-Port, auf dem Deltis lauscht.</p>
  </HelpTip>
);

describe('HelpTip', () => {
  it('shows neither tooltip nor dialog until asked', () => {
    setup();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('labels the trigger with the help title', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Hilfe: Server-Port' })).toBeInTheDocument();
  });

  it('shows the short text on hover and hides it again on unhover', async () => {
    const user = userEvent.setup();
    setup();
    const trigger = screen.getByRole('button', { name: 'Hilfe: Server-Port' });

    await user.hover(trigger);
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Standard ist 3001.');
    expect(tip).toHaveTextContent('Klicken für Details');
    // Hovering must not reveal the long text – that is what the click is for.
    expect(screen.queryByText('Der TCP-Port, auf dem Deltis lauscht.')).not.toBeInTheDocument();

    await user.unhover(trigger);
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('shows the short text on keyboard focus', async () => {
    const user = userEvent.setup();
    setup();
    await user.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Standard ist 3001.');
  });

  it('opens the detailed explanation on click and drops the tooltip', async () => {
    const user = userEvent.setup();
    setup();
    const trigger = screen.getByRole('button', { name: 'Hilfe: Server-Port' });

    await user.hover(trigger);
    await screen.findByRole('tooltip');
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Der TCP-Port, auf dem Deltis lauscht.');
    expect(dialog).toHaveTextContent('Server-Port');
    // The tooltip would otherwise hang over the modal it opened.
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('closes the dialog via the footer button', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Hilfe: Server-Port' }));
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'Verstanden' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes the dialog on Escape', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Hilfe: Server-Port' }));
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('hides the tooltip on scroll – its position was measured once', async () => {
    const user = userEvent.setup();
    setup();
    await user.hover(screen.getByRole('button', { name: 'Hilfe: Server-Port' }));
    await screen.findByRole('tooltip');

    window.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('hides the tooltip on resize', async () => {
    const user = userEvent.setup();
    setup();
    await user.hover(screen.getByRole('button', { name: 'Hilfe: Server-Port' }));
    await screen.findByRole('tooltip');

    window.dispatchEvent(new Event('resize'));
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('renders no tooltip when no short text is given', async () => {
    const user = userEvent.setup();
    render(<HelpTip title="Ohne Kurztext"><p>Nur Details.</p></HelpTip>);

    await user.hover(screen.getByRole('button', { name: 'Hilfe: Ohne Kurztext' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    // The detailed explanation still works.
    await user.click(screen.getByRole('button', { name: 'Hilfe: Ohne Kurztext' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Nur Details.');
  });

  it('keeps the tooltip inside the viewport near the right edge', async () => {
    const user = userEvent.setup();
    render(
      <div style={{ position: 'absolute', left: 0 }}>
        <HelpTip title="Rand" short="Am Rand." />
      </div>
    );
    const trigger = screen.getByRole('button', { name: 'Hilfe: Rand' });
    // jsdom reports a zero rect, so pin a position near the right viewport edge.
    trigger.getBoundingClientRect = () => ({
      top: 400, bottom: 414, left: window.innerWidth - 4, right: window.innerWidth, width: 14, height: 14,
    });

    await user.hover(trigger);
    const tip = await screen.findByRole('tooltip');
    const left = parseFloat(tip.style.left);
    // Centre stays at least half the tooltip width away from the edge.
    expect(left).toBeLessThanOrEqual(window.innerWidth - 130 - 8);
  });

  it('flips below the trigger when there is no room above', async () => {
    const user = userEvent.setup();
    render(<HelpTip title="Oben" short="Ganz oben." />);
    const trigger = screen.getByRole('button', { name: 'Hilfe: Oben' });
    trigger.getBoundingClientRect = () => ({
      top: 10, bottom: 24, left: 200, right: 214, width: 14, height: 14,
    });

    await user.hover(trigger);
    const tip = await screen.findByRole('tooltip');
    expect(tip.style.top).toBe('32px'); // bottom + 8, i.e. rendered underneath
    expect(tip.style.transform).toContain('0');
  });
});
