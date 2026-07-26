import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import Metrics, { formatValue, trendFor } from '../pages/Metrics';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const metric = (over = {}) => ({
  _id: 'm1', key: 'rhr', name: 'Ruhepuls', unit: 'bpm', decimals: 0,
  direction: 'down', color: 'rose', showOnDashboard: false, healthType: 'restingHeartRate',
  latest: { value: 52, date: '2026-05-02T06:00:00Z' }, count: 2, ...over,
});

function mockMetrics(list) {
  server.use(http.get('/api/metrics', () => HttpResponse.json(list)));
}
// The card and the detail modal read the DAY SERIES, not raw readings — an
// interval-backed metric has hundreds of readings per day.
function mockLogs(id, series) {
  server.use(http.get(`/api/metrics/${id}/series`, () =>
    HttpResponse.json({ series, truncated: false })));
}

const renderPage = () => render(<MemoryRouter><Metrics /></MemoryRouter>);

describe('formatValue', () => {
  it('formats to the given precision and handles nullish', () => {
    expect(formatValue(52, 0)).toBe('52');
    expect(formatValue(16.25, 1)).toBe('16,3');
    expect(formatValue(null)).toBe('–');
    expect(formatValue(Infinity)).toBe('–');
  });
});

describe('trendFor', () => {
  const logs = [
    { date: '2026-05-01T06:00:00Z', value: 55 },
    { date: '2026-05-02T06:00:00Z', value: 52 },
  ];
  it('marks a fall as good when lower is better', () => {
    const t = trendFor(logs, 'down');
    expect(t.icon).toBe('down');
    expect(t.good).toBe(true);
  });
  it('marks a fall as bad when higher is better', () => {
    expect(trendFor(logs, 'up').good).toBe(false);
  });
  it('is neutral for direction none', () => {
    expect(trendFor(logs, 'none').good).toBeNull();
  });
  it('flat with fewer than two points or equal values', () => {
    expect(trendFor([logs[0]], 'down').icon).toBe('flat');
    expect(trendFor([{ date: '1', value: 5 }, { date: '2', value: 5 }], 'up').icon).toBe('flat');
  });
});

describe('Metrics page', () => {
  it('shows an empty state with no metrics', async () => {
    renderPage();
    expect(await screen.findByText('Noch keine Messwerte')).toBeInTheDocument();
  });

  it('renders a card per metric with its current value and trend', async () => {
    mockMetrics([metric()]);
    mockLogs('m1', [
      { _id: 'l1', date: '2026-05-01T06:00:00Z', value: 55 },
      { _id: 'l2', date: '2026-05-02T06:00:00Z', value: 52 },
    ]);
    renderPage();

    const card = await screen.findByTestId('metric-card');
    expect(within(card).getByText('Ruhepuls')).toBeInTheDocument();
    expect(within(card).getByText('52')).toBeInTheDocument();
    await waitFor(() => expect(card).toHaveTextContent('2 Tage'));
  });

  it('adds a reading and refreshes', async () => {
    mockMetrics([metric()]);
    let series = [{ date: '2026-05-02T06:00:00Z', value: 52 }];
    server.use(
      http.get('/api/metrics/m1/series', () => HttpResponse.json({ series, truncated: false })),
      http.post('/api/metrics/m1/logs', async ({ request }) => {
        const body = await request.json();
        series = [...series, { date: new Date().toISOString(), value: body.value }];
        return HttpResponse.json(series[series.length - 1], { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('metric-card');
    await user.type(within(card).getByLabelText('Ruhepuls eintragen'), '50');
    await user.click(within(card).getByRole('button', { name: /Eintragen/ }));

    await waitFor(() => expect(card).toHaveTextContent('2 Tage'));
  });

  it('surfaces a save error from the server', async () => {
    mockMetrics([metric({ min: 20, max: 200 })]);
    mockLogs('m1', []);
    server.use(http.post('/api/metrics/m1/logs', () =>
      HttpResponse.json({ error: 'Wert über dem Maximum (200).' }, { status: 400 })));
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('metric-card');
    await user.type(within(card).getByLabelText('Ruhepuls eintragen'), '999');
    await user.click(within(card).getByRole('button', { name: /Eintragen/ }));
    expect(await within(card).findByText(/über dem Maximum/)).toBeInTheDocument();
  });

  const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();

  it('flags how old the shown value is (heute vs. a stale pill)', async () => {
    mockMetrics([
      metric({ _id: 'm1', name: 'Heute-Wert', latest: { value: 52, date: iso(0) } }),
      metric({ _id: 'm2', name: 'Alt-Wert', latest: { value: 60, date: iso(3) } }),
    ]);
    mockLogs('m1', [{ _id: 'a', date: iso(1), value: 55 }, { _id: 'b', date: iso(0), value: 52 }]);
    mockLogs('m2', [{ _id: 'c', date: iso(4), value: 61 }, { _id: 'd', date: iso(3), value: 60 }]);
    renderPage();

    const cards = await screen.findAllByTestId('metric-card');
    const today = cards.find(c => within(c).queryByText('Heute-Wert'));
    const old = cards.find(c => within(c).queryByText('Alt-Wert'));
    await waitFor(() => expect(within(today).getByText('heute')).toBeInTheDocument());
    expect(within(old).getByText('vor 3 Tagen')).toBeInTheDocument();
  });

  it('opens the detail modal with stats and a metric-overlay picker', async () => {
    mockMetrics([
      metric({ _id: 'm1', name: 'Ruhepuls' }),
      metric({ _id: 'm2', name: 'Gewicht', unit: 'kg', key: 'weight' }),
    ]);
    mockLogs('m1', [{ _id: 'a', date: iso(2), value: 55 }, { _id: 'b', date: iso(0), value: 51 }]);
    mockLogs('m2', [{ _id: 'c', date: iso(2), value: 80 }, { _id: 'd', date: iso(0), value: 79 }]);
    const user = userEvent.setup();
    renderPage();

    const cards = await screen.findAllByTestId('metric-card');
    const rhr = cards.find(c => within(c).queryByText('Ruhepuls'));
    await user.click(within(rhr).getByRole('button', { name: /Ruhepuls – Verlauf vergrößern/ }));

    expect(await screen.findByText('Verlauf & Statistik')).toBeInTheDocument();
    expect(screen.getByLabelText('Zweiten Messwert überlagern')).toBeInTheDocument();
    // Overlay option for the OTHER metric is offered
    expect(screen.getByRole('option', { name: 'Gewicht' })).toBeInTheDocument();
    // Descriptive statistics for the primary metric
    expect(screen.getByText('Aktuell')).toBeInTheDocument();
    expect(screen.getByText('Minimum')).toBeInTheDocument();
    expect(screen.getByText('Maximum')).toBeInTheDocument();
  });

  it('opens the manage modal', async () => {
    renderPage();
    const user = userEvent.setup();
    await screen.findByText('Noch keine Messwerte');
    await user.click(screen.getAllByRole('button', { name: /Messwert anlegen|Verwalten/ })[0]);
    expect(await screen.findByText('Messwerte verwalten')).toBeInTheDocument();
  });
});
