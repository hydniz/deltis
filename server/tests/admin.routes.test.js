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

describe('GET /api/admin/setup-status', () => {
  it('returns setupNeeded=true when no admin exists', async () => {
    const res = await request(app).get('/api/admin/setup-status');
    expect(res.status).toBe(200);
    expect(res.body.setupNeeded).toBe(false);
  });

  it('returns setupNeeded=true and adminUuid when admin has no password set', async () => {
    const User = require('../models/User');
    const crypto = require('crypto');
    const uuid = crypto.randomUUID();
    await User.create({ uuid, name: 'Admin', isAdmin: true });

    const res = await request(app).get('/api/admin/setup-status');
    expect(res.status).toBe(200);
    expect(res.body.setupNeeded).toBe(true);
    expect(res.body.adminUuid).toBe(uuid);
  });

  it('returns setupNeeded=false and no UUID when admin is fully set up', async () => {
    await createAdminUser();
    const res = await request(app).get('/api/admin/setup-status');
    expect(res.status).toBe(200);
    expect(res.body.setupNeeded).toBe(false);
    expect(res.body.adminUuid).toBeNull();
  });
});

describe('POST /api/admin/setup', () => {
  it('sets the admin password during first-time setup', async () => {
    const User = require('../models/User');
    const crypto = require('crypto');
    const uuid = crypto.randomUUID();
    await User.create({ uuid, name: 'Admin', isAdmin: true });

    const res = await request(app)
      .post('/api/admin/setup')
      .send({ password: 'newsecret1' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejects a password shorter than 8 characters', async () => {
    const User = require('../models/User');
    const crypto = require('crypto');
    const uuid = crypto.randomUUID();
    await User.create({ uuid, name: 'Admin', isAdmin: true });

    const res = await request(app)
      .post('/api/admin/setup')
      .send({ password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8/);
  });

  it('returns 400 if setup is already completed', async () => {
    await createAdminUser();
    const res = await request(app)
      .post('/api/admin/setup')
      .send({ password: 'anothersecret1' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/admin/password', () => {
  it('allows the admin to change their password', async () => {
    const { token } = await createAdminUser({ password: 'oldpassword1' });
    const res = await request(app)
      .put('/api/admin/password')
      .set(authHeader(token))
      .send({ currentPassword: 'oldpassword1', newPassword: 'newpassword1' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 401 when the current password is wrong', async () => {
    const { token } = await createAdminUser({ password: 'correctpassword1' });
    const res = await request(app)
      .put('/api/admin/password')
      .set(authHeader(token))
      .send({ currentPassword: 'wrongpassword', newPassword: 'newpassword1' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when new password is too short', async () => {
    const { token } = await createAdminUser({ password: 'correctpassword1' });
    const res = await request(app)
      .put('/api/admin/password')
      .set(authHeader(token))
      .send({ currentPassword: 'correctpassword1', newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  it('returns 403 when a regular user tries to change the admin password', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .put('/api/admin/password')
      .set(authHeader(token))
      .send({ currentPassword: 'any', newPassword: 'newpassword1' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/users', () => {
  it('returns list of all users for an admin', async () => {
    const { token } = await createAdminUser();
    await createUser({ name: 'Alice' });
    await createUser({ name: 'Bob' });

    const res = await request(app)
      .get('/api/admin/users')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(3);
  });

  it('returns 403 for a regular user', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .get('/api/admin/users')
      .set(authHeader(token));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/users', () => {
  it('creates a new user with an auto-generated UUID', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/users')
      .set(authHeader(token))
      .send({ name: 'New User' });
    expect(res.status).toBe(201);
    expect(res.body.uuid).toBeDefined();
    expect(res.body.name).toBe('New User');
  });

  it('generates a default name when none is provided', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/users')
      .set(authHeader(token))
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.name).toBeDefined();
  });

  it('returns 403 for a regular user', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .post('/api/admin/users')
      .set(authHeader(token))
      .send({ name: 'Hacker' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/admin/users/:id', () => {
  it('deletes a regular user', async () => {
    const { token } = await createAdminUser();
    const { user } = await createUser({ name: 'To Delete' });

    const res = await request(app)
      .delete(`/api/admin/users/${user._id}`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 404 for a non-existent user', async () => {
    const { token } = await createAdminUser();
    const fakeId = '507f1f77bcf86cd799439011';
    const res = await request(app)
      .delete(`/api/admin/users/${fakeId}`)
      .set(authHeader(token));
    expect(res.status).toBe(404);
  });

  it('prevents deleting the admin account', async () => {
    const { token, user } = await createAdminUser();
    const res = await request(app)
      .delete(`/api/admin/users/${user._id}`)
      .set(authHeader(token));
    expect(res.status).toBe(400);
  });
});
