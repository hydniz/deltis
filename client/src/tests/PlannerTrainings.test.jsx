import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import Planner from '../pages/Planner';

const FIXED_NOW = new Date('2026-07-15T10:00:00');

beforeAll(() => server.listen());
beforeEach(() => {
  vi.useFakeTimers({ now: FIXED_NOW, toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
  server.resetHandlers();
});
afterAll(() => server.close());

const zone2Type = {
  _id: 'tt1', name: 'Zone 2', description: '',
  criteria: { strava: { operator: 'AND', rules: [{ kind: 'sportType', values: ['Run'] }] } },
};

const fulfilledPlan = {
  _id: 'tp1',
  scheduledDate: '2026-07-15T00:00:00.000Z',
  trainingTypeId: 'tt1',
  trainingTypeName: 'Zone 2',
  criteria: null,
  notes: '',
  completed: true,
  fulfilledBy: {
    integration: 'strava', id: 'a1', name: 'Morgenlauf am Fluss',
    sportType: 'Run', date: '2026-07-15T07:00:00.000Z', movingTime: 1800, distance: 5200,
  },
};

function useHandlers({ trainings = [fulfilledPlan] } = {}) {
  server.use(
    http.get('/api/planner', () => HttpResponse.json([])),
    http.get('/api/planner/habits', () => HttpResponse.json([])),
    http.get('/api/activity-types', () => HttpResponse.json([])),
    http.get('/api/habits/definitions', () => HttpResponse.json([])),
    http.get('/api/training-types', () => HttpResponse.json([zone2Type])),
    http.get('/api/planner/trainings', () => HttpResponse.json(trainings)),
  );
}

describe('Planner – planned trainings', () => {
  it('shows a fulfilled training with the fulfilling activity', async () => {
    useHandlers();
    render(<MemoryRouter><Planner /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('Zone 2')).toBeInTheDocument());
    expect(screen.getByText('Morgenlauf am Fluss')).toBeInTheDocument();
    // Counts towards the weekly plan progress
    expect(screen.getByText('1 von 1 erledigt')).toBeInTheDocument();
  });

  it('marks an unfulfilled past training as overdue', async () => {
    useHandlers({
      trainings: [{
        ...fulfilledPlan,
        scheduledDate: '2026-07-13T00:00:00.000Z', // past Monday
        completed: false,
        fulfilledBy: null,
      }],
    });
    render(<MemoryRouter><Planner /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('Zone 2')).toBeInTheDocument());
    expect(screen.getByText('Überfällig')).toBeInTheDocument();
    expect(screen.getByText('0 von 1 erledigt')).toBeInTheDocument();
  });

  it('renders the custom name and nests matched activities in the card', async () => {
    useHandlers({
      trainings: [{
        ...fulfilledPlan,
        trainingTypeId: null,
        trainingTypeName: null,
        name: 'Intervalle',
        criteria: { strava: { operator: 'AND', rules: [{ kind: 'sportType', values: ['Run'] }] } },
        autoCompleted: true,
        manualCompleted: false,
        matchedActivities: [
          fulfilledPlan.fulfilledBy,
          { integration: 'strava', id: 'a2', name: 'Abendlauf', sportType: 'Run', date: '2026-07-15T18:00:00.000Z', movingTime: 2400, distance: 8000 },
        ],
      }],
    });
    render(<MemoryRouter><Planner /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('Intervalle')).toBeInTheDocument());
    expect(screen.getByText('Morgenlauf am Fluss')).toBeInTheDocument();
    expect(screen.getByText('Abendlauf')).toBeInTheDocument();
  });

  it('opens the detail modal on card click with all matches listed', async () => {
    useHandlers({
      trainings: [{
        ...fulfilledPlan,
        autoCompleted: true,
        manualCompleted: false,
        matchedActivities: [fulfilledPlan.fulfilledBy],
      }],
    });
    const user = userEvent.setup();
    render(<MemoryRouter><Planner /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('Zone 2')).toBeInTheDocument());
    await user.click(screen.getByText('Zone 2'));

    expect(await screen.findByText('Erfüllt durch Aktivität')).toBeInTheDocument();
    expect(screen.getByText('Passende Aktivität')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Als absolviert markieren' })).toBeInTheDocument();
  });

  it('toggles manual completion via the check circle', async () => {
    useHandlers({
      trainings: [{
        ...fulfilledPlan,
        completed: false,
        autoCompleted: false,
        manualCompleted: false,
        fulfilledBy: null,
        matchedActivities: [],
      }],
    });
    let putBody = null;
    server.use(
      http.put('/api/planner/trainings/tp1', async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json({ _id: 'tp1' });
      })
    );
    const user = userEvent.setup();
    render(<MemoryRouter><Planner /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('Zone 2')).toBeInTheDocument());
    await user.click(screen.getByTitle('Als absolviert markieren'));

    await waitFor(() => expect(putBody).not.toBeNull());
    expect(putBody.completed).toBe(true);
  });

  it('plans a training via the add modal using a saved type', async () => {
    useHandlers({ trainings: [] });
    let posted = null;
    server.use(
      http.post('/api/planner/trainings', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ _id: 'new', ...posted }, { status: 201 });
      })
    );
    const user = userEvent.setup();
    render(<MemoryRouter><Planner /></MemoryRouter>);

    await waitFor(() => expect(screen.getAllByLabelText('Plan hinzufügen').length).toBe(7));
    await user.click(screen.getAllByLabelText('Plan hinzufügen')[0]); // Monday
    await user.click(screen.getByRole('button', { name: 'Training' }));

    // Saved type is preselected; submit directly
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({
      scheduledDate: '2026-07-13',
      trainingTypeId: 'tt1',
    });
  });
});
