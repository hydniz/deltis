import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import AdminIntegrations from '../pages/AdminIntegrations';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const configuredOverview = {
  configured: true,
  clientIdSet: true,
  clientSecretSet: true,
  publicBaseUrl: 'https://deltis.jlno.de',
  callbackDomain: 'deltis.jlno.de',
  webhookCallbackUrl: 'https://deltis.jlno.de/api/strava/webhook',
  pollIntervalMinutes: 15,
  connectedUsers: 2,
  activityCount: 31,
};

function mockOverview(overview, subscriptions = []) {
  server.use(
    http.get('/api/strava/admin/overview', () => HttpResponse.json(overview)),
    http.get('/api/strava/admin/subscription', () => HttpResponse.json({ subscriptions })),
  );
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminIntegrations />
    </MemoryRouter>
  );
}

describe('AdminIntegrations', () => {
  it('shows the authorization callback domain and usage numbers', async () => {
    mockOverview(configuredOverview);
    renderPage();

    await waitFor(() => expect(screen.getByText('deltis.jlno.de')).toBeInTheDocument());
    expect(screen.getByText('https://deltis.jlno.de/api/strava/webhook')).toBeInTheDocument();
    expect(screen.getByText('alle 15 Minuten')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('31')).toBeInTheDocument();
  });

  it('guides towards the config page when credentials are missing', async () => {
    mockOverview({
      ...configuredOverview,
      configured: false,
      clientIdSet: false,
      clientSecretSet: false,
      publicBaseUrl: null,
      callbackDomain: null,
      webhookCallbackUrl: null,
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/Hinterlege Client-ID und Client-Secret/)).toBeInTheDocument()
    );
    expect(screen.getByRole('link', { name: /System → Integrationen/ })).toHaveAttribute('href', '/admin/config');
    // No webhook management without credentials
    expect(screen.queryByText('Webhook-Abonnement')).not.toBeInTheDocument();
  });

  it('creates a webhook subscription', async () => {
    mockOverview(configuredOverview);
    let created = false;
    server.use(
      http.post('/api/strava/admin/subscription', () => {
        created = true;
        return HttpResponse.json({ subscription: { id: 7 } }, { status: 201 });
      })
    );
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => screen.getByText('Webhook-Abo anlegen'));
    await user.click(screen.getByText('Webhook-Abo anlegen'));
    await waitFor(() => expect(created).toBe(true));
  });

  it('lists an active subscription and deletes it after confirmation', async () => {
    mockOverview(configuredOverview, [{ id: 7, callback_url: 'https://deltis.jlno.de/api/strava/webhook' }]);
    let deleted = false;
    server.use(
      http.delete('/api/strava/admin/subscription/7', () => {
        deleted = true;
        return HttpResponse.json({ success: true });
      })
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/Aktiv \(ID 7\)/)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Löschen/ }));
    await waitFor(() => expect(deleted).toBe(true));
  });

  it('surfaces subscription errors from the backend', async () => {
    server.use(
      http.get('/api/strava/admin/overview', () => HttpResponse.json(configuredOverview)),
      http.get('/api/strava/admin/subscription', () =>
        HttpResponse.json({ error: 'callback url not verifiable' }, { status: 400 })
      ),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('callback url not verifiable')).toBeInTheDocument()
    );
  });
});
