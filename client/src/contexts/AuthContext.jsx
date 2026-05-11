import { createContext, useContext, useState, useEffect } from 'react';
import api from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      api.get('/auth/me')
        .then(res => setUser(res.data))
        .catch(() => localStorage.removeItem('auth_token'))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  // identifier: username or UUID
  // password: regular user password (null for UUID-only migration login or admin)
  // adminSecret: only for admin login
  const login = async (identifier, password = null, adminSecret = null) => {
    let token;
    if (adminSecret) {
      token = `${identifier}:${adminSecret}`;
    } else if (password) {
      token = `${identifier}:${password}`;
    } else {
      token = identifier;
    }
    localStorage.setItem('auth_token', token);
    try {
      const res = await api.get('/auth/me');
      setUser(res.data);
      return res.data;
    } catch (err) {
      localStorage.removeItem('auth_token');
      throw err;
    }
  };

  const logout = () => {
    localStorage.removeItem('auth_token');
    setUser(null);
  };

  const updateUser = (data) => setUser(prev => ({ ...prev, ...data }));

  // Sets username (and password for non-admin initial setup).
  // Updates localStorage token so future requests use the new credentials.
  const setUsername = async (username, password = null) => {
    const res = await api.put('/auth/me/username', { username, password });
    const updatedUser = res.data;
    setUser(updatedUser);

    const currentToken = localStorage.getItem('auth_token') || '';
    const colonIdx = currentToken.indexOf(':');
    const existingSecret = colonIdx !== -1 ? currentToken.slice(colonIdx + 1) : null;

    // Use new password if provided (initial setup), otherwise keep existing secret (admin or username change)
    const secret = password || existingSecret;
    const newToken = secret
      ? `${updatedUser.username}:${secret}`
      : updatedUser.username;
    localStorage.setItem('auth_token', newToken);
    return updatedUser;
  };

  // Changes the password (requires current password) and updates the localStorage token
  const changePassword = async (currentPassword, newPassword) => {
    await api.put('/auth/me/password', { currentPassword, newPassword });
    const currentToken = localStorage.getItem('auth_token') || '';
    const colonIdx = currentToken.indexOf(':');
    const identifier = colonIdx !== -1 ? currentToken.slice(0, colonIdx) : currentToken;
    localStorage.setItem('auth_token', `${identifier}:${newPassword}`);
  };

  // Forced password change: only callable when user.mustChangePassword is true.
  // Does not require current password.
  const forceChangePassword = async (newPassword) => {
    await api.put('/auth/me/password/forced', { newPassword });
    setUser(prev => ({ ...prev, mustChangePassword: false }));
    const currentToken = localStorage.getItem('auth_token') || '';
    const colonIdx = currentToken.indexOf(':');
    const identifier = colonIdx !== -1 ? currentToken.slice(0, colonIdx) : currentToken;
    localStorage.setItem('auth_token', `${identifier}:${newPassword}`);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser, setUsername, changePassword, forceChangePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
