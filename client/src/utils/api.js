// Preconfigured axios instance: /api base URL, sends the httpOnly JWT cookie.
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true, // send httpOnly cookie with every request (incl. cross-origin in dev)
});

export default api;
