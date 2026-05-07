import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(config => {
  const uuid = localStorage.getItem('uuid');
  if (uuid) config.headers.Authorization = `Bearer ${uuid}`;
  return config;
});

export default api;
