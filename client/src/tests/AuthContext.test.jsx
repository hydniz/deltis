import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import { AuthProvider, useAuth } from '../contexts/AuthContext';

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
});
afterAll(() => server.close());

function TestConsumer() {
  const { user, loading, login, logout } = useAuth();
  if (loading) return <div>Loading...</div>;
  if (!user) return <div data-testid="no-user">No user</div>;
  return <div data-testid="user-name">{user.name}</div>;
}

describe('AuthContext', () => {
  it('starts in loading state and resolves to no user when no token exists', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('no-user')).toBeInTheDocument();
  });

  it('restores the user from localStorage on mount', async () => {
    localStorage.setItem('auth_token', 'valid-token');

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('user-name')).toHaveTextContent('Test User');
  });

  it('clears the token from localStorage when the API call fails', async () => {
    localStorage.setItem('auth_token', 'invalid-token');
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({ error: 'Ungültige UUID' }, { status: 401 })
      )
    );

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(screen.getByTestId('no-user')).toBeInTheDocument();
  });
});

function LoginConsumer() {
  const { user, login, logout } = useAuth();
  const handleLogin = async () => {
    try { await login('my-uuid'); } catch {}
  };
  const handleLogout = () => logout();
  return (
    <div>
      <span data-testid="user">{user ? user.name : 'none'}</span>
      <button onClick={handleLogin}>Login</button>
      <button onClick={handleLogout}>Logout</button>
    </div>
  );
}

describe('AuthContext login / logout', () => {
  it('sets the user on successful login', async () => {
    const { getByText, getByTestId } = render(
      <AuthProvider>
        <LoginConsumer />
      </AuthProvider>
    );
    await waitFor(() => expect(getByTestId('user')).toHaveTextContent('none'));

    await act(async () => {
      getByText('Login').click();
    });

    await waitFor(() => expect(getByTestId('user')).toHaveTextContent('Test User'));
    expect(localStorage.getItem('auth_token')).toBe('my-uuid');
  });

  it('clears the user on logout', async () => {
    localStorage.setItem('auth_token', 'valid-token');
    const { getByText, getByTestId } = render(
      <AuthProvider>
        <LoginConsumer />
      </AuthProvider>
    );
    await waitFor(() => expect(getByTestId('user')).toHaveTextContent('Test User'));

    act(() => { getByText('Logout').click(); });

    expect(getByTestId('user')).toHaveTextContent('none');
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('throws and removes token when login fails', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({ error: 'Ungültige UUID' }, { status: 401 })
      )
    );

    const { getByText, getByTestId } = render(
      <AuthProvider>
        <LoginConsumer />
      </AuthProvider>
    );
    await waitFor(() => expect(getByTestId('user')).toHaveTextContent('none'));

    await act(async () => { getByText('Login').click(); });

    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(getByTestId('user')).toHaveTextContent('none');
  });
});
