import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { mockUser } from './mocks/handlers';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Helpers

function TestConsumer() {
  const { user, loading } = useAuth();
  if (loading) return <div>Loading...</div>;
  if (!user) return <div data-testid="no-user">No user</div>;
  return <div data-testid="user-name">{user.name}</div>;
}

function LoginConsumer() {
  const { user, login, logout } = useAuth();
  const handleLogin = async () => {
    try { await login('testuser', 'password'); } catch {}
  };
  return (
    <div>
      <span data-testid="user">{user ? user.name : 'none'}</span>
      <button onClick={handleLogin}>Login</button>
      <button onClick={logout}>Logout</button>
    </div>
  );
}

// Initial load

describe('AuthContext – initial load', () => {
  it('resolves to no user when the server returns 401 (no cookie)', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
      )
    );
    render(<AuthProvider><TestConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());
    expect(screen.getByTestId('no-user')).toBeInTheDocument();
  });

  it('restores the user session on mount when cookie is valid', async () => {
    // Default handler returns mockUser — simulates a valid httpOnly cookie
    render(<AuthProvider><TestConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());
    expect(screen.getByTestId('user-name')).toHaveTextContent('Test User');
  });

  it('starts in loading state before the API call resolves', () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ error: 'err' }, { status: 401 }))
    );
    render(<AuthProvider><TestConsumer /></AuthProvider>);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});

// Login / logout

describe('AuthContext – login / logout', () => {
  it('sets user state on successful login via POST /auth/login', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ error: 'err' }, { status: 401 }))
    );
    render(<AuthProvider><LoginConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('none'));

    await act(async () => { screen.getByText('Login').click(); });
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Test User'));
  });

  it('clears user state on logout', async () => {
    render(<AuthProvider><LoginConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Test User'));

    act(() => { screen.getByText('Logout').click(); });
    expect(screen.getByTestId('user')).toHaveTextContent('none');
  });

  it('throws and keeps user null when login returns 401', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ error: 'err' }, { status: 401 })),
      http.post('/api/auth/login', () =>
        HttpResponse.json({ error: 'Falsches Passwort' }, { status: 401 })
      )
    );
    render(<AuthProvider><LoginConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('none'));

    await act(async () => { screen.getByText('Login').click(); });
    expect(screen.getByTestId('user')).toHaveTextContent('none');
  });
});

// setUsername

describe('AuthContext – setUsername', () => {
  function SetUsernameConsumer() {
    const { user, setUsername } = useAuth();
    const handle = async () => {
      try { await setUsername('newname', null); } catch {}
    };
    return (
      <div>
        <span data-testid="username">{user?.username ?? 'none'}</span>
        <button onClick={handle}>SetUsername</button>
      </div>
    );
  }

  it('updates username in user state', async () => {
    render(<AuthProvider><SetUsernameConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('testuser'));

    await act(async () => { screen.getByText('SetUsername').click(); });
    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('newname'));
  });
});

// changePassword

function ChangePasswordConsumer() {
  const { changePassword } = useAuth();
  const [done, setDone] = useState(false);
  const handle = async () => {
    try { await changePassword('oldpass', 'newpass'); setDone(true); } catch {}
  };
  return <button onClick={handle}>{done ? 'done' : 'ChangePassword'}</button>;
}

describe('AuthContext – changePassword', () => {
  it('calls PUT /auth/me/password and resolves', async () => {
    render(<AuthProvider><ChangePasswordConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());
    await act(async () => { screen.getByText('ChangePassword').click(); });
    await waitFor(() => expect(screen.getByText('done')).toBeInTheDocument());
  });
});

// forceChangePassword

describe('AuthContext – forceChangePassword', () => {
  it('sets mustChangePassword to false in user state', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({ ...mockUser, mustChangePassword: true })
      )
    );
    function ForceCP() {
      const { user, forceChangePassword } = useAuth();
      const handle = async () => {
        try { await forceChangePassword('freshpass'); } catch {}
      };
      return (
        <div>
          <span data-testid="must-change">{String(user?.mustChangePassword)}</span>
          <button onClick={handle}>ForceChange</button>
        </div>
      );
    }
    render(<AuthProvider><ForceCP /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('must-change')).toHaveTextContent('true'));

    await act(async () => { screen.getByText('ForceChange').click(); });
    await waitFor(() => expect(screen.getByTestId('must-change')).toHaveTextContent('false'));
  });
});

// updateUser

describe('AuthContext – updateUser', () => {
  it('merges the provided data into the current user state', async () => {
    function UpdateConsumer() {
      const { user, updateUser } = useAuth();
      const handle = () => updateUser({ name: 'Updated Name' });
      return (
        <div>
          <span data-testid="name">{user?.name ?? 'none'}</span>
          <button onClick={handle}>Update</button>
        </div>
      );
    }
    render(<AuthProvider><UpdateConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Test User'));

    act(() => { screen.getByText('Update').click(); });
    expect(screen.getByTestId('name')).toHaveTextContent('Updated Name');
  });
});
