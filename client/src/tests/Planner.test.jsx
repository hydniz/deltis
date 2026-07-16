import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import Planner from '../pages/Planner';

// Fixed "now" (a Wednesday) so week layout, overdue marking and copy-week
// payloads are deterministic. Only Date is faked — real timers keep
// userEvent/waitFor working.
const FIXED_NOW = new Date('2026-07-15T10:00:00');

const activityTypes = [
  { _id: 'at1', label: 'Joggen', version: 1, showDuration: true, showDistance: false, customFields: [] },
];

const habitDefinitions = [
  { _id: 'h1', name: 'Wasser trinken', type: 'amount', unitSymbol: 'ml', selected: true },
];

// Monday plan is open and in the past (overdue), Wednesday plan is completed.
const weekActivityPlans = [
  { _id: 'ap1', activityType: 'Joggen', scheduledDate: '2026-07-13T00:00:00.000Z', completed: false, duration: 30 },
  { _id: 'ap2', activityType: 'Joggen', scheduledDate: '2026-07-15T00:00:00.000Z', completed: true },
];

const weekHabitPlans = [
  {
    _id: 'hp1',
    habitId: { _id: 'h1', name: 'Wasser trinken' },
    habitName: 'Wasser trinken',
    habitType: 'amount',
    unitSymbol: 'ml',
    scheduledDate: '2026-07-16T00:00:00.000Z',
    completed: false,
  },
];

function usePlannerHandlers() {
  server.use(
    http.get('/api/planner', () => HttpResponse.json(weekActivityPlans)),
    http.get('/api/planner/habits', () => HttpResponse.json(weekHabitPlans)),
    http.get('/api/activity-types', () => HttpResponse.json(activityTypes)),
    http.get('/api/habits/definitions', () => HttpResponse.json(habitDefinitions)),
  );
}

beforeAll(() => {
  server.listen();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_NOW);
});
afterEach(() => server.resetHandlers());
afterAll(() => {
  vi.useRealTimers();
  server.close();
});

describe('Planner – Wochenübersicht', () => {
  it('zeigt Pläne der Woche und den Wochenfortschritt', async () => {
    usePlannerHandlers();
    render(<Planner />);

    expect(await screen.findByText('Wasser trinken')).toBeInTheDocument();
    expect(screen.getAllByText('Joggen').length).toBe(2);
    expect(screen.getByText('Wochenfortschritt')).toBeInTheDocument();
    expect(screen.getByText('1 von 3 erledigt')).toBeInTheDocument();
  });

  it('zeigt die Fortschritts-Heatmap unterhalb des Wochen-Rasters', async () => {
    usePlannerHandlers();
    render(<Planner />);
    await screen.findByText('Wasser trinken');

    expect(await screen.findByLabelText('Planungsverlauf der letzten 12 Wochen')).toBeInTheDocument();
    // Week data feeds the heatmap too: Wednesday 15.07. has its completed plan
    expect(screen.getByTitle('15. Juli: 1 von 1 erledigt')).toBeInTheDocument();
  });

  it('zeigt pro Tag ein Erledigt-Badge', async () => {
    usePlannerHandlers();
    render(<Planner />);
    await screen.findByText('Wasser trinken');

    // Wednesday: 1/1 done, Monday and Thursday: 0/1 each
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(screen.getAllByText('0/1').length).toBe(2);
  });

  it('markiert offene Pläne vergangener Tage als überfällig', async () => {
    usePlannerHandlers();
    render(<Planner />);
    await screen.findByText('Wasser trinken');

    // Only the open Monday plan is overdue — not the completed one, not future plans
    expect(screen.getAllByText('Überfällig').length).toBe(1);
  });
});

