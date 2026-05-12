import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import Settings from '../pages/Settings';
import { AuthProvider } from '../contexts/AuthContext';
import { mockUser } from './mocks/handlers';

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
});
afterAll(() => server.close());

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

function renderSettings(userOverride = {}) {
  const user = { ...mockUser, ...userOverride };
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(user))
  );
  localStorage.setItem('auth_token', 'valid-token');
  return render(
    <AuthProvider>
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('Settings – Profil', () => {
  it('renders the name input with current user name', async () => {
    renderSettings();
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Dein Name')).toHaveValue(mockUser.name)
    );
  });

  it('renders the weight unit select', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
  });
});

describe('Settings – Benutzername', () => {
  it('shows current username', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByText(mockUser.username)).toBeInTheDocument());
  });

  it('shows username save error from server', async () => {
    server.use(
      http.put('/api/auth/me/username', () =>
        HttpResponse.json({ error: 'Benutzername bereits vergeben.' }, { status: 409 })
      )
    );
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() => screen.getByPlaceholderText('Mindestens 3 Zeichen'));
    await user.type(screen.getByPlaceholderText('Mindestens 3 Zeichen'), 'taken');
    await user.click(screen.getByRole('button', { name: /Benutzernamen speichern/i }));
    await waitFor(() =>
      expect(screen.getByText('Benutzername bereits vergeben.')).toBeInTheDocument()
    );
  });
});

describe('Settings – Passwort', () => {
  it('renders password form when user has username and password', async () => {
    renderSettings({ username: 'alice', hasPassword: true });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Passwort ändern/i })).toBeInTheDocument()
    );
  });

  it('hides password form when user has no password', async () => {
    renderSettings({ hasPassword: false });
    await waitFor(() => screen.getByText('Profil'));
    expect(screen.queryByRole('button', { name: /Passwort ändern/i })).not.toBeInTheDocument();
  });
});

describe('Settings – Versionen', () => {
  it('shows the frontend version from __APP_VERSION__', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByText('Frontend')).toBeInTheDocument());
    expect(screen.getByText(__APP_VERSION__)).toBeInTheDocument();
  });

  it('fetches and displays the backend version', async () => {
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText('1.0.0+test123')).toBeInTheDocument()
    );
  });

  it('shows "–" when backend version fetch fails', async () => {
    server.use(
      http.get('/api', () => HttpResponse.error())
    );
    renderSettings();
    await waitFor(() => expect(screen.getByText('–')).toBeInTheDocument());
  });
});

describe('Settings – Konto', () => {
  it('shows logout button', async () => {
    renderSettings();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Abmelden/i })).toBeInTheDocument()
    );
  });

  it('shows member since date', async () => {
    renderSettings({ createdAt: '2024-01-15T10:00:00.000Z' });
    await waitFor(() =>
      expect(screen.getByText(/Mitglied seit/i)).toBeInTheDocument()
    );
  });
});
