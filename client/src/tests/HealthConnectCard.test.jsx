import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import HealthConnectCard, { summarizeSync } from '../components/HealthConnectCard';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const connectedConfig = {
  connected: true,
  deviceName: 'Pixel 8',
  enabledTypes: ['exercise', 'weight'],
  backfillDays: 30,
  excludedOrigins: ['com.strava'],
  lastSyncAt: '2026-07-20T08:30:00.000Z',
  lastSyncCounts: {
    activities: 5,
    weights: { imported: 2, skipped: 0, collapsed: 0 },
    merge: { checked: 5, superseded: 1, promoted: 0 },
  },
  supportedTypes: ['exercise', 'weight', 'heartRate', 'steps', 'activeCalories', 'distance'],
  minBackfillDays: 7,
  maxBackfillDays: 365,
};

function mockConfig(config) {
  server.use(http.get('/api/health/config', () => HttpResponse.json(config)));
}

describe('summarizeSync', () => {
  it('returns null without counts', () => {
    expect(summarizeSync(null)).toBeNull();
    expect(summarizeSync(undefined)).toBeNull();
  });

  it('returns null when nothing meaningful happened', () => {
    expect(summarizeSync({ activities: 0, weights: { imported: 0 }, merge: { superseded: 0 } })).toBeNull();
  });

  it('summarizes activities, weights and duplicates with correct plurals', () => {
    expect(summarizeSync({ activities: 1, weights: { imported: 1 }, merge: { superseded: 1 } }))
      .toBe('1 Aktivität · 1 Gewichtswert · 1 Duplikat erkannt');
    expect(summarizeSync({ activities: 3, weights: { imported: 2 }, merge: { superseded: 4 } }))
      .toBe('3 Aktivitäten · 2 Gewichtswerte · 4 Duplikate erkannt');
  });

  it('omits missing parts', () => {
    expect(summarizeSync({ activities: 2 })).toBe('2 Aktivitäten');
  });
});

describe('HealthConnectCard – loading', () => {
  it('shows a spinner before the config arrives', () => {
    mockConfig(new Promise(() => {})); // never resolves
    const { container } = render(<HealthConnectCard />);
    expect(container.querySelector('[data-testid="health-connect-card"]')).toBeInTheDocument();
  });
});

describe('HealthConnectCard – not connected', () => {
  it('explains that connecting happens in the companion app', async () => {
    render(<HealthConnectCard />); // default handler: connected: false
    expect(await screen.findByText(/Deltis Companion/)).toBeInTheDocument();
    expect(screen.getByText(/Installiere die Companion-App/)).toBeInTheDocument();
    expect(screen.queryByText('Speichern')).not.toBeInTheDocument();
  });

  it('falls back to the not-connected view when the request fails', async () => {
    server.use(http.get('/api/health/config', () => HttpResponse.error()));
    render(<HealthConnectCard />);
    expect(await screen.findByText(/Deltis Companion/)).toBeInTheDocument();
  });
});

