import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import GoalHeatmap from '../components/GoalHeatmap';

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

const goal = { _id: 'g1', name: 'Laufziel', type: 'periodic-activity' };

describe('GoalHeatmap', () => {
  it('renders per-day contributions with unit labels', async () => {
    server.use(
      http.get('/api/goals/g1/heatmap', () => HttpResponse.json({
        metric: 'distance',
        unitSymbol: 'km',
        days: { '2026-07-14': 5, '2026-07-15': 10 },
      })),
    );
    render(<GoalHeatmap goal={goal} />);

    await waitFor(() => expect(screen.getByTitle('14. Juli: 5 km')).toBeInTheDocument());
    expect(screen.getByTitle('15. Juli: 10 km')).toBeInTheDocument();
    // A day without contribution
    expect(screen.getByTitle('13. Juli: kein Beitrag')).toBeInTheDocument();
    expect(screen.getByText('Letzte 16 Wochen')).toBeInTheDocument();
  });

  it('renders one tile per interval for periodic goals with gradations', async () => {
    server.use(
      http.get('/api/goals/g1/heatmap', () => HttpResponse.json({
        kind: 'intervals',
        intervalValue: 1,
        intervalUnit: 'week',
        metric: 'count',
        unitSymbol: 'Mal',
        intervals: [
          // Local timestamps (no Z) keep the rendered dates timezone-stable
          { start: '2026-07-06T00:00:00.000', end: '2026-07-12T23:59:59.999', value: 1, targetValue: 2, condition: 'min', met: false, current: false },
          { start: '2026-07-13T00:00:00.000', end: '2026-07-15T23:59:59.999', value: 2, targetValue: 2, condition: 'min', met: true, current: true },
        ],
      })),
    );
    render(<GoalHeatmap goal={goal} />);

    await waitFor(() => expect(screen.getByText('Ein Feld = Woche')).toBeInTheDocument());
    expect(screen.getByTitle('6. Juli – 12. Juli: 1 / 2 Mal – nicht erreicht')).toBeInTheDocument();
    expect(screen.getByTitle('13. Juli – 15. Juli: 2 / 2 Mal – erreicht (läuft noch)')).toBeInTheDocument();
  });

  it('survives a failing endpoint with an empty grid', async () => {
    server.use(
      http.get('/api/goals/g1/heatmap', () => HttpResponse.json({ error: 'kaputt' }, { status: 500 })),
    );
    render(<GoalHeatmap goal={goal} />);

    await waitFor(() => expect(screen.getByTitle('15. Juli: kein Beitrag')).toBeInTheDocument());
  });
});
