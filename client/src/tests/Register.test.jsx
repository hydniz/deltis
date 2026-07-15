import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import Register from '../pages/Register';
import Login from '../pages/Login';
import { AuthProvider } from '../contexts/AuthContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { mockUser } from './mocks/handlers';

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
});
afterAll(() => server.close());

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderPage(Page) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json({ error: 'Nicht autorisiert' }, { status: 401 }))
  );
  return render(
    <ThemeProvider>
      <AuthProvider>
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

const enabledStatus = () =>
  http.get('/api/auth/registration-status', () => HttpResponse.json({ enabled: true }));

describe('Register – Verfügbarkeit', () => {
  it('shows a notice when self-registration is disabled', async () => {
    renderPage(Register);
    expect(await screen.findByText(/Selbstregistrierung ist deaktiviert/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Konto erstellen/ })).not.toBeInTheDocument();
  });

  it('shows the registration form when enabled', async () => {
    server.use(enabledStatus());
    renderPage(Register);
    expect(await screen.findByRole('button', { name: /Konto erstellen/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Mindestens 3 Zeichen/)).toBeInTheDocument();
  });
});

describe('Register – Ablauf', () => {
  it('registers and navigates to the dashboard', async () => {
    server.use(
      enabledStatus(),
      http.post('/api/auth/register', async ({ request }) => {
        const body = await request.json();
        return HttpResponse.json({
          ...mockUser,
          username: body.username,
          onboardingPending: true,
        }, { status: 201 });
      })
    );
    const user = userEvent.setup();
    renderPage(Register);

    await user.type(await screen.findByPlaceholderText(/Mindestens 3 Zeichen \(a/), 'neuernutzer');
    await user.type(screen.getByPlaceholderText('Mindestens 8 Zeichen'), 'superpasswort');
    await user.type(screen.getByPlaceholderText('Passwort wiederholen'), 'superpasswort');
    await user.click(screen.getByRole('button', { name: /Konto erstellen/ }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard'));
  });

  it('shows server errors (e.g. username taken)', async () => {
    server.use(
      enabledStatus(),
      http.post('/api/auth/register', () =>
        HttpResponse.json({ error: 'Benutzername bereits vergeben.' }, { status: 409 })
      )
    );
    const user = userEvent.setup();
    renderPage(Register);

    await user.type(await screen.findByPlaceholderText(/Mindestens 3 Zeichen \(a/), 'vergeben');
    await user.type(screen.getByPlaceholderText('Mindestens 8 Zeichen'), 'superpasswort');
    await user.type(screen.getByPlaceholderText('Passwort wiederholen'), 'superpasswort');
    await user.click(screen.getByRole('button', { name: /Konto erstellen/ }));

    expect(await screen.findByText('Benutzername bereits vergeben.')).toBeInTheDocument();
  });
});

describe('Login – Registrierungslink', () => {
  it('hides the link while registration is disabled', async () => {
    renderPage(Login);
    await screen.findByPlaceholderText('Dein Benutzername');
    expect(screen.queryByText('Jetzt registrieren')).not.toBeInTheDocument();
  });

  it('shows the link when registration is enabled', async () => {
    server.use(enabledStatus());
    renderPage(Login);
    expect(await screen.findByText('Jetzt registrieren')).toBeInTheDocument();
  });
});
