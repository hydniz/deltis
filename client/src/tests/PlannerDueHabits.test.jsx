import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import Planner from '../pages/Planner';

const FIXED_NOW = new Date('2026-07-15T10:00:00');

beforeAll(() => server.listen());
beforeEach(() => {
  vi.useFakeTimers({ now: FIXED_NOW, toFake: ['Date'] });
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  server.resetHandlers();
  localStorage.clear();
});
afterAll(() => server.close());

const dueEntries = [
  {
    date: '2026-07-15', habitId: 'h1', name: 'Blackroll', unitSymbol: 'min', type: 'duration',
    targetCondition: 'none', targetValue: 0, logged: false, loggedValue: null,
    reason: {
      kind: 'trigger', direction: 'after', offsetDays: 2,
      sourceKind: 'stravaSport', sourceName: 'Run', sourceDate: '2026-07-13',
    },
  },
  {
    date: '2026-07-16', habitId: 'h2', name: 'Vitamine', unitSymbol: '✓', type: 'boolean',
    targetCondition: 'none', targetValue: 0, logged: false, loggedValue: null,
    reason: { kind: 'interval', intervalDays: 3, anchorDate: '2026-07-10' },
  },
];

function useHandlers({ due = dueEntries } = {}) {
  server.use(
    http.get('/api/planner', () => HttpResponse.json([])),
    http.get('/api/planner/habits', () => HttpResponse.json([])),
    http.get('/api/activity-types', () => HttpResponse.json([])),
    http.get('/api/habits/definitions', () => HttpResponse.json([])),
    http.get('/api/planner/trainings', () => HttpResponse.json([])),
    http.get('/api/training-types', () => HttpResponse.json([])),
    http.get('/api/strava/activities', () => HttpResponse.json({ activities: [] })),
    http.get('/api/habits/due', () => HttpResponse.json(due)),
  );
}

describe('Planner – due habits', () => {
  it('shows due habits as implicit entries on their day', async () => {
    useHandlers();
    render(<Planner />);

    await waitFor(() => expect(screen.getByText('Blackroll')).toBeInTheDocument());
    expect(screen.getByText('Vitamine')).toBeInTheDocument();
    expect(screen.getByText('Fällig durch Ereignis')).toBeInTheDocument();
    expect(screen.getAllByText('Fällig laut Zeitplan').length).toBeGreaterThan(0);
    // Implicit entries do not count towards the plan progress
    expect(screen.getByText('Noch nichts geplant')).toBeInTheDocument();
  });

  it('explains WHY a habit is due when clicked', async () => {
    useHandlers();
    const user = userEvent.setup();
    render(<Planner />);

    await user.click(await screen.findByText('Blackroll'));
    expect(await screen.findByText('Warum steht das hier?')).toBeInTheDocument();
    expect(screen.getByText(/Weil am 13\. Juli „Run“ gemacht wurde \(2 Tage danach\)/)).toBeInTheDocument();
  });

  it('ticks boolean habits directly from the card', async () => {
    useHandlers();
    let posted = null;
    server.use(
      http.post('/api/habits/logs', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ _id: 'log1' }, { status: 201 });
      })
    );
    const user = userEvent.setup();
    render(<Planner />);

    await screen.findByText('Vitamine');
    const card = screen.getByText('Vitamine').closest('[role="button"]');
    await user.click(card.querySelector('button[title="Erledigt"]'));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({ habitId: 'h2', value: 1 });
    expect(posted.date.startsWith('2026-07-16')).toBe(true);
  });

  it('hides due habits when their filter is off and persists the choice', async () => {
    useHandlers();
    const user = userEvent.setup();
    render(<Planner />);

    await screen.findByText('Blackroll');
    await user.click(screen.getByRole('button', { name: 'Fällige Gewohnheiten' }));

    expect(screen.queryByText('Blackroll')).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('deltis.plannerFilters')).due).toBe(false);
  });
});
