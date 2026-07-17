import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import Dashboard from '../pages/Dashboard';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { name: 'Testi Tester' } }),
}));

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const trainingPlan = {
  _id: 'tp1',
  scheduledDate: new Date().toISOString(),
  trainingTypeId: 'tt1',
  trainingTypeName: 'Zone 2',
  name: '',
  criteria: null,
  notes: '',
  completed: true,
  autoCompleted: true,
  manualCompleted: false,
  fulfilledBy: { integration: 'strava', id: 'a1', name: 'Morgenlauf', sportType: 'Run', date: new Date().toISOString(), movingTime: 1800, distance: 5200 },
  matchedActivities: [
    { integration: 'strava', id: 'a1', name: 'Morgenlauf', sportType: 'Run', date: new Date().toISOString(), movingTime: 1800, distance: 5200 },
  ],
};

function useHandlers({ trainings = [trainingPlan], activityTotal = 0, stravaTotal = 0 } = {}) {
  server.use(
    http.get('/api/habits/definitions', () => HttpResponse.json([])),
    http.get('/api/habits/logs', () => HttpResponse.json([])),
    http.get('/api/habits/due', () => HttpResponse.json([])),
    http.get('/api/activities', () => HttpResponse.json({ activities: [], total: activityTotal })),
    http.get('/api/strava/activities', () => HttpResponse.json({ activities: [], total: stravaTotal })),
    http.get('/api/planner', () => HttpResponse.json([])),
    http.get('/api/planner/habits', () => HttpResponse.json([])),
    http.get('/api/planner/trainings', () => HttpResponse.json(trainings)),
    http.get('/api/weight', () => HttpResponse.json([])),
    http.get('/api/goals', () => HttpResponse.json([])),
  );
}

describe('Dashboard – planned trainings', () => {
  it('shows planned trainings under "Geplant für heute"', async () => {
    useHandlers();
    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('Zone 2')).toBeInTheDocument());
    expect(screen.getByText('Erfüllt durch: Morgenlauf')).toBeInTheDocument();
    // Counts towards the "Geplant heute" stat
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(screen.queryByText('Heute steht nichts im Planer.')).not.toBeInTheDocument();
  });

  it('shows open trainings as not completed', async () => {
    useHandlers({
      trainings: [{
        ...trainingPlan,
        completed: false,
        autoCompleted: false,
        fulfilledBy: null,
        matchedActivities: [],
      }],
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('Zone 2')).toBeInTheDocument());
    expect(screen.getByText('0/1')).toBeInTheDocument();
    expect(screen.queryByText('Erledigt')).not.toBeInTheDocument();
  });

  it('counts integration activities into the weekly stat', async () => {
    useHandlers({ activityTotal: 3, stravaTotal: 2 });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());
    expect(screen.getByText('Aktivitäten · 2 aus Strava')).toBeInTheDocument();
  });

  it('keeps working when the trainings endpoint fails', async () => {
    useHandlers();
    server.use(
      http.get('/api/planner/trainings', () => HttpResponse.json({ error: 'kaputt' }, { status: 500 })),
    );
    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('Heute steht nichts im Planer.')).toBeInTheDocument());
  });
});
