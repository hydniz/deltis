import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { mockUser } from './mocks/handlers';

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
});
afterAll(() => server.close());

// Generic consumer that exposes loading/user state
function TestConsumer() {
  const { user, loading } = useAuth();
  if (loading) return <div>Loading...</div>;
  if (!user) return <div data-testid="no-user">No user</div>;
  return <div data-testid="user-name">{user.name}</div>;
}

describe('AuthContext – initial load', () => {
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

// Consumer for login / logout tests
function LoginConsumer() {
  const { user, login, logout } = useAuth();
  const handleLogin = async () => {
    try { await login('my-uuid'); } catch {}
  };
  return (
    <div>
      <span data-testid="user">{user ? user.name : 'none'}</span>
      <button onClick={handleLogin}>Login</button>
      <button onClick={logout}>Logout</button>
    </div>
  );
}

describe('AuthContext – login / logout', () => {
  it('sets the user on successful login (identifier only – migration mode)', async () => {
    const { getByText, getByTestId } = render(
      <AuthProvider>
        <LoginConsumer />
      </AuthProvider>
    );
    await waitFor(() => expect(getByTestId('user')).toHaveTextContent('none'));
    await act(async () => { getByText('Login').click(); });
    await waitFor(() => expect(getByTestId('user')).toHaveTextContent('Test User'));
    expect(localStorage.getItem('auth_token')).toBe('my-uuid');
  });

  it('stores "identifier:password" token when password is provided', async () => {
    function PasswordLoginConsumer() {
      const { user, login } = useAuth();
      const handle = async () => {
        try { await login('alice', 'secretpass'); } catch {}
      };
      return (
        <div>
          <span data-testid="user">{user ? user.name : 'none'}</span>
          <button onClick={handle}>Login</button>
        </div>
      );
    }
    const { getByText, getByTestId } = render(
      <AuthProvider>
        <PasswordLoginConsumer />
      </AuthProvider>
    );
    await waitFor(() => expect(getByTestId('user')).toHaveTextContent('none'));
    await act(async () => { getByText('Login').click(); });
    await waitFor(() => expect(getByTestId('user')).toHaveTextContent('Test User'));
    expect(localStorage.getItem('auth_token')).toBe('alice:secretpass');
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

// Consumer for setUsername tests
function SetUsernameConsumer({ initialPassword } = {}) {
  const { user, setUsername } = useAuth();
  const handle = async () => {
    try { await setUsername('newname', initialPassword || null); } catch {}
  };
  return (
    <div>
      <span data-testid="username">{user?.username ?? 'none'}</span>
      <button onClick={handle}>SetUsername</button>
    </div>
  );
}

describe('AuthContext – setUsername', () => {
  it('updates username in user state', async () => {
    localStorage.setItem('auth_token', 'valid-token');
    const { getByText, getByTestId } = render(
      <AuthProvider>
        <SetUsernameConsumer />
      </AuthProvider>
    );
    await waitFor(() => expect(getByTestId('username')).toHaveTextContent('testuser'));
    await act(async () => { getByText('SetUsername').click(); });
    await waitFor(() => expect(getByTestId('username')).toHaveTextContent('newname'));
  });

  it('updates localStorage token to "newname:password" when password is provided (initial setup)', async () => {
    localStorage.setItem('auth_token', 'migration-uuid');
    const { getByText, getByTestId } = render(
      <AuthProvider>
        <SetUsernameConsumer initialPassword="mypassword" />
      </AuthProvider>
    );
    await waitFor(() => expect(getByTestId('username')).toHaveTextContent('testuser'));
    await act(async () => { getByText('SetUsername').click(); });
    await waitFor(() => expect(getByTestId('username')).toHaveTextContent('newname'));
    expect(localStorage.getItem('auth_token')).toBe('newname:mypassword');
  });

  it('keeps existing secret in token when no new password is provided (username rename)', async () => {
    // token format: "oldname:existingsecret"
    localStorage.setItem('auth_token', 'oldname:existingsecret');
    const { getByText, getByTestId } = render(
      <AuthProvider>
        <SetUsernameConsumer />
      </AuthProvider>
    );
    await waitFor(() => expect(getByTestId('username')).toHaveTextContent('testuser'));
    await act(async () => { getByText('SetUsername').click(); });
    await waitFor(() => expect(getByTestId('username')).toHaveTextContent('newname'));
    expect(localStorage.getItem('auth_token')).toBe('newname:existingsecret');
  });
});

// Consumer for changePassword tests
function ChangePasswordConsumer() {
  const { changePassword } = useAuth();
  const handle = async () => {
    try { await changePassword('oldpass', 'newpass'); } catch {}
  };
  return <button onClick={handle}>ChangePassword</button>;
}

describe('AuthContext – changePassword', () => {
  it('updates the token with the new password', async () => {
    localStorage.setItem('auth_token', 'alice:oldpass');
    render(
      <AuthProvider>
        <ChangePasswordConsumer />
      </AuthProvider>
    );
    await waitFor(() => expect(localStorage.getItem('auth_token')).toBe('alice:oldpass'));
    await act(async () => {
      screen.getByText('ChangePassword').click();
    });
    await waitFor(() =>
      expect(localStorage.getItem('auth_token')).toBe('alice:newpass')
    );
  });
});

// Consumer for forceChangePassword tests
function ForceChangePasswordConsumer() {
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

describe('AuthContext – forceChangePassword', () => {
  it('sets mustChangePassword to false in user state', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({ ...mockUser, mustChangePassword: true })
      )
    );
    localStorage.setItem('auth_token', 'alice:oldpass');
    const { getByText, getByTestId } = render(
      <AuthProvider>
        <ForceChangePasswordConsumer />
      </AuthProvider>
    );
    await waitFor(() => expect(getByTestId('must-change')).toHaveTextContent('true'));
    await act(async () => { getByText('ForceChange').click(); });
    await waitFor(() => expect(getByTestId('must-change')).toHaveTextContent('false'));
  });

  it('updates the token with the new password', async () => {
    localStorage.setItem('auth_token', 'alice:oldpass');
    render(
      <AuthProvider>
        <ForceChangePasswordConsumer />
      </AuthProvider>
    );
    await waitFor(() => expect(localStorage.getItem('auth_token')).toBe('alice:oldpass'));
    await act(async () => {
      screen.getByText('ForceChange').click();
    });
    await waitFor(() =>
      expect(localStorage.getItem('auth_token')).toBe('alice:freshpass')
    );
  });
});

// Consumer for updateUser tests
function UpdateUserConsumer() {
  const { user, updateUser } = useAuth();
  const handle = () => updateUser({ name: 'Updated Name' });
  return (
    <div>
      <span data-testid="name">{user?.name ?? 'none'}</span>
      <button onClick={handle}>Update</button>
    </div>
  );
}

describe('AuthContext – updateUser', () => {
  it('merges the provided data into the current user state', async () => {
    localStorage.setItem('auth_token', 'valid-token');
    const { getByText, getByTestId } = render(
      <AuthProvider>
        <UpdateUserConsumer />
      </AuthProvider>
    );
    await waitFor(() => expect(getByTestId('name')).toHaveTextContent('Test User'));
    act(() => { getByText('Update').click(); });
    expect(getByTestId('name')).toHaveTextContent('Updated Name');
  });
});
