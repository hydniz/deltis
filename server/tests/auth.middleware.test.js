const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createUser, createUserWithPassword, createAdminUser, authHeader } = require('./helpers/testApp');

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

    it('returns 401 for an unknown identifier', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer nobody');
      expect(res.status).toBe(401);
    });
  });

  describe('migration mode (UUID only, no username, no password)', () => {
    it('allows access with a valid user UUID when no username is set', async () => {
      const { token } = await createUser();
      const res = await request(app)
        .get('/api/auth/me')
        .set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.uuid).toBeDefined();
    });
  });

  describe('UUID blocked after migration', () => {
    it('returns 401 with UUID_BLOCKED code when UUID is used after username is set', async () => {
      const { uuid } = await createUserWithPassword({ username: 'alice', password: 'password123' });
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${uuid}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UUID_BLOCKED');
    });
  });

  describe('username + password authentication', () => {
    it('allows access with valid username and password', async () => {
      const { token } = await createUserWithPassword({ username: 'alice', password: 'password123' });
      const res = await request(app)
        .get('/api/auth/me')
        .set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.username).toBe('alice');
    });

    it('returns 401 with PASSWORD_REQUIRED when password is omitted', async () => {
      const { username } = await createUserWithPassword({ username: 'alice', password: 'password123' });
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${username}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('PASSWORD_REQUIRED');
    });

    it('returns 401 for a wrong password', async () => {
      const { username } = await createUserWithPassword({ username: 'alice', password: 'password123' });
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${username}:wrongpassword`);
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Falsches Passwort/);
    });
  });

  describe('admin authentication', () => {
    it('returns 401 when admin identifier is used without a secret', async () => {
      const { uuid } = await createAdminUser();
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${uuid}`);
      expect(res.status).toBe(401);
    });

    it('returns 401 for a wrong admin secret', async () => {
      const { uuid } = await createAdminUser({ password: 'correct-secret1' });
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${uuid}:wrongsecret`);
      expect(res.status).toBe(401);
    });

    it('allows access with the correct UUID and admin secret', async () => {
      const { token } = await createAdminUser({ password: 'correct-secret1' });
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
      expect(res.body.passwordHash).toBeUndefined();
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

    it('does not expose adminSecretHash or passwordHash in response', async () => {
      const { token } = await createAdminUser();
      const res = await request(app)
        .put('/api/auth/me')
        .set(authHeader(token))
        .send({ name: 'Admin Updated' });
      expect(res.status).toBe(200);
      expect(res.body.adminSecretHash).toBeUndefined();
      expect(res.body.passwordHash).toBeUndefined();
    });
  });

  describe('PUT /api/auth/me/username', () => {
    it('sets username and password for a migration user (initial setup)', async () => {
      const { token } = await createUser();
      const res = await request(app)
        .put('/api/auth/me/username')
        .set(authHeader(token))
        .send({ username: 'newuser', password: 'strongpass1' });
      expect(res.status).toBe(200);
      expect(res.body.username).toBe('newuser');
      expect(res.body.passwordHash).toBeUndefined();
    });

    it('allows admin to set username without providing a password', async () => {
      const { token } = await createAdminUser();
      const res = await request(app)
        .put('/api/auth/me/username')
        .set(authHeader(token))
        .send({ username: 'adminuser' });
      expect(res.status).toBe(200);
      expect(res.body.username).toBe('adminuser');
    });

    it('allows a user with existing passwordHash to change username without password', async () => {
      const { token } = await createUserWithPassword({ username: 'oldname', password: 'pass1234' });
      const res = await request(app)
        .put('/api/auth/me/username')
        .set(authHeader(token))
        .send({ username: 'newname' });
      expect(res.status).toBe(200);
      expect(res.body.username).toBe('newname');
    });

    it('normalizes username to lowercase', async () => {
      const { token } = await createUser();
      const res = await request(app)
        .put('/api/auth/me/username')
        .set(authHeader(token))
        .send({ username: 'MyUser', password: 'strongpass1' });
      expect(res.status).toBe(200);
      expect(res.body.username).toBe('myuser');
    });

    it('returns 400 when username is missing', async () => {
      const { token } = await createUser();
      const res = await request(app)
        .put('/api/auth/me/username')
        .set(authHeader(token))
        .send({ password: 'strongpass1' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when username is shorter than 3 characters', async () => {
      const { token } = await createUser();
      const res = await request(app)
        .put('/api/auth/me/username')
        .set(authHeader(token))
        .send({ username: 'ab', password: 'strongpass1' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when username exceeds 30 characters', async () => {
      const { token } = await createUser();
      const res = await request(app)
        .put('/api/auth/me/username')
        .set(authHeader(token))
        .send({ username: 'a'.repeat(31), password: 'strongpass1' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when username contains invalid characters', async () => {
      const { token } = await createUser();
      const res = await request(app)
        .put('/api/auth/me/username')
        .set(authHeader(token))
        .send({ username: 'bad user!', password: 'strongpass1' });
      expect(res.status).toBe(400);
    });

    it('returns 409 when username is already taken by another user', async () => {
      await createUserWithPassword({ username: 'taken', password: 'pass1234' });
      const { token } = await createUser();
      const res = await request(app)
        .put('/api/auth/me/username')
        .set(authHeader(token))
        .send({ username: 'taken', password: 'strongpass1' });
      expect(res.status).toBe(409);
    });

    it('returns 400 when migration user provides no password', async () => {
      const { token } = await createUser();
      const res = await request(app)
        .put('/api/auth/me/username')
        .set(authHeader(token))
        .send({ username: 'validuser' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Passwort erforderlich/);
    });

    it('returns 400 when migration user provides a password shorter than 8 characters', async () => {
      const { token } = await createUser();
      const res = await request(app)
        .put('/api/auth/me/username')
        .set(authHeader(token))
        .send({ username: 'validuser', password: 'short' });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/auth/me/password', () => {
    it('changes the password successfully', async () => {
      const { token } = await createUserWithPassword({ username: 'alice', password: 'oldpass123' });
      const res = await request(app)
        .put('/api/auth/me/password')
        .set(authHeader(token))
        .send({ currentPassword: 'oldpass123', newPassword: 'newpass456' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('returns 400 for admin users', async () => {
      const { token } = await createAdminUser();
      const res = await request(app)
        .put('/api/auth/me/password')
        .set(authHeader(token))
        .send({ currentPassword: 'anything', newPassword: 'newpass456' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when currentPassword is missing', async () => {
      const { token } = await createUserWithPassword({ username: 'alice', password: 'oldpass123' });
      const res = await request(app)
        .put('/api/auth/me/password')
        .set(authHeader(token))
        .send({ newPassword: 'newpass456' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when newPassword is missing', async () => {
      const { token } = await createUserWithPassword({ username: 'alice', password: 'oldpass123' });
      const res = await request(app)
        .put('/api/auth/me/password')
        .set(authHeader(token))
        .send({ currentPassword: 'oldpass123' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when newPassword is shorter than 8 characters', async () => {
      const { token } = await createUserWithPassword({ username: 'alice', password: 'oldpass123' });
      const res = await request(app)
        .put('/api/auth/me/password')
        .set(authHeader(token))
        .send({ currentPassword: 'oldpass123', newPassword: 'short' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when no passwordHash is set yet', async () => {
      const { token } = await createUser();
      const res = await request(app)
        .put('/api/auth/me/password')
        .set(authHeader(token))
        .send({ currentPassword: 'anything', newPassword: 'newpass456' });
      expect(res.status).toBe(400);
    });

    it('returns 401 when currentPassword is wrong', async () => {
      const { token } = await createUserWithPassword({ username: 'alice', password: 'correctpass' });
      const res = await request(app)
        .put('/api/auth/me/password')
        .set(authHeader(token))
        .send({ currentPassword: 'wrongpass', newPassword: 'newpass456' });
      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/auth/me/password/forced', () => {
    it('changes password when mustChangePassword is true', async () => {
      const { token } = await createUserWithPassword({
        username: 'alice',
        password: 'oldpass123',
        mustChangePassword: true,
      });
      const res = await request(app)
        .put('/api/auth/me/password/forced')
        .set(authHeader(token))
        .send({ newPassword: 'freshpass99' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('returns 400 when mustChangePassword is false', async () => {
      const { token } = await createUserWithPassword({ username: 'alice', password: 'pass1234' });
      const res = await request(app)
        .put('/api/auth/me/password/forced')
        .set(authHeader(token))
        .send({ newPassword: 'freshpass99' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/kein erzwungener/i);
    });

    it('returns 400 when newPassword is too short', async () => {
      const { token } = await createUserWithPassword({
        username: 'alice',
        password: 'oldpass123',
        mustChangePassword: true,
      });
      const res = await request(app)
        .put('/api/auth/me/password/forced')
        .set(authHeader(token))
        .send({ newPassword: 'short' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when newPassword is missing', async () => {
      const { token } = await createUserWithPassword({
        username: 'alice',
        password: 'oldpass123',
        mustChangePassword: true,
      });
      const res = await request(app)
        .put('/api/auth/me/password/forced')
        .set(authHeader(token))
        .send({});
      expect(res.status).toBe(400);
    });
  });
});
