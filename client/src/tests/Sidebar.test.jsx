import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { server } from './mocks/server';
import Sidebar from '../components/Sidebar';
import { AuthProvider } from '../contexts/AuthContext';
import { mockUser, mockAdminUser } from './mocks/handlers';
import { http, HttpResponse } from 'msw';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderSidebar(user = mockUser) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(user))
  );
  return render(
    <AuthProvider>
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    </AuthProvider>
  );
}

// Opens the avatar popover that contains Einstellungen / Administration / Abmelden.
async function openUserMenu(user) {
  const trigger = await screen.findByRole('button', { name: 'Benutzermenü' });
  await user.click(trigger);
}

describe('Sidebar', () => {
  it('renders the app name', async () => {
    renderSidebar();
    expect(await screen.findByText('Deltis')).toBeInTheDocument();
  });

  it('renders navigation links for a regular user', async () => {
    renderSidebar();
    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Aktivitäten')).toBeInTheDocument();
    expect(screen.getByText('Planer')).toBeInTheDocument();
    expect(screen.getByText('Gewohnheiten')).toBeInTheDocument();
    expect(screen.getByText('Gewicht')).toBeInTheDocument();
    expect(screen.getByText('Ziele')).toBeInTheDocument();
  });

  it('shows Einstellungen inside the user menu', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await screen.findByText('Dashboard');
    expect(screen.queryByText('Einstellungen')).not.toBeInTheDocument();
    await openUserMenu(user);
    expect(screen.getByText('Einstellungen')).toBeInTheDocument();
  });

  it('does not show the admin entry for a regular user', async () => {
    const user = userEvent.setup();
    renderSidebar(mockUser);
    await screen.findByText('Dashboard');
    await openUserMenu(user);
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
  });

  it('shows the admin entry in the user menu for admin users', async () => {
    const user = userEvent.setup();
    renderSidebar(mockAdminUser);
    await screen.findByText('Dashboard');
    await openUserMenu(user);
    expect(screen.getByText('Administration')).toBeInTheDocument();
  });

  it('navigates to the admin area when Administration is clicked', async () => {
    const user = userEvent.setup();
    renderSidebar(mockAdminUser);
    await screen.findByText('Dashboard');
    await openUserMenu(user);
    await user.click(screen.getByText('Administration'));
    expect(mockNavigate).toHaveBeenCalledWith('/admin/users');
  });

  it('displays the user name', async () => {
    renderSidebar(mockUser);
    expect(await screen.findByText('Test User')).toBeInTheDocument();
  });

  it('calls navigate to /login on logout click', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await screen.findByText('Dashboard');
    await openUserMenu(user);
    await user.click(screen.getByText('Abmelden'));
    expect(mockNavigate).toHaveBeenCalledWith('/login');
  });
});
