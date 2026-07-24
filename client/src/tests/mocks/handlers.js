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
    return HttpResponse.json({
      version: '1.0.0+test123',
      apiVersion: 7,
      emergencyMode: false,
      updateFailed: false,
    });
  }),

  // Strava integration — unconfigured by default; tests that exercise the
  // integration override these handlers.
  http.get('/api/strava/status', () => {
    return HttpResponse.json({ configured: false, connected: false, connection: null, activityCount: 0 });
  }),
  http.get('/api/strava/sport-types', () => {
    return HttpResponse.json([]);
  }),
  http.get('/api/strava/activities', () => {
    return HttpResponse.json({ activities: [], total: 0 });
  }),
  http.get('/api/metrics', () => HttpResponse.json([])),
  http.get('/api/metrics/catalog', () => HttpResponse.json([])),
  http.get('/api/health/config', () => {
    return HttpResponse.json({
      connected: false,
      supportedTypes: ['exercise', 'weight', 'heartRate', 'steps', 'activeCalories', 'distance'],
      enabledTypes: [],
      backfillDays: 30,
      excludedOrigins: [],
      minBackfillDays: 7,
      maxBackfillDays: 365,
    });
  }),
  http.get('/api/training-types', () => {
    return HttpResponse.json([]);
  }),
  http.get('/api/planner/trainings', () => {
    return HttpResponse.json([]);
  }),

  // Cached update check (drives the sidebar badge).
  http.get('/api/admin/update/check', () => {
    return HttpResponse.json({ configured: false, checkedAt: new Date().toISOString() });
  }),

  // Self-registration is disabled by default (matches the server default).
  http.get('/api/auth/registration-status', () => {
    return HttpResponse.json({ enabled: false });
  }),

  // Session restore — returns mockUser when a valid cookie is present (simulated by default).
  // Override to HttpResponse.json({ error: '...' }, { status: 401 }) in tests that need no session.
  http.get('/api/auth/me', () => {
    return HttpResponse.json(mockUser);
  }),

  http.post('/api/auth/login', async ({ request }) => {
    const { identifier, password } = await request.json();
    if (!identifier) {
      return HttpResponse.json({ error: 'Benutzername erforderlich.' }, { status: 400 });
    }
    if (identifier === 'wronguser') {
      return HttpResponse.json({ error: 'Unbekannter Benutzername' }, { status: 401 });
    }
    if (password === 'wrongpassword') {
      return HttpResponse.json({ error: 'Falsches Passwort' }, { status: 401 });
    }
    return HttpResponse.json(mockUser);
  }),

  http.post('/api/auth/logout', () => {
    return HttpResponse.json({ ok: true });
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

  // First-installation wizard. Default: instance is already initialized.
  // Tests for the wizard override this with initNeeded: true + settings.
  http.get('/api/init/status', () => {
    return HttpResponse.json({ initNeeded: false, setupMode: false });
  }),

  http.post('/api/init', async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({
      ok: true,
      user: { ...mockAdminUser, username: body.username },
      applied: Object.keys(body.settings || {}),
      skipped: [],
      restartRequired: false,
    }, { status: 201 });
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
