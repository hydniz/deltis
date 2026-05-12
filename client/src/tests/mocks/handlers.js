import { http, HttpResponse } from 'msw';

export const mockUser = {
  _id: 'user-123',
  uuid: 'aaaa-bbbb-cccc-dddd',
  username: 'testuser',
  name: 'Test User',
  isAdmin: false,
  hasPassword: true,
  mustChangePassword: false,
  weightUnit: 'kg',
};

export const mockAdminUser = {
  _id: 'admin-456',
  uuid: 'admin-uuid-1234',
  name: 'Admin',
  isAdmin: true,
  hasPassword: true,
  weightUnit: 'kg',
};

export const handlers = [
  http.get('/api', () => {
    return HttpResponse.json({ version: '1.0.0+test123' });
  }),

  http.get('/api/auth/me', ({ request }) => {
    const auth = request.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) {
      return HttpResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });
    }
    const token = auth.slice(7);
    if (token === 'invalid-token') {
      return HttpResponse.json({ error: 'Ungültige UUID' }, { status: 401 });
    }
    if (token.includes(':admin')) {
      return HttpResponse.json(mockAdminUser);
    }
    return HttpResponse.json(mockUser);
  }),

  http.put('/api/auth/me', async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({ ...mockUser, ...body });
  }),

  http.put('/api/auth/me/username', async ({ request }) => {
    const body = await request.json();
    const username = (body.username || '').trim().toLowerCase();
    return HttpResponse.json({ ...mockUser, username });
  }),

  http.put('/api/auth/me/password', async () => {
    return HttpResponse.json({ ok: true });
  }),

  http.put('/api/auth/me/password/forced', async () => {
    return HttpResponse.json({ ok: true });
  }),

  http.get('/api/admin/setup-status', () => {
    return HttpResponse.json({ setupNeeded: false, adminUuid: null });
  }),

  http.get('/api/habits/definitions', () => {
    return HttpResponse.json([
      { _id: 'h1', name: 'Water', unitSymbol: 'ml', type: 'amount', selected: true },
      { _id: 'h2', name: 'Sleep', unitSymbol: 'h', type: 'duration', selected: true },
    ]);
  }),

  http.get('/api/activities', () => {
    return HttpResponse.json({ activities: [], total: 0 });
  }),

  http.get('/api/weight', () => {
    return HttpResponse.json([]);
  }),

  http.get('/api/goals', () => {
    return HttpResponse.json([]);
  }),

  http.get('/api/planner', () => {
    return HttpResponse.json([]);
  }),

  http.get('/api/planner/habits', () => {
    return HttpResponse.json([]);
  }),

  http.get('/api/habits/logs', () => {
    return HttpResponse.json([]);
  }),

  http.get('/api/activity-types', () => {
    return HttpResponse.json([]);
  }),
];
