import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import App from '../App';
import { mockUser } from './mocks/handlers';
import { SESSION_EXPIRED_KEY } from '../utils/api';

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
  sessionStorage.clear();
});
afterAll(() => server.close());

vi.mock('../components/Sidebar', () => ({ default: () => <nav data-testid="sidebar" /> }));

const unauthorized = () =>
  HttpResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });

describe('Session expiry mid-use', () => {
  it('redirects to the login page when a page fetch returns 401', async () => {
    // Session restore succeeds (user believes they are logged in), but the
    // cookie is no longer valid for data requests — like after an expiry.
    window.history.pushState({}, '', '/habits');
    localStorage.setItem('auth_token', 'valid-token');
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(mockUser)),
      http.get('/api/habits/definitions', unauthorized),
      http.get('/api/habits/logs', unauthorized),
    );

    render(<App />);

    // Instead of an empty habits page, the user lands on the login page …
    await waitFor(
      () => expect(screen.getByPlaceholderText('Dein Benutzername')).toBeInTheDocument(),
      { timeout: 3000 }
    );
    // … with an explanation. findByText: the notice appears only after
    // Login's mount effect has read the expiry flag — a sync getByText
    // races that effect and flakes.
    expect(await screen.findByText('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.')).toBeInTheDocument();
    expect(sessionStorage.getItem(SESSION_EXPIRED_KEY)).toBeNull();
  });

  it('does not show the expiry notice on a fresh visit without a session', async () => {
    window.history.pushState({}, '', '/login');
    server.use(http.get('/api/auth/me', unauthorized));

    render(<App />);

    await waitFor(() =>
      expect(screen.getByPlaceholderText('Dein Benutzername')).toBeInTheDocument()
    );
    expect(
      screen.queryByText('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.')
    ).not.toBeInTheDocument();
  });
});
