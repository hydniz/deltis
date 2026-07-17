import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import Planner from '../pages/Planner';

// Fixed "now" (a Wednesday) so the visible week is deterministic.
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

// Morning run on Wednesday (start_date_local carries the local wall time).
const stravaActivities = [
  {
    _id: 'sa1',
    stravaId: 99,
    name: 'Morgenlauf am Fluss',
    sportType: 'Run',
    startDate: '2026-07-15T05:00:00.000Z',
    startDateLocal: '2026-07-15T07:00:00.000Z',
    movingTime: 1800,
    distance: 5200,
  },
];

function useHandlers({ strava = stravaActivities } = {}) {
  server.use(
    http.get('/api/planner', () => HttpResponse.json([])),
    http.get('/api/planner/habits', () => HttpResponse.json([])),
    http.get('/api/activity-types', () => HttpResponse.json([])),
    http.get('/api/habits/definitions', () => HttpResponse.json([])),
    http.get('/api/strava/activities', () => HttpResponse.json({ activities: strava, total: strava.length })),
  );
}

describe('Planner – Strava activities', () => {
  it('shows synced Strava activities on their local day, marked as Strava', async () => {
    useHandlers();
    render(<Planner />);

    await waitFor(() => expect(screen.getByText('Morgenlauf am Fluss')).toBeInTheDocument());
    expect(screen.getByText('Strava')).toBeInTheDocument();
    expect(screen.getByTitle('Von Strava synchronisiert')).toBeInTheDocument();
    expect(screen.getByText('Run · 30 min · 5.2 km')).toBeInTheDocument();
  });

  it('does not count Strava activities towards the weekly plan progress', async () => {
    useHandlers();
    render(<Planner />);

    await waitFor(() => expect(screen.getByText('Morgenlauf am Fluss')).toBeInTheDocument());
    // No plans exist — progress must still read "nothing planned".
    expect(screen.getByText('Noch nichts geplant')).toBeInTheDocument();
  });

  it('requests the visible week with a buffer and keeps working without Strava', async () => {
    let requestedParams = null;
    server.use(
      http.get('/api/planner', () => HttpResponse.json([])),
      http.get('/api/planner/habits', () => HttpResponse.json([])),
      http.get('/api/activity-types', () => HttpResponse.json([])),
      http.get('/api/habits/definitions', () => HttpResponse.json([])),
      http.get('/api/strava/activities', ({ request }) => {
        const url = new URL(request.url);
        requestedParams = Object.fromEntries(url.searchParams);
        return HttpResponse.json({ error: 'nicht verbunden' }, { status: 500 });
      }),
    );
    render(<Planner />);

    // Week 2026-07-13 (Mon) – 2026-07-19 (Sun); buffer of one day either side
    await waitFor(() => expect(requestedParams).not.toBeNull());
    expect(requestedParams.startDate).toBe('2026-07-12');
    expect(requestedParams.endDate).toBe('2026-07-21');

    // The failed Strava fetch must not break the planner itself.
    await waitFor(() => expect(screen.getAllByText('Frei').length).toBeGreaterThan(0));
  });
});
