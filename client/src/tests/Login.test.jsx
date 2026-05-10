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

// Helper: the exact "Anmelden" submit button (not "Als Admin anmelden")
function getSubmitButton() {
  return screen.getByRole('button', { name: /^Anmelden$/i });
}

describe('Login page', () => {
  it('renders the UUID input and submit button', () => {
    renderLogin();
    expect(screen.getByPlaceholderText(/xxxx/)).toBeInTheDocument();
    expect(getSubmitButton()).toBeInTheDocument();
  });

  it('disables the submit button when UUID field is empty', () => {
    renderLogin();
    expect(getSubmitButton()).toBeDisabled();
  });

  it('enables the submit button after typing a UUID', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByPlaceholderText(/xxxx/), 'some-uuid');
    expect(getSubmitButton()).not.toBeDisabled();
  });

  it('navigates to / on successful login', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByPlaceholderText(/xxxx/), 'valid-uuid');
    await user.click(getSubmitButton());
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'));
  });

  it('shows an error message when login fails', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({ error: 'Ungültige UUID' }, { status: 401 })
      )
    );
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByPlaceholderText(/xxxx/), 'bad-uuid');
    await user.click(getSubmitButton());
    await waitFor(() => expect(screen.getByText(/Ungültige UUID/i)).toBeInTheDocument());
  });

  it('toggles to admin login mode when "Als Admin anmelden" is clicked', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: /Als Admin anmelden/i }));
    expect(screen.getByPlaceholderText(/Admin-Secret/i)).toBeInTheDocument();
  });

  it('disables submit in admin mode when the secret field is empty', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: /Als Admin anmelden/i }));
    await user.type(screen.getByPlaceholderText(/xxxx/), 'admin-uuid');
    expect(getSubmitButton()).toBeDisabled();
  });

  it('toggles admin secret visibility when the eye button is clicked', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: /Als Admin anmelden/i }));

    const secretInput = screen.getByPlaceholderText(/Admin-Secret/i);
    expect(secretInput).toHaveAttribute('type', 'password');

    const toggleBtn = secretInput.closest('div').querySelector('button');
    await user.click(toggleBtn);
    expect(secretInput).toHaveAttribute('type', 'text');
  });

  it('goes back to normal mode when "← Normale Anmeldung" is clicked', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: /Als Admin anmelden/i }));
    expect(screen.queryByPlaceholderText(/Admin-Secret/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Normale Anmeldung/i }));
    expect(screen.queryByPlaceholderText(/Admin-Secret/i)).not.toBeInTheDocument();
  });
});
