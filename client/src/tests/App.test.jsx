import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import App from '../App';
import { mockUser, mockAdminUser } from './mocks/handlers';

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
});
afterAll(() => server.close());

// Mock pages so we can assert routing without full page rendering
vi.mock('../pages/Landing', () => ({ default: () => <div data-testid="landing-page">Landing</div> }));
vi.mock('../pages/Dashboard', () => ({ default: () => <div data-testid="dashboard-page">Dashboard</div> }));
vi.mock('../pages/Login', () => ({ default: () => <div data-testid="login-page">Login</div> }));
vi.mock('../pages/Admin', () => ({ default: () => <div data-testid="admin-page">Admin</div> }));
vi.mock('../pages/AdminSetup', () => ({ default: () => <div data-testid="admin-setup-page">AdminSetup</div> }));
vi.mock('../pages/Activities', () => ({ default: () => <div>Activities</div> }));
vi.mock('../pages/Planner', () => ({ default: () => <div>Planner</div> }));
vi.mock('../pages/Habits', () => ({ default: () => <div>Habits</div> }));
vi.mock('../pages/Weight', () => ({ default: () => <div>Weight</div> }));
vi.mock('../pages/Goals', () => ({ default: () => <div>Goals</div> }));
vi.mock('../pages/Settings', () => ({ default: () => <div>Settings</div> }));
vi.mock('../components/Sidebar', () => ({ default: () => <nav data-testid="sidebar" /> }));

describe('App routing', () => {
  it('shows the landing page at / for unauthenticated users', async () => {
    window.history.pushState({}, '', '/');
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })));

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('landing-page')).toBeInTheDocument(), { timeout: 3000 });
  });

  it('redirects authenticated users from / to /dashboard', async () => {
    window.history.pushState({}, '', '/');
    localStorage.setItem('auth_token', 'valid-token');
    server.use(http.get('/api/auth/me', () => HttpResponse.json(mockUser)));

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('dashboard-page')).toBeInTheDocument(), { timeout: 3000 });
  });

  it('renders the login page at /login', async () => {
    window.history.pushState({}, '', '/login');
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })));

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument());
  });

  it('renders dashboard at /dashboard for an authenticated user', async () => {
    localStorage.setItem('auth_token', 'valid-token');
    server.use(http.get('/api/auth/me', () => HttpResponse.json(mockUser)));
    window.history.pushState({}, '', '/dashboard');

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('dashboard-page')).toBeInTheDocument(), { timeout: 3000 });
  });

  it('redirects unauthenticated users from /dashboard to /login', async () => {
    window.history.pushState({}, '', '/dashboard');
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })));

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument(), { timeout: 3000 });
  });

  it('renders the admin setup page at /admin/setup without auth', async () => {
    window.history.pushState({}, '', '/admin/setup');
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('admin-setup-page')).toBeInTheDocument());
  });
});

describe('ProtectedRoute', () => {
  it('shows a spinner while auth is loading', () => {
    // Keep the request pending to stay in loading state
    server.use(http.get('/api/auth/me', async () => {
      await new Promise(() => {}); // never resolves
    }));
    localStorage.setItem('auth_token', 'valid-token');
    window.history.pushState({}, '', '/');

    render(<App />);
    // Spinner: border-t-transparent class on a div
    const spinners = document.querySelectorAll('.animate-spin');
    expect(spinners.length).toBeGreaterThan(0);
  });
});
