const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createUser, createAdminUser, authHeader } = require('./helpers/testApp');

let app;

beforeAll(async () => {
  await startDb();
  app = buildApp();
});

afterEach(async () => {
  await clearDb();
});

afterAll(async () => {
  await stopDb();
});

describe('Auth Middleware', () => {
  describe('missing / malformed token', () => {
    it('returns 401 when no Authorization header is sent', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    it('returns 401 when Authorization header does not start with Bearer', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Basic sometoken');
      expect(res.status).toBe(401);
    });

    it('returns 401 for an unknown UUID', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer 00000000-0000-0000-0000-000000000000');
      expect(res.status).toBe(401);
    });
  });

  describe('regular user authentication', () => {
    it('allows access with a valid user UUID', async () => {
      const { token } = await createUser();
      const res = await request(app)
        .get('/api/auth/me')
        .set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.uuid).toBeDefined();
    });
  });

  describe('admin authentication', () => {
    it('returns 401 when admin UUID is used without a secret', async () => {
      const { uuid } = await createAdminUser();
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${uuid}`);
      expect(res.status).toBe(401);
    });

    it('returns 401 for a wrong admin password', async () => {
      const { uuid } = await createAdminUser({ password: 'correct-password1' });
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${uuid}:wrongpassword`);
      expect(res.status).toBe(401);
    });

    it('allows access with the correct UUID and password', async () => {
      const { token } = await createAdminUser({ password: 'correct-password1' });
      const res = await request(app)
        .get('/api/auth/me')
        .set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.isAdmin).toBe(true);
    });
  });
});

describe('Auth Routes', () => {
  describe('GET /api/auth/me', () => {
    it('returns the current user profile', async () => {
      const { token } = await createUser({ name: 'Alice' });
      const res = await request(app)
        .get('/api/auth/me')
        .set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Alice');
      expect(res.body.adminSecretHash).toBeUndefined();
    });
  });

  describe('PUT /api/auth/me', () => {
    it('updates name and weightUnit', async () => {
      const { token } = await createUser({ name: 'Old Name' });
      const res = await request(app)
        .put('/api/auth/me')
        .set(authHeader(token))
        .send({ name: 'New Name', weightUnit: 'lbs' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('New Name');
      expect(res.body.weightUnit).toBe('lbs');
    });

    it('does not expose adminSecretHash in response', async () => {
      const { token } = await createAdminUser();
      const res = await request(app)
        .put('/api/auth/me')
        .set(authHeader(token))
        .send({ name: 'Admin Updated' });
      expect(res.status).toBe(200);
      expect(res.body.adminSecretHash).toBeUndefined();
    });
  });
});
