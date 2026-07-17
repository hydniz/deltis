import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import ManageHabitsModal from '../components/ManageHabitsModal';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const defs = [
  {
    _id: 'h1', name: 'Wasser', unitSymbol: 'ml', type: 'amount',
    selected: true, hidden: false, deletedAt: null,
    scheduleDays: [], scheduleDate: null, missingDayMode: 'none',
    defaultValue: 0, targetCondition: 'none', targetValue: 0,
  },
  {
    _id: 'h2', name: 'Vitamine', unitSymbol: '✓', type: 'boolean',
    selected: false, hidden: false, deletedAt: null,
    scheduleDays: [], scheduleDate: null, missingDayMode: 'none',
    defaultValue: 0, targetCondition: 'none', targetValue: 0,
  },
  {
    _id: 'h3', name: 'Rauchen', unitSymbol: 'Stück', type: 'amount',
    selected: false, hidden: true, deletedAt: '2026-07-01T00:00:00.000Z',
    scheduleDays: [], scheduleDate: null, missingDayMode: 'none',
    defaultValue: 0, targetCondition: 'none', targetValue: 0,
  },
];

function useHandlers() {
  server.use(
    http.get('/api/habits/definitions', () => HttpResponse.json(defs)),
    http.get('/api/activity-types', () => HttpResponse.json([{ _id: 'at1', label: 'Joggen' }])),
    http.get('/api/training-types', () => HttpResponse.json([{ _id: 'tt1', name: 'Zone 2' }])),
  );
}

function renderModal(props = {}) {
  return render(<ManageHabitsModal onSave={() => {}} onClose={() => {}} {...props} />);
}

describe('ManageHabitsModal', () => {
  it('shows one unified list and a collapsed trash instead of sections', async () => {
    useHandlers();
    renderModal();

    await waitFor(() => expect(screen.getByText('Wasser')).toBeInTheDocument());
    expect(screen.getByText('Vitamine')).toBeInTheDocument();
    // No predefined/custom split anymore
    expect(screen.queryByText('Voreingestellt')).not.toBeInTheDocument();
    expect(screen.queryByText('Eigene')).not.toBeInTheDocument();
    // Deleted habit sits in the collapsed trash, not in an open list
    expect(screen.queryByText('Rauchen')).not.toBeInTheDocument();
    expect(screen.getByText('Papierkorb (1)')).toBeInTheDocument();
  });

  it('expands the trash and restores a habit from it', async () => {
    useHandlers();
    let restored = null;
    server.use(
      http.post('/api/habits/definitions/:id/restore', ({ params }) => {
        restored = params.id;
        return HttpResponse.json({ success: true });
      })
    );
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByText('Papierkorb (1)'));
    expect(screen.getByText('Rauchen')).toBeInTheDocument();

    await user.click(screen.getByText('Wiederherstellen'));
    await waitFor(() => expect(restored).toBe('h3'));
    // Back in the active list, trash disappears
    await waitFor(() => expect(screen.queryByText('Papierkorb (1)')).not.toBeInTheDocument());
  });

  it('creates a habit with inline schedule settings in one go', async () => {
    useHandlers();
    let posted = null;
    server.use(
      http.post('/api/habits/definitions', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ _id: 'new1', ...posted }, { status: 201 });
      })
    );
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByText('Neue Gewohnheit hinzufügen'));
    await user.type(screen.getByPlaceholderText(/Vitamine, Stretching/), 'Lesen');
    await user.type(screen.getByPlaceholderText('z.B. min, ml, Stück'), 'min');
    // Schedule fields are right in the create form
    await user.click(screen.getByText('Wochentage'));
    await user.click(screen.getByRole('button', { name: 'Mo' }));
    await user.click(screen.getByRole('button', { name: 'Hinzufügen' }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted.name).toBe('Lesen');
    expect(posted.scheduleDays).toEqual([1]);
  });

  it('offers yes/no instead of a number as boolean default value', async () => {
    useHandlers();
    const user = userEvent.setup();
    renderModal();

    await waitFor(() => expect(screen.getByText('Vitamine')).toBeInTheDocument());
    // Open the boolean habit's settings
    await user.click(screen.getAllByLabelText('Einstellungen')[1]);
    // No numeric day target for yes/no habits
    expect(screen.queryByText('Tagesziel')).not.toBeInTheDocument();

    await user.selectOptions(
      screen.getByDisplayValue('Nicht eingetragen = kein Wert'),
      'default'
    );
    // The default value is a yes/no choice, not a number input
    expect(screen.getByText('Nein – nicht gemacht')).toBeInTheDocument();
    expect(screen.getByText('Ja – gemacht')).toBeInTheDocument();
  });

  it('saves an interval schedule ("alle N Tage")', async () => {
    useHandlers();
    let putBody = null;
    server.use(
      http.put('/api/habits/definitions/:id', () => HttpResponse.json({})),
      http.put('/api/habits/settings/:id', async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json({ success: true });
      })
    );
    const user = userEvent.setup();
    renderModal();

    await waitFor(() => expect(screen.getByText('Wasser')).toBeInTheDocument());
    await user.click(screen.getAllByLabelText('Einstellungen')[0]);
    await user.click(screen.getByText('Intervall'));
    const nInput = screen.getByPlaceholderText('3');
    await user.clear(nInput);
    await user.type(nInput, '4');
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));

    await waitFor(() => expect(putBody).not.toBeNull());
    expect(putBody.scheduleMode).toBe('interval');
    expect(putBody.scheduleIntervalDays).toBe(4);
    expect(putBody.scheduleAnchorDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('saves an event-trigger schedule ("nach Strava-Sportart")', async () => {
    useHandlers();
    let putBody = null;
    server.use(
      http.put('/api/habits/definitions/:id', () => HttpResponse.json({})),
      http.put('/api/habits/settings/:id', async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json({ success: true });
      })
    );
    const user = userEvent.setup();
    renderModal();

    await waitFor(() => expect(screen.getByText('Wasser')).toBeInTheDocument());
    await user.click(screen.getAllByLabelText('Einstellungen')[0]);
    await user.click(screen.getByText('Nach Ereignis'));
    await user.selectOptions(screen.getByDisplayValue('Gewohnheit'), 'stravaSport');
    const offset = screen.getByDisplayValue('0');
    await user.clear(offset);
    await user.type(offset, '2');
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));

    await waitFor(() => expect(putBody).not.toBeNull());
    expect(putBody.scheduleMode).toBe('trigger');
    expect(putBody.scheduleTrigger).toMatchObject({
      kind: 'stravaSport', sport: 'Run', direction: 'after', offsetDays: 2,
    });
  });

  it('warns about consequences when the type changes', async () => {
    useHandlers();
    const user = userEvent.setup();
    renderModal();

    await waitFor(() => expect(screen.getByText('Wasser')).toBeInTheDocument());
    await user.click(screen.getAllByLabelText('Einstellungen')[0]);
    await user.selectOptions(screen.getByDisplayValue('Menge'), 'boolean');

    expect(screen.getByText(/Typwechsel/)).toBeInTheDocument();
    expect(screen.getByText(/jeder Wert größer 0/)).toBeInTheDocument();
  });
});
