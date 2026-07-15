import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import Layout from '../components/Layout';
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
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    Outlet: () => <div data-testid="outlet">Outlet content</div>,
  };
});

// Mock the Sidebar so it doesn't duplicate nav labels in Layout tests
vi.mock('../components/Sidebar', () => ({
  default: () => <nav data-testid="sidebar-mock" />,
}));

function renderLayout(children = null) {
  server.use(http.get('/api/auth/me', () => HttpResponse.json(mockUser)));
  localStorage.setItem('auth_token', 'valid-token');
  return render(
    <AuthProvider>
      <MemoryRouter>
        <Layout>{children}</Layout>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('Layout', () => {
  it('renders children when passed explicitly', async () => {
    renderLayout(<div data-testid="child-content">Hello</div>);
    expect(await screen.findByTestId('child-content')).toBeInTheDocument();
  });

  it('renders the Outlet when no children are passed', async () => {
    renderLayout();
    expect(await screen.findByTestId('outlet')).toBeInTheDocument();
  });

  it('renders the primary mobile tabs and hides secondary pages behind Mehr', async () => {
    renderLayout();
    await screen.findByTestId('outlet');
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Heute')).toBeInTheDocument();
    expect(screen.getByText('Sport')).toBeInTheDocument();
    expect(screen.getByText('Habits')).toBeInTheDocument();
    expect(screen.getByText('Mehr')).toBeInTheDocument();
    expect(screen.queryByText('Planer')).not.toBeInTheDocument();
    expect(screen.queryByText('Gewicht')).not.toBeInTheDocument();
    expect(screen.queryByText('Ziele')).not.toBeInTheDocument();
  });

  it('opens the Mehr sheet with the secondary pages', async () => {
    const user = userEvent.setup();
    renderLayout();
    await screen.findByTestId('outlet');
    await user.click(screen.getByText('Mehr'));
    expect(screen.getByText('Planer')).toBeInTheDocument();
    expect(screen.getByText('Gewicht')).toBeInTheDocument();
    expect(screen.getByText('Ziele')).toBeInTheDocument();

    // Navigating from the sheet closes it again
    await user.click(screen.getByText('Planer'));
    expect(screen.queryByText('Gewicht')).not.toBeInTheDocument();
  });

  it('renders the user menu in the mobile top bar', async () => {
    renderLayout();
    await screen.findByTestId('outlet');
    expect(screen.getByRole('button', { name: 'Benutzermenü' })).toBeInTheDocument();
  });

  it('renders the sidebar placeholder', async () => {
    renderLayout();
    await screen.findByTestId('outlet');
    expect(screen.getByTestId('sidebar-mock')).toBeInTheDocument();
  });
});
