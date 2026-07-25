import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import ActivitySourcesCard, { orderSources } from '../components/ActivitySourcesCard';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const garmin = { origin: 'com.garmin.android.apps.connectmobile', appLabel: 'Garmin Connect' };
const samsung = { origin: 'com.sec.android.app.shealth', appLabel: 'Samsung Health' };

function mockSources(body, { putResponse } = {}) {
  server.use(
    http.get('/api/health/activity-sources', () => HttpResponse.json(body)),
    http.put('/api/health/activity-sources', async ({ request }) => {
      if (putResponse === 'error') return HttpResponse.error();
      const { priority } = await request.json();
      return HttpResponse.json({ success: true, priority });
    }),
  );
}

describe('orderSources', () => {
  it('orders detected sources by the saved preference, then appends new ones', () => {
    const ordered = orderSources([garmin, samsung], [samsung.origin]);
    expect(ordered.map(s => s.origin)).toEqual([samsung.origin, garmin.origin]);
  });

  it('ignores preference entries no longer detected and dedupes', () => {
    const ordered = orderSources([garmin], ['gone', garmin.origin, garmin.origin]);
    expect(ordered.map(s => s.origin)).toEqual([garmin.origin]);
  });

  it('tolerates missing inputs', () => {
    expect(orderSources(undefined, undefined)).toEqual([]);
  });
});

describe('ActivitySourcesCard – loading', () => {
  it('renders the card shell while loading', () => {
    mockSources(new Promise(() => {}));
    const { container } = render(<ActivitySourcesCard />);
    expect(container.querySelector('[data-testid="activity-sources-card"]')).toBeInTheDocument();
  });
});

describe('ActivitySourcesCard – fewer than two sources', () => {
  it('explains that no ranking is needed yet', async () => {
    mockSources({ sources: [garmin], priority: [] });
    render(<ActivitySourcesCard />);
    expect(await screen.findByText(/keine Rangfolge nötig/)).toBeInTheDocument();
    expect(screen.queryByText('Speichern')).not.toBeInTheDocument();
  });

  it('falls back to the empty state when the request fails', async () => {
    server.use(http.get('/api/health/activity-sources', () => HttpResponse.error()));
    render(<ActivitySourcesCard />);
    expect(await screen.findByText(/keine Rangfolge nötig/)).toBeInTheDocument();
  });
});

describe('ActivitySourcesCard – ranking', () => {
  it('lists sources in the saved order with position numbers', async () => {
    mockSources({ sources: [garmin, samsung], priority: [samsung.origin, garmin.origin] });
    render(<ActivitySourcesCard />);

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Samsung Health')).toBeInTheDocument();
    expect(within(items[1]).getByText('Garmin Connect')).toBeInTheDocument();
    expect(within(items[0]).getByText('1.')).toBeInTheDocument();
  });

  it('moves a source down and saves the new order', async () => {
    const user = userEvent.setup();
    let saved = null;
    server.use(
      http.get('/api/health/activity-sources', () =>
        HttpResponse.json({ sources: [garmin, samsung], priority: [garmin.origin, samsung.origin] })),
      http.put('/api/health/activity-sources', async ({ request }) => {
        saved = (await request.json()).priority;
        return HttpResponse.json({ success: true, priority: saved });
      }),
    );
    render(<ActivitySourcesCard />);

    // Garmin is first — move it down so Samsung leads.
    const items = await screen.findAllByRole('listitem');
    await user.click(within(items[0]).getByLabelText('Nach unten'));

    const reordered = await screen.findAllByRole('listitem');
    expect(within(reordered[0]).getByText('Samsung Health')).toBeInTheDocument();

    await user.click(screen.getByText('Speichern'));
    await waitFor(() => expect(saved).toEqual([samsung.origin, garmin.origin]));
    expect(await screen.findByText('Gespeichert')).toBeInTheDocument();
  });

  it('disables the up button on the first row and down on the last', async () => {
    mockSources({ sources: [garmin, samsung], priority: [garmin.origin, samsung.origin] });
    render(<ActivitySourcesCard />);
    const items = await screen.findAllByRole('listitem');
    expect(within(items[0]).getByLabelText('Nach oben')).toBeDisabled();
    expect(within(items[1]).getByLabelText('Nach unten')).toBeDisabled();
    // Moving the top row up is a no-op.
    await userEvent.setup().click(within(items[0]).getByLabelText('Nach oben'));
    expect(within((await screen.findAllByRole('listitem'))[0]).getByText('Garmin Connect')).toBeInTheDocument();
  });

  it('shows an error when saving fails', async () => {
    mockSources({ sources: [garmin, samsung], priority: [] }, { putResponse: 'error' });
    const user = userEvent.setup();
    render(<ActivitySourcesCard />);
    await screen.findByText('Speichern');
    await user.click(screen.getByText('Speichern'));
    expect(await screen.findByText(/fehlgeschlagen/)).toBeInTheDocument();
  });
});
