const request = require('supertest');
const jwt = require('jsonwebtoken');
const {
  startDb, stopDb, clearDb, buildApp,
  createUser, createUserWithPassword, createAdminUser, authHeader,
} = require('./helpers/testApp');

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

// Auth Middleware
// Tests that the per-request JWT cookie check works correctly.
// Credential validation (wrong password, UUID_BLOCKED, etc.) is tested in
// the "POST /api/auth/login" section below.

describe('Auth Middleware', () => {
  describe('missing or invalid cookie', () => {
    it('returns 401 when no cookie is present', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('returns 401 for a garbage (non-JWT) cookie value', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', 'auth_token=not-a-jwt');
      expect(res.status).toBe(401);
    });

    it('returns 401 for a JWT signed with the wrong secret', async () => {
      const { user } = await createUser();
      const badToken = jwt.sign({ userId: user._id }, 'wrong-secret', { expiresIn: '1h' });
      const res = await request(app)
        .get('/api/auth/me')
        .set(authHeader(badToken));
      expect(res.status).toBe(401);
    });

    it('returns 401 for a valid JWT whose user no longer exists', async () => {
      const { user, token } = await createUser();
      const User = require('../models/User');
      await User.findByIdAndDelete(user._id);
      const res = await request(app)
        .get('/api/auth/me')
        .set(authHeader(token));
      expect(res.status).toBe(401);
    });
  });

  describe('valid JWT cookie', () => {
    it('grants access for a regular user', async () => {
      const { token } = await createUser({ name: 'Alice' });
      const res = await request(app)
        .get('/api/auth/me')
        .set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Alice');
    });

    it('grants access for an admin user', async () => {
      const { token } = await createAdminUser();
      const res = await request(app)
        .get('/api/auth/me')
        .set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.isAdmin).toBe(true);
    });

    it('grants access for a user with username + password set', async () => {
      const { token } = await createUserWithPassword({ username: 'alice' });
      const res = await request(app)
        .get('/api/auth/me')
        .set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.username).toBe('alice');
    });
  });
});

// POST /api/auth/login

describe('POST /api/auth/login', () => {
  it('sets an httpOnly cookie and returns the user on valid credentials', async () => {
    await createUserWithPassword({ username: 'alice', password: 'pass1234' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'alice', password: 'pass1234' });
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('alice');
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/auth_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    // Over plain HTTP the cookie must NOT be Secure, otherwise the browser
    // drops it and a self-hosted HTTP instance can never stay logged in.
    expect(cookie).not.toMatch(/Secure/i);
  });

  it('allows login for a migration user (UUID only, no password set)', async () => {
    const { uuid } = await createUser();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: uuid, password: null });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']?.[0]).toMatch(/auth_token=/);
  });

  it('returns 401 with UUID_BLOCKED when UUID is used after username is set', async () => {
    const { uuid } = await createUserWithPassword({ username: 'alice', password: 'pass1234' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: uuid, password: 'pass1234' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UUID_BLOCKED');
  });

  it('returns 401 with PASSWORD_REQUIRED when user has a password but none was provided', async () => {
    await createUserWithPassword({ username: 'alice', password: 'pass1234' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'alice' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('PASSWORD_REQUIRED');
  });

  it('returns 401 for a wrong password', async () => {
    await createUserWithPassword({ username: 'alice', password: 'correctpass' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'alice', password: 'wrongpass' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Falsches Passwort/);
  });

  it('returns 401 for an unknown identifier', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'nobody', password: 'anything' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when identifier is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'pass1234' });
    expect(res.status).toBe(400);
  });
});

// POST /api/auth/logout

describe('POST /api/auth/logout', () => {
  it('clears the auth_token cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/auth_token=/);
    expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/i);
  });
});

// GET /api/auth/me

describe('GET /api/auth/me', () => {
  it('returns the current user profile without sensitive fields', async () => {
    const { token } = await createUser({ name: 'Alice' });
    const res = await request(app)
      .get('/api/auth/me')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Alice');
    expect(res.body.adminSecretHash).toBeUndefined();
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('includes hasPassword=false for migration user without credentials', async () => {
    const { token } = await createUser();
    const res = await request(app).get('/api/auth/me').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.hasPassword).toBe(false);
  });

  it('includes hasPassword=true for user with password', async () => {
    const { token } = await createUserWithPassword({ username: 'alice', password: 'pass1234' });
    const res = await request(app).get('/api/auth/me').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.hasPassword).toBe(true);
  });

  it('includes hasPassword=true for admin', async () => {
    const { token } = await createAdminUser();
    const res = await request(app).get('/api/auth/me').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.hasPassword).toBe(true);
  });
});

// PUT /api/auth/me

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

// PUT /api/auth/me/username

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

  it('allows user with existing passwordHash to set username without password', async () => {
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

// PUT /api/auth/me/password

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

  it('allows admin to change password', async () => {
    const { token } = await createAdminUser({ password: 'oldpass123' });
    const res = await request(app)
      .put('/api/auth/me/password')
      .set(authHeader(token))
      .send({ currentPassword: 'oldpass123', newPassword: 'newpass456' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
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

// PUT /api/auth/me/password/forced

describe('PUT /api/auth/me/password/forced', () => {
  it('changes password when mustChangePassword is true', async () => {
    const { token } = await createUserWithPassword({
      username: 'alice', password: 'oldpass123', mustChangePassword: true,
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
      username: 'alice', password: 'oldpass123', mustChangePassword: true,
    });
    const res = await request(app)
      .put('/api/auth/me/password/forced')
      .set(authHeader(token))
      .send({ newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when newPassword is missing', async () => {
    const { token } = await createUserWithPassword({
      username: 'alice', password: 'oldpass123', mustChangePassword: true,
    });
    const res = await request(app)
      .put('/api/auth/me/password/forced')
      .set(authHeader(token))
      .send({});
    expect(res.status).toBe(400);
  });
});
