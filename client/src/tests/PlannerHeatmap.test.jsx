import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import PlannerHeatmap from '../components/PlannerHeatmap';

// Fixed "now" (a Wednesday) so the 12-week grid layout is deterministic.
// Only Date is faked — real timers keep userEvent/waitFor working.
const FIXED_NOW = new Date('2026-07-15T10:00:00');

// Monday 13.07.: two open activities (0/2 → dimmest level)
// Tuesday 14.07.: one done activity + one open habit (1/2 → level 1)
// Monday 06.07.: three habits, two done (2/3 → level 2)
// Monday 01.06.: one done habit (1/1 → full colour)
const activityPlans = [
  { _id: 'ap1', activityType: 'Joggen', scheduledDate: '2026-07-13T00:00:00.000Z', completed: false },
  { _id: 'ap2', activityType: 'Joggen', scheduledDate: '2026-07-13T00:00:00.000Z', completed: false },
  { _id: 'ap3', activityType: 'Joggen', scheduledDate: '2026-07-14T00:00:00.000Z', completed: true },
];

const habitPlans = [
  { _id: 'hp1', habitName: 'Wasser trinken', scheduledDate: '2026-07-14T00:00:00.000Z', completed: false },
  { _id: 'hp2', habitName: 'Wasser trinken', scheduledDate: '2026-07-06T00:00:00.000Z', completed: true },
  { _id: 'hp3', habitName: 'Wasser trinken', scheduledDate: '2026-07-06T00:00:00.000Z', completed: true },
  { _id: 'hp4', habitName: 'Wasser trinken', scheduledDate: '2026-07-06T00:00:00.000Z', completed: false },
  { _id: 'hp5', habitName: 'Wasser trinken', scheduledDate: '2026-06-01T00:00:00.000Z', completed: true },
];

function useHeatmapHandlers() {
  server.use(
    http.get('/api/planner', () => HttpResponse.json(activityPlans)),
    http.get('/api/planner/habits', () => HttpResponse.json(habitPlans)),
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

describe('PlannerHeatmap – Laden und Aggregation', () => {
  it('zeigt erst einen Loader, dann das Raster mit Tages-Tooltips', async () => {
    useHeatmapHandlers();
    render(<PlannerHeatmap />);

    expect(screen.queryByLabelText('Planungsverlauf der letzten 12 Wochen')).toBeNull();

    expect(await screen.findByLabelText('Planungsverlauf der letzten 12 Wochen')).toBeInTheDocument();
    expect(screen.getByText('Planungsverlauf')).toBeInTheDocument();
    expect(screen.getByText('Erledigte Pläne der letzten 12 Wochen')).toBeInTheDocument();

    expect(screen.getByTitle('13. Juli: 0 von 2 erledigt')).toBeInTheDocument();
    expect(screen.getByTitle('14. Juli: 1 von 2 erledigt')).toBeInTheDocument();
    expect(screen.getByTitle('6. Juli: 2 von 3 erledigt')).toBeInTheDocument();
    expect(screen.getByTitle('1. Juni: 1 von 1 erledigt')).toBeInTheDocument();
    // A past day without plans
    expect(screen.getByTitle('15. Juni: keine Pläne')).toBeInTheDocument();
  });

  it('färbt Zellen nach Erledigungsquote ein', async () => {
    useHeatmapHandlers();
    render(<PlannerHeatmap />);
    await screen.findByLabelText('Planungsverlauf der letzten 12 Wochen');

    expect(screen.getByTitle('13. Juli: 0 von 2 erledigt').className).toContain('bg-brand-500/25');
    expect(screen.getByTitle('14. Juli: 1 von 2 erledigt').className).toContain('bg-brand-500/45');
    expect(screen.getByTitle('6. Juli: 2 von 3 erledigt').className).toContain('bg-brand-500/70');
    expect(screen.getByTitle('1. Juni: 1 von 1 erledigt').className).not.toContain('/');
    expect(screen.getByTitle('15. Juni: keine Pläne').className).toContain('bg-ink-900/[.07]');
  });

  it('fragt die Pläne für das volle 12-Wochen-Fenster ab', async () => {
    const ranges = [];
    server.use(
      http.get('/api/planner', ({ request }) => {
        const url = new URL(request.url);
        ranges.push({ startDate: url.searchParams.get('startDate'), endDate: url.searchParams.get('endDate') });
        return HttpResponse.json([]);
      }),
      http.get('/api/planner/habits', () => HttpResponse.json([])),
    );
    render(<PlannerHeatmap />);
    await screen.findByLabelText('Planungsverlauf der letzten 12 Wochen');

    // Monday 11 weeks before the current week up to today
    expect(ranges).toEqual([{ startDate: '2026-04-27', endDate: '2026-07-15' }]);
  });

  it('hält zukünftige Tage unsichtbar und zeigt die Legende', async () => {
    useHeatmapHandlers();
    const { container } = render(<PlannerHeatmap />);
    await screen.findByLabelText('Planungsverlauf der letzten 12 Wochen');

    // Wednesday 15.07. is "today" — Thu to Sun of the current week stay invisible
    expect(container.querySelectorAll('.opacity-0').length).toBe(4);
    expect(screen.getByText('Weniger')).toBeInTheDocument();
    expect(screen.getByText('Mehr')).toBeInTheDocument();
  });
});

describe('PlannerHeatmap – Filter', () => {
  it('filtert nach Aktivitäten und Gewohnheiten', async () => {
    useHeatmapHandlers();
    const user = userEvent.setup();
    render(<PlannerHeatmap />);
    await screen.findByLabelText('Planungsverlauf der letzten 12 Wochen');

    await user.click(screen.getByRole('button', { name: 'Aktivitäten' }));
    expect(screen.getByTitle('14. Juli: 1 von 1 erledigt')).toBeInTheDocument();
    expect(screen.getByTitle('1. Juni: keine Pläne')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Gewohnheiten' }));
    expect(screen.getByTitle('14. Juli: 0 von 1 erledigt')).toBeInTheDocument();
    expect(screen.getByTitle('13. Juli: keine Pläne')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Alle' }));
    expect(screen.getByTitle('14. Juli: 1 von 2 erledigt')).toBeInTheDocument();
  });
});

describe('PlannerHeatmap – Fehlerfall', () => {
  it('zeigt bei einem API-Fehler ein leeres Raster', async () => {
    server.use(
      http.get('/api/planner', () => HttpResponse.json({ error: 'kaputt' }, { status: 500 })),
      http.get('/api/planner/habits', () => HttpResponse.json([])),
    );
    render(<PlannerHeatmap />);
    await screen.findByLabelText('Planungsverlauf der letzten 12 Wochen');

    expect(screen.getByTitle('13. Juli: keine Pläne')).toBeInTheDocument();
    expect(screen.queryByTitle(/erledigt/)).toBeNull();
  });
});
