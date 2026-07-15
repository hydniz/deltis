// Preconfigured axios instance: /api base URL, sends the httpOnly JWT cookie.
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true, // send httpOnly cookie with every request (incl. cross-origin in dev)
});

// sessionStorage key: set on mid-session 401 so the login page can explain
// why the user landed there.
export const SESSION_EXPIRED_KEY = 'deltis-session-expired';

// Registered by AuthProvider. When any request fails with 401 mid-session
// (expired/invalidated cookie), the handler resets the auth state so
// ProtectedRoute redirects to the login page — instead of every page
// swallowing the error and rendering an empty state.
let onUnauthorized = null;
export const setUnauthorizedHandler = (handler) => { onUnauthorized = handler; };

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const url = err.config?.url || '';
    // A failed login attempt (wrong password) is handled by the login form.
    if (status === 401 && !url.includes('/auth/login')) {
      onUnauthorized?.();
    }
    return Promise.reject(err);
  }
);

export default api;
