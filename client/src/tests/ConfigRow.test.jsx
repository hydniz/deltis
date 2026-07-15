import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfigRow from '../components/admin/ConfigRow';

// Shape of one entry as GET /api/admin/config returns it.
const entry = (over = {}) => ({
  key: 'PORT',
  label: 'Server-Port',
  group: 'Server',
  description: 'Port auf dem der Server läuft.',
  type: 'number',
  editable: true,
  source: 'default',
  hasValue: true,
  value: '3001',
  ...over,
});

const renderRow = (over = {}) => {
  const onSave = vi.fn();
  const onReset = vi.fn();
  render(<ConfigRow entry={entry(over)} onSave={onSave} onReset={onReset} />);
  return { onSave, onReset };
};

describe('ConfigRow value display', () => {
  // Regression: values coming from .env used to be blanked out, so a port set
  // in .env showed up as an empty row with no explanation.
  it('shows a value that comes from .env instead of blanking it', () => {
    renderRow({ source: 'env', value: '3001' });
    expect(screen.getByText('3001')).toBeInTheDocument();
    expect(screen.getByText(/gesperrt/)).toBeInTheDocument();
  });

  it('does not offer editing for an env-locked value', () => {
    renderRow({ source: 'env' });
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('marks a key with no value at all as not set', () => {
    renderRow({ hasValue: false, value: null });
    expect(screen.getByText('Nicht gesetzt')).toBeInTheDocument();
  });

  describe('withheld secret', () => {
    const secret = { key: 'JWT_SECRET', label: 'JWT Secret', type: 'password', value: null, hasValue: true };

    it('reports it as set without revealing anything', () => {
      renderRow(secret);
      expect(screen.getByText('••••••••')).toBeInTheDocument();
      expect(screen.getByText(/nie angezeigt/)).toBeInTheDocument();
    });

    // The toggle could only ever uncover a dash – offering it looks broken.
    it('offers no reveal toggle', () => {
      renderRow(secret);
      expect(screen.queryByRole('button', { name: 'Anzeigen' })).not.toBeInTheDocument();
    });
  });

  describe('masked credentials', () => {
    const uri = {
      key: 'MONGODB_URI',
      label: 'MongoDB URI',
      type: 'password',
      editable: false,
      bootstrap: true,
      value: 'mongodb://***:***@db.local:27017/habit_tracker',
      masked: true,
      hasValue: true,
    };

    it('reveals only the redacted value', async () => {
      const user = userEvent.setup();
      renderRow(uri);
      expect(screen.getByText('••••••••')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Anzeigen' }));
      expect(screen.getByText('mongodb://***:***@db.local:27017/habit_tracker')).toBeInTheDocument();
      expect(screen.getByText(/Zugangsdaten maskiert/)).toBeInTheDocument();
    });

    // Prefilling would write the literal '***:***' back as the URI.
    it('starts the edit draft empty and says why', async () => {
      const user = userEvent.setup();
      renderRow(uri);
      await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));

      expect(screen.getByRole('textbox')).toHaveValue('');
      expect(screen.getByText(/vollständig neu eingeben/)).toBeInTheDocument();
    });

    it('keeps a bootstrap key editable through its dedicated route', async () => {
      const user = userEvent.setup();
      renderRow({ ...uri, source: 'file' });
      await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
      expect(screen.getByText(/deltis.config.json/)).toBeInTheDocument();
    });
  });

  it('prefills the edit draft for an ordinary value', async () => {
    const user = userEvent.setup();
    renderRow({ source: 'db', value: '8080' });
    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    expect(screen.getByRole('spinbutton')).toHaveValue(8080);
  });
});

describe('ConfigRow help', () => {
  it('offers help for a known key', () => {
    renderRow();
    expect(screen.getByRole('button', { name: 'Hilfe: Server-Port' })).toBeInTheDocument();
  });

  it('renders without help for a key that has none', () => {
    renderRow({ key: 'SOMETHING_NEW', label: 'Neu' });
    expect(screen.queryByRole('button', { name: /^Hilfe:/ })).not.toBeInTheDocument();
    expect(screen.getByText('Neu')).toBeInTheDocument();
  });

  it('explains the setting in detail on click', async () => {
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole('button', { name: 'Hilfe: Server-Port' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Der TCP-Port');
  });
});
