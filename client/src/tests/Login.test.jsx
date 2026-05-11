import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import Login from '../pages/Login';
import { AuthProvider } from '../contexts/AuthContext';

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

function renderLogin() {
  return render(
    <AuthProvider>
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    </AuthProvider>
  );
}

function getSubmitButton() {
  return screen.getByRole('button', { name: /^Anmelden$/i });
}

describe('Login page – initial render', () => {
  it('renders the username input', () => {
    renderLogin();
    expect(screen.getByPlaceholderText(/Dein Benutzername/i)).toBeInTheDocument();
  });

  it('renders the password input', () => {
    renderLogin();
    expect(screen.getByPlaceholderText(/^Passwort$/i)).toBeInTheDocument();
  });

  it('renders the submit button', () => {
    renderLogin();
    expect(getSubmitButton()).toBeInTheDocument();
  });

  it('disables the submit button when username is empty', () => {
    renderLogin();
    expect(getSubmitButton()).toBeDisabled();
  });

  it('enables the submit button when username is filled (password can be empty for migration)', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByPlaceholderText(/Dein Benutzername/i), 'alice');
    expect(getSubmitButton()).not.toBeDisabled();
  });
});

describe('Login page – normal login flow', () => {
  it('navigates to /dashboard on successful login with username and password', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByPlaceholderText(/Dein Benutzername/i), 'alice');
    await user.type(screen.getByPlaceholderText(/^Passwort$/i), 'mypassword');
    await user.click(getSubmitButton());
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard'));
  });

  it('navigates to /dashboard on migration login (username only, no password)', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByPlaceholderText(/Dein Benutzername/i), 'old-uuid');
    await user.click(getSubmitButton());
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard'));
  });

  it('shows loading spinner while request is in flight', async () => {
    server.use(
      http.get('/api/auth/me', async () => {
        await new Promise(() => {}); // never resolves
      })
    );
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByPlaceholderText(/Dein Benutzername/i), 'alice');
    await user.click(getSubmitButton());
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });
});

describe('Login page – password visibility toggle', () => {
  it('toggles password field between password and text type', async () => {
    const user = userEvent.setup();
    renderLogin();
    const passwordInput = screen.getByPlaceholderText(/^Passwort$/i);
    expect(passwordInput).toHaveAttribute('type', 'password');

    const toggleBtn = passwordInput.closest('div').querySelector('button');
    await user.click(toggleBtn);
    expect(passwordInput).toHaveAttribute('type', 'text');

    await user.click(toggleBtn);
    expect(passwordInput).toHaveAttribute('type', 'password');
  });
});

describe('Login page – error messages', () => {
  it('shows "Falsches Passwort" error', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({ error: 'Falsches Passwort' }, { status: 401 })
      )
    );
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByPlaceholderText(/Dein Benutzername/i), 'alice');
    await user.type(screen.getByPlaceholderText(/^Passwort$/i), 'wrongpass');
    await user.click(getSubmitButton());
    await waitFor(() => expect(screen.getByText(/Falsches Passwort/)).toBeInTheDocument());
  });

  it('shows "Bitte Passwort eingeben" for PASSWORD_REQUIRED code', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({ error: 'Passwort erforderlich', code: 'PASSWORD_REQUIRED' }, { status: 401 })
      )
    );
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByPlaceholderText(/Dein Benutzername/i), 'alice');
    await user.click(getSubmitButton());
    await waitFor(() => expect(screen.getByText(/Bitte Passwort eingeben/i)).toBeInTheDocument());
  });

  it('shows UUID-blocked error for UUID_BLOCKED code', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({ code: 'UUID_BLOCKED' }, { status: 401 })
      )
    );
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByPlaceholderText(/Dein Benutzername/i), 'some-old-uuid');
    await user.click(getSubmitButton());
    await waitFor(() =>
      expect(screen.getByText(/UUID ist gesperrt/i)).toBeInTheDocument()
    );
  });

  it('shows generic error for unknown username', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({ error: 'Unbekannter Benutzer' }, { status: 401 })
      )
    );
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByPlaceholderText(/Dein Benutzername/i), 'nobody');
    await user.click(getSubmitButton());
    await waitFor(() =>
      expect(screen.getByText(/Unbekannter Benutzername/i)).toBeInTheDocument()
    );
  });
});

describe('Login page – admin login mode', () => {
  it('switches to admin mode when "Als Admin anmelden" is clicked', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: /Als Admin anmelden/i }));
    expect(screen.getByPlaceholderText(/Admin-Secret eingeben/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/^Passwort$/i)).not.toBeInTheDocument();
  });

  it('disables submit in admin mode when Admin-Secret is empty', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: /Als Admin anmelden/i }));
    await user.type(screen.getByPlaceholderText(/Dein Benutzername/i), 'admin');
    expect(getSubmitButton()).toBeDisabled();
  });

  it('enables submit in admin mode when both username and secret are filled', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: /Als Admin anmelden/i }));
    await user.type(screen.getByPlaceholderText(/Dein Benutzername/i), 'admin');
    await user.type(screen.getByPlaceholderText(/Admin-Secret eingeben/i), 'mysecret');
    expect(getSubmitButton()).not.toBeDisabled();
  });

  it('toggles admin secret visibility', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: /Als Admin anmelden/i }));
    const secretInput = screen.getByPlaceholderText(/Admin-Secret eingeben/i);
    expect(secretInput).toHaveAttribute('type', 'password');

    const toggleBtn = secretInput.closest('div').querySelector('button');
    await user.click(toggleBtn);
    expect(secretInput).toHaveAttribute('type', 'text');
  });

  it('navigates to /dashboard on successful admin login', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: /Als Admin anmelden/i }));
    await user.type(screen.getByPlaceholderText(/Dein Benutzername/i), 'admin');
    await user.type(screen.getByPlaceholderText(/Admin-Secret eingeben/i), 'admin:mysecret');
    await user.click(getSubmitButton());
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard'));
  });

  it('shows error for wrong admin secret', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({ error: 'Falsches Admin-Secret' }, { status: 401 })
      )
    );
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: /Als Admin anmelden/i }));
    await user.type(screen.getByPlaceholderText(/Dein Benutzername/i), 'admin');
    await user.type(screen.getByPlaceholderText(/Admin-Secret eingeben/i), 'wrongsecret');
    await user.click(getSubmitButton());
    await waitFor(() =>
      expect(screen.getByText(/Falsches Admin-Secret/i)).toBeInTheDocument()
    );
  });

  it('returns to normal mode when "← Normale Anmeldung" is clicked', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: /Als Admin anmelden/i }));
    expect(screen.getByPlaceholderText(/Admin-Secret eingeben/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Normale Anmeldung/i }));
    expect(screen.queryByPlaceholderText(/Admin-Secret eingeben/i)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/^Passwort$/i)).toBeInTheDocument();
  });

  it('clears error when toggling between normal and admin mode', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({ error: 'Falsches Passwort' }, { status: 401 })
      )
    );
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByPlaceholderText(/Dein Benutzername/i), 'alice');
    await user.click(getSubmitButton());
    await waitFor(() => expect(screen.getByText(/Falsches Passwort/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Als Admin anmelden/i }));
    expect(screen.queryByText(/Falsches Passwort/)).not.toBeInTheDocument();
  });
});