describe('Planner – Vorwoche kopieren', () => {
  it('kopiert die Vorwoche und zeigt das Ergebnis an', async () => {
    usePlannerHandlers();
    let body;
    server.use(
      http.post('/api/planner/copy-week', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ copiedActivities: 2, copiedHabits: 1, skipped: 0 }, { status: 201 });
      })
    );
    const user = userEvent.setup();
    render(<Planner />);
    await screen.findByText('Wasser trinken');

    await user.click(screen.getByRole('button', { name: /Vorwoche kopieren/i }));

    await waitFor(() =>
      expect(screen.getByText('3 Pläne aus der Vorwoche übernommen.')).toBeInTheDocument()
    );
    expect(body).toEqual({ sourceStart: '2026-07-06', targetStart: '2026-07-13' });
  });

  it('meldet, wenn nichts übernommen wurde', async () => {
    usePlannerHandlers();
    server.use(
      http.post('/api/planner/copy-week', () =>
        HttpResponse.json({ copiedActivities: 0, copiedHabits: 0, skipped: 2 }, { status: 201 })
      )
    );
    const user = userEvent.setup();
    render(<Planner />);
    await screen.findByText('Wasser trinken');

    await user.click(screen.getByRole('button', { name: /Vorwoche kopieren/i }));

    await waitFor(() =>
      expect(
        screen.getByText('Nichts übernommen – die Vorwoche war leer oder alles ist bereits geplant.')
      ).toBeInTheDocument()
    );
  });
});

describe('Planner – Plan für mehrere Tage anlegen', () => {
  it('legt beim Speichern einen Plan pro ausgewähltem Tag an', async () => {
    usePlannerHandlers();
    const posted = [];
    server.use(
      http.post('/api/planner', async ({ request }) => {
        posted.push(await request.json());
        return HttpResponse.json({ _id: `new-${posted.length}` }, { status: 201 });
      })
    );
    const user = userEvent.setup();
    render(<Planner />);
    await screen.findByText('Wasser trinken');

    // Open the add modal on Monday (first day column)
    await user.click(screen.getAllByLabelText('Plan hinzufügen')[0]);
    await screen.findByText('Tage');

    // Monday is preselected — additionally select Wednesday
    await user.click(screen.getByRole('button', { name: 'Mi. 15.' }));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(posted.length).toBe(2));
    expect(posted.map(p => p.scheduledDate).sort()).toEqual(['2026-07-13', '2026-07-15']);
    expect(posted[0].activityType).toBe('Joggen');
  });
});

describe('Planner – Plan bearbeiten', () => {
  it('verschiebt einen Plan über das Bearbeiten-Modal auf einen anderen Tag', async () => {
    usePlannerHandlers();
    let putBody;
    server.use(
      http.put('/api/planner/ap1', async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json({ ...weekActivityPlans[0], ...putBody });
      })
    );
    const user = userEvent.setup();
    render(<Planner />);
    await screen.findByText('Wasser trinken');

    await user.click(screen.getAllByLabelText('Plan bearbeiten')[0]);
    expect(await screen.findByText('Plan bearbeiten')).toBeInTheDocument();

    const dateInput = screen.getByDisplayValue('2026-07-13');
    fireEvent.change(dateInput, { target: { value: '2026-07-14' } });
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(putBody).toBeTruthy());
    expect(putBody.scheduledDate).toBe('2026-07-14');
    expect(putBody.duration).toBe(30);
  });

  it('öffnet das Bearbeiten-Modal auch für Gewohnheitspläne', async () => {
    usePlannerHandlers();
    let putBody;
    server.use(
      http.put('/api/planner/habits/hp1', async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json({ ...weekHabitPlans[0], ...putBody });
      })
    );
    const user = userEvent.setup();
    render(<Planner />);
    await screen.findByText('Wasser trinken');

    // Third edit button belongs to the Thursday habit plan
    await user.click(screen.getAllByLabelText('Plan bearbeiten')[2]);
    expect(await screen.findByText('Plan bearbeiten')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Optional…'), { target: { value: 'Große Flasche' } });
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(putBody).toBeTruthy());
    expect(putBody.notes).toBe('Große Flasche');
    expect(putBody.scheduledDate).toBe('2026-07-16');
  });
});
