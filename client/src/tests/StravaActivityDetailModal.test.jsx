import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import StravaActivityDetailModal from '../components/StravaActivityDetailModal';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const detailedActivity = {
  _id: 'a1',
  stravaId: 42,
  name: 'Morgenlauf am Fluss',
  sportType: 'Run',
  startDate: '2026-07-15T05:00:00.000Z',
  startDateLocal: '2026-07-15T07:00:00.000Z',
  movingTime: 1800,
  elapsedTime: 1900,
  distance: 5200,
  totalElevationGain: 42,
  averageSpeed: 2.89,
  averageHeartrate: 148.3,
  maxHeartrate: 171,
  calories: 350,
  sufferScore: 40,
  detail: { id: 42, description: 'Locker gelaufen.' },
  zones: [{
    type: 'heartrate',
    distribution_buckets: [
      { min: 0, max: 120, time: 120 },
      { min: 120, max: 145, time: 1200 },
      { min: 145, max: 160, time: 300 },
      { min: 160, max: 175, time: 150 },
      { min: 175, max: -1, time: 30 },
    ],
  }],
  streams: {
    time: { data: [0, 60, 120, 180] },
    heartrate: { data: [120, 140, 150, 145] },
    velocity_smooth: { data: [2.5, 2.9, 3.0, 2.8] },
    altitude: { data: [310, 312, 315, 311] },
  },
};

describe('StravaActivityDetailModal', () => {
  it('loads the full activity with streams and shows all key metrics', async () => {
    let requestedUrl = null;
    server.use(
      http.get('/api/strava/activities/a1', ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json(detailedActivity);
      })
    );
    render(<StravaActivityDetailModal activityId="a1" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('Morgenlauf am Fluss')).toBeInTheDocument());
    expect(requestedUrl).toContain('streams=1');

    expect(screen.getByText('5.20 km')).toBeInTheDocument();
    expect(screen.getByText('30:00 min')).toBeInTheDocument();
    expect(screen.getByText('148 bpm')).toBeInTheDocument();
    // Run → pace instead of km/h (2.89 m/s ≈ 5:46 /km)
    expect(screen.getByText('5:46 /km')).toBeInTheDocument();
    expect(screen.getByText('350 kcal')).toBeInTheDocument();
    expect(screen.getByText('Locker gelaufen.')).toBeInTheDocument();
    expect(screen.getByText('Powered by Strava')).toBeInTheDocument();
  });

  it('renders the heart-rate zone distribution with percentages', async () => {
    server.use(http.get('/api/strava/activities/a1', () => HttpResponse.json(detailedActivity)));
    render(<StravaActivityDetailModal activityId="a1" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('Zeit in Herzfrequenz-Zonen')).toBeInTheDocument());
    expect(screen.getByText('Z2')).toBeInTheDocument();
    // Zone 2: 1200 of 1800 s = 67 %
    expect(screen.getByText(/67 %/)).toBeInTheDocument();
    // Chart section headings exist for the recorded streams
    expect(screen.getByText('Herzfrequenz')).toBeInTheDocument();
    expect(screen.getByText('Geschwindigkeit')).toBeInTheDocument();
    expect(screen.getByText('Höhenprofil')).toBeInTheDocument();
  });

  it('handles activities without streams gracefully', async () => {
    server.use(
      http.get('/api/strava/activities/a1', () =>
        HttpResponse.json({ ...detailedActivity, streams: null, zones: null })
      )
    );
    render(<StravaActivityDetailModal activityId="a1" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('Morgenlauf am Fluss')).toBeInTheDocument());
    expect(screen.getByText(/keine Verlaufsdaten/)).toBeInTheDocument();
  });
});
