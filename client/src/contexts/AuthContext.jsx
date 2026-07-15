// Global authentication state: current user, login/logout and profile update
// helpers backed by the /api/auth endpoints.
import { createContext, useContext, useState, useEffect } from 'react';
import api from '../utils/api';
import { clearSessionGreeting } from '../utils/greetings';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session from httpOnly cookie on mount.
  // If the cookie is missing or expired the server returns 401 — stay logged out.
  useEffect(() => {
    api.get('/auth/me')
      .then(res => setUser(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Verifies credentials once server-side and receives a 30-day httpOnly JWT cookie.
  const login = async (identifier, password = null) => {
    const res = await api.post('/auth/login', { identifier, password });
    setUser(res.data);
    return res.data;
  };

  // Clears user state immediately; asks server to clear the cookie in the background.
  const logout = () => {
    api.post('/auth/logout').catch(() => {});
    clearSessionGreeting(); // next login gets a fresh dashboard greeting
    setUser(null);
  };

  const updateUser = (data) => setUser(prev => ({ ...prev, ...data }));

  // Sets username (and password for first-time setup).
  // The JWT stays valid — it is tied to userId, not the identifier.
  const setUsername = async (username, password = null) => {
    const res = await api.put('/auth/me/username', { username, password });
    setUser(res.data);
    return res.data;
  };

  // Changes the password. The existing JWT remains valid.
  const changePassword = async (currentPassword, newPassword) => {
    await api.put('/auth/me/password', { currentPassword, newPassword });
  };

  // Forced password change: only callable when user.mustChangePassword is true.
  const forceChangePassword = async (newPassword) => {
    await api.put('/auth/me/password/forced', { newPassword });
    setUser(prev => ({ ...prev, mustChangePassword: false }));
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser, setUsername, changePassword, forceChangePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