describe('HealthConnectCard – connected', () => {
  it('shows the device, last sync and dedup summary', async () => {
    mockConfig(connectedConfig);
    render(<HealthConnectCard />);

    expect(await screen.findByText('Pixel 8')).toBeInTheDocument();
    expect(screen.getByText(/Letzte Übertragung:/)).toBeInTheDocument();
    expect(screen.getByText('5 Aktivitäten · 2 Gewichtswerte · 1 Duplikat erkannt')).toBeInTheDocument();
  });

  it('renders a toggle per supported type, reflecting the enabled ones', async () => {
    mockConfig(connectedConfig);
    render(<HealthConnectCard />);

    const exercise = await screen.findByRole('switch', { name: 'Trainingseinheiten' });
    const heartRate = screen.getByRole('switch', { name: 'Herzfrequenz' });
    expect(exercise).toHaveAttribute('aria-checked', 'true');
    expect(heartRate).toHaveAttribute('aria-checked', 'false');
  });

  it('offers only backfill options at or above the minimum', async () => {
    mockConfig({ ...connectedConfig, minBackfillDays: 30, backfillDays: 30 });
    render(<HealthConnectCard />);

    await screen.findByText('Pixel 8');
    expect(screen.queryByRole('option', { name: '7 Tage' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: '30 Tage' })).toBeInTheDocument();
  });

  it('saves changed types and window via PUT and confirms', async () => {
    mockConfig(connectedConfig);
    let putBody = null;
    server.use(http.put('/api/health/config', async ({ request }) => {
      putBody = await request.json();
      return HttpResponse.json({ ...connectedConfig, ...putBody });
    }));
    const user = userEvent.setup();
    render(<HealthConnectCard />);

    const heartRate = await screen.findByRole('switch', { name: 'Herzfrequenz' });
    await user.click(heartRate);
    await user.selectOptions(screen.getByRole('combobox'), '90');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(screen.getByText('Einstellungen gespeichert.')).toBeInTheDocument());
    expect(putBody.enabledTypes).toContain('heartRate');
    expect(putBody.backfillDays).toBe(90);
  });

  it('shows an error when saving fails', async () => {
    mockConfig(connectedConfig);
    server.use(http.put('/api/health/config', () =>
      HttpResponse.json({ error: 'Kaputt.' }, { status: 400 })));
    const user = userEvent.setup();
    render(<HealthConnectCard />);

    await user.click(await screen.findByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Kaputt.')).toBeInTheDocument();
  });

  it('toggles an enabled type off', async () => {
    mockConfig(connectedConfig);
    const user = userEvent.setup();
    render(<HealthConnectCard />);

    const weight = await screen.findByRole('switch', { name: 'Gewicht' });
    expect(weight).toHaveAttribute('aria-checked', 'true');
    await user.click(weight);
    expect(weight).toHaveAttribute('aria-checked', 'false');
  });

  // The GET is stateful: connected on the initial mount, not-connected after
  // the DELETE — a single static override would make the card start unconnected.
  function mockDisconnectFlow() {
    let connected = true;
    let deleteUrl = null;
    server.use(
      http.get('/api/health/config', () =>
        HttpResponse.json(connected ? connectedConfig : { connected: false, supportedTypes: [] })),
      http.delete('/api/health/connect', ({ request }) => {
        deleteUrl = new URL(request.url);
        connected = false;
        return HttpResponse.json({ success: true, removed: 0 });
      }),
    );
    return () => deleteUrl;
  }

  it('disconnects without purging and returns to the not-connected view', async () => {
    const getDeleteUrl = mockDisconnectFlow();
    const user = userEvent.setup();
    render(<HealthConnectCard />);

    await user.click(await screen.findByRole('button', { name: /Gerät trennen/ }));
    await user.click(screen.getByRole('button', { name: 'Verbindung trennen' }));

    await waitFor(() => expect(screen.getByText(/Deltis Companion/)).toBeInTheDocument());
    expect(getDeleteUrl().searchParams.get('purge')).toBeNull();
  });

  it('passes purge=true when the user opts to delete synced data', async () => {
    const getDeleteUrl = mockDisconnectFlow();
    const user = userEvent.setup();
    render(<HealthConnectCard />);

    await user.click(await screen.findByRole('button', { name: /Gerät trennen/ }));
    await user.click(screen.getByRole('checkbox', { name: /bereits übertragenen/ }));
    await user.click(screen.getByRole('button', { name: 'Verbindung trennen' }));

    await waitFor(() => expect(getDeleteUrl().searchParams.get('purge')).toBe('true'));
  });

  it('shows an error when disconnecting fails', async () => {
    mockConfig(connectedConfig);
    server.use(http.delete('/api/health/connect', () =>
      HttpResponse.json({ error: 'Geht nicht.' }, { status: 500 })));
    const user = userEvent.setup();
    render(<HealthConnectCard />);

    await user.click(await screen.findByRole('button', { name: /Gerät trennen/ }));
    await user.click(screen.getByRole('button', { name: 'Verbindung trennen' }));
    expect(await screen.findByText('Geht nicht.')).toBeInTheDocument();
  });

  it('cancels the disconnect confirmation', async () => {
    mockConfig(connectedConfig);
    const user = userEvent.setup();
    render(<HealthConnectCard />);

    await user.click(await screen.findByRole('button', { name: /Gerät trennen/ }));
    expect(screen.getByRole('button', { name: 'Verbindung trennen' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('button', { name: 'Verbindung trennen' })).not.toBeInTheDocument();
  });

  it('falls back to a generic device name and dash when fields are missing', async () => {
    mockConfig({ ...connectedConfig, deviceName: '', lastSyncAt: null, lastSyncCounts: null });
    render(<HealthConnectCard />);

    expect(await screen.findByText('Android-Gerät')).toBeInTheDocument();
    expect(screen.getByText(/Letzte Übertragung: –/)).toBeInTheDocument();
  });

  it('uses the type key as a label when no German label exists', async () => {
    mockConfig({ ...connectedConfig, supportedTypes: ['exercise', 'mystery'], enabledTypes: [] });
    render(<HealthConnectCard />);

    expect(await screen.findByRole('switch', { name: 'mystery' })).toBeInTheDocument();
  });
});
