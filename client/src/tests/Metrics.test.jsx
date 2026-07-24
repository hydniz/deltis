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
function mockLogs(id, logs) {
  server.use(http.get(`/api/metrics/${id}/logs`, () => HttpResponse.json(logs)));
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
    await waitFor(() => expect(card).toHaveTextContent('2 Einträge'));
  });

  it('adds a reading and refreshes', async () => {
    mockMetrics([metric()]);
    let logs = [{ _id: 'l1', date: '2026-05-02T06:00:00Z', value: 52 }];
    server.use(
      http.get('/api/metrics/m1/logs', () => HttpResponse.json(logs)),
      http.post('/api/metrics/m1/logs', async ({ request }) => {
        const body = await request.json();
        logs = [...logs, { _id: 'l2', date: new Date().toISOString(), value: body.value }];
        return HttpResponse.json(logs[logs.length - 1], { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('metric-card');
    await user.type(within(card).getByLabelText('Ruhepuls eintragen'), '50');
    await user.click(within(card).getByRole('button', { name: /Eintragen/ }));

    await waitFor(() => expect(card).toHaveTextContent('2 Einträge'));
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

  it('opens the manage modal', async () => {
    renderPage();
    const user = userEvent.setup();
    await screen.findByText('Noch keine Messwerte');
    await user.click(screen.getAllByRole('button', { name: /Messwert anlegen|Verwalten/ })[0]);
    expect(await screen.findByText('Messwerte verwalten')).toBeInTheDocument();
  });
});
