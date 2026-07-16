import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import StravaCard from '../components/StravaCard';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// window.location is replaced so the connect redirect can be observed
// without jsdom trying to navigate.
let locationStub;
beforeEach(() => {
  locationStub = { href: 'http://localhost/settings' };
  Object.defineProperty(window, 'location', { configurable: true, value: locationStub });
});

const connectedStatus = {
  configured: true,
  connected: true,
  activityCount: 12,
  connection: {
    athleteId: 4711,
    athlete: { id: 4711, firstname: 'Toni', lastname: 'Test' },
    scope: 'read,activity:read_all',
    initialSyncDone: true,
    lastSyncAt: '2026-07-15T10:00:00.000Z',
    lastSyncError: null,
  },
};

function mockStatus(status) {
  server.use(http.get('/api/strava/status', () => HttpResponse.json(status)));
}

function renderCard(initialEntry = '/settings') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <StravaCard />
    </MemoryRouter>
  );
}

describe('StravaCard – unconfigured', () => {
  it('tells the user an admin has to configure the integration', async () => {
    renderCard(); // base handler: configured: false
    await waitFor(() =>
      expect(screen.getByText(/noch nicht eingerichtet/)).toBeInTheDocument()
    );
    expect(screen.queryByText('Mit Strava verbinden')).not.toBeInTheDocument();
  });
});

describe('StravaCard – connect flow', () => {
  it('starts the OAuth flow via the connect endpoint', async () => {
    mockStatus({ configured: true, connected: false, connection: null, activityCount: 0 });
    server.use(
      http.get('/api/strava/connect', () =>
        HttpResponse.json({ url: 'https://www.strava.com/oauth/authorize?client_id=1' })
      )
    );
    const user = userEvent.setup();
    renderCard();

    await waitFor(() => screen.getByText('Mit Strava verbinden'));
    await user.click(screen.getByText('Mit Strava verbinden'));

    await waitFor(() =>
      expect(locationStub.href).toBe('https://www.strava.com/oauth/authorize?client_id=1')
    );
  });

  it('shows the backend error when connect is rejected', async () => {
    mockStatus({ configured: true, connected: false, connection: null, activityCount: 0 });
    server.use(
      http.get('/api/strava/connect', () =>
        HttpResponse.json({ error: 'Strava ist nicht konfiguriert.' }, { status: 400 })
      )
    );
    const user = userEvent.setup();
    renderCard();

    await waitFor(() => screen.getByText('Mit Strava verbinden'));
    await user.click(screen.getByText('Mit Strava verbinden'));
    await waitFor(() =>
      expect(screen.getByText('Strava ist nicht konfiguriert.')).toBeInTheDocument()
    );
  });

  it('shows the success message after the OAuth callback redirect', async () => {
    mockStatus(connectedStatus);
    renderCard('/settings?strava=success');
    await waitFor(() =>
      expect(screen.getByText(/Strava verbunden!/)).toBeInTheDocument()
    );
  });

  it('explains a denied authorization', async () => {
    renderCard('/settings?strava=denied');
    await waitFor(() =>
      expect(screen.getByText(/Verbindung abgebrochen/)).toBeInTheDocument()
    );
  });

  it('explains when the Strava account is already linked elsewhere', async () => {
    renderCard('/settings?strava=athlete-taken');
    await waitFor(() =>
      expect(screen.getByText(/bereits mit einem anderen Benutzer verknüpft/)).toBeInTheDocument()
    );
  });
});

describe('StravaCard – connected', () => {
  it('shows athlete, activity count and last sync', async () => {
    mockStatus(connectedStatus);
    renderCard();

    await waitFor(() => expect(screen.getByText('Toni Test')).toBeInTheDocument());
    expect(screen.getByText(/12 synchronisierte Aktivitäten/)).toBeInTheDocument();
    expect(screen.getByText('Jetzt synchronisieren')).toBeInTheDocument();
  });

  it('shows the initial sync notice while the backfill runs', async () => {
    mockStatus({
      ...connectedStatus,
      connection: { ...connectedStatus.connection, initialSyncDone: false },
    });
    const { unmount } = renderCard();
    await waitFor(() =>
      expect(screen.getByText(/Erstsynchronisation läuft/)).toBeInTheDocument()
    );
    unmount(); // stops the refresh polling
  });

  it('runs a manual sync and reports the result', async () => {
    mockStatus(connectedStatus);
    server.use(
      http.post('/api/strava/sync', () =>
        HttpResponse.json({ synced: 3, failed: 0, connection: connectedStatus.connection })
      )
    );
    const user = userEvent.setup();
    renderCard();

    await waitFor(() => screen.getByText('Jetzt synchronisieren'));
    await user.click(screen.getByText('Jetzt synchronisieren'));
    await waitFor(() =>
      expect(screen.getByText(/Synchronisation abgeschlossen: 3 neu/)).toBeInTheDocument()
    );
  });

  it('surfaces the throttle message on too frequent syncs', async () => {
    mockStatus(connectedStatus);
    server.use(
      http.post('/api/strava/sync', () =>
        HttpResponse.json({ error: 'Bitte warte kurz – Synchronisation ist maximal einmal pro Minute möglich.' }, { status: 429 })
      )
    );
    const user = userEvent.setup();
    renderCard();

    await waitFor(() => screen.getByText('Jetzt synchronisieren'));
    await user.click(screen.getByText('Jetzt synchronisieren'));
    await waitFor(() =>
      expect(screen.getByText(/maximal einmal pro Minute/)).toBeInTheDocument()
    );
  });

  it('disconnects with optional purge of synced activities', async () => {
    mockStatus(connectedStatus);
    let purgeParam = null;
    server.use(
      http.delete('/api/strava/connection', ({ request }) => {
        purgeParam = new URL(request.url).searchParams.get('purge');
        return HttpResponse.json({ success: true, purged: 12 });
      })
    );
    const user = userEvent.setup();
    renderCard();

    await waitFor(() => screen.getByText('Trennen'));
    await user.click(screen.getByText('Trennen'));
    await user.click(screen.getByText(/Auch alle bereits synchronisierten/));
    await user.click(screen.getByRole('button', { name: 'Verbindung trennen' }));

    await waitFor(() => expect(purgeParam).toBe('1'));
  });
});
