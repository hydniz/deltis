const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createUser, authHeader } = require('./helpers/testApp');
const User = require('../models/User');
const ActivityType = require('../models/ActivityType');
const HabitDefinition = require('../models/HabitDefinition');

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

// A freshly created account that still has the setup wizard ahead of it.
async function createOnboardingUser() {
  const created = await createUser();
  await User.updateOne({ _id: created.user._id }, { onboardingPending: true });
  return created;
}

describe('PUT /api/auth/me/onboarding', () => {
  it('persists the current step so the wizard can resume', async () => {
    const { token } = await createOnboardingUser();

    const res = await request(app)
      .put('/api/auth/me/onboarding')
      .set(authHeader(token))
      .send({ step: 2 });
    expect(res.status).toBe(200);
    expect(res.body.onboardingStep).toBe(2);
    expect(res.body.onboardingPending).toBe(true);
  });

  it('marks the onboarding as completed', async () => {
    const { token } = await createOnboardingUser();

    const res = await request(app)
      .put('/api/auth/me/onboarding')
      .set(authHeader(token))
      .send({ completed: true });
    expect(res.status).toBe(200);
    expect(res.body.onboardingPending).toBe(false);
    expect(res.body.onboardedAt).toBeTruthy();
  });

  it('rejects the call once onboarding is completed', async () => {
    const { token } = await createOnboardingUser();
    await request(app).put('/api/auth/me/onboarding').set(authHeader(token)).send({ completed: true });

    const res = await request(app)
      .put('/api/auth/me/onboarding')
      .set(authHeader(token))
      .send({ step: 1 });
    expect(res.status).toBe(400);
  });

  it('ignores invalid step values', async () => {
    const { token } = await createOnboardingUser();

    const res = await request(app)
      .put('/api/auth/me/onboarding')
      .set(authHeader(token))
      .send({ step: 99 });
    expect(res.status).toBe(200);
    expect(res.body.onboardingStep).toBe(0);
  });
});

describe('GET /api/activity-types/defaults', () => {
  it('returns the predefined type list without creating anything', async () => {
    const { token, user } = await createOnboardingUser();

    const res = await request(app)
      .get('/api/activity-types/defaults')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.map(d => d.label)).toContain('Joggen');

    const count = await ActivityType.countDocuments({ userId: user._id });
    expect(count).toBe(0);
  });
});

describe('POST /api/activity-types/setup', () => {
  it('creates only the chosen predefined types', async () => {
    const { token } = await createOnboardingUser();

    const res = await request(app)
      .post('/api/activity-types/setup')
      .set(authHeader(token))
      .send({ labels: ['Joggen', 'Yoga'] });
    expect(res.status).toBe(201);
    expect(res.body.map(t => t.label).sort()).toEqual(['Joggen', 'Yoga']);
  });

  it('is idempotent and ignores unknown labels', async () => {
    const { token } = await createOnboardingUser();

    await request(app)
      .post('/api/activity-types/setup')
      .set(authHeader(token))
      .send({ labels: ['Joggen'] });
    const res = await request(app)
      .post('/api/activity-types/setup')
      .set(authHeader(token))
      .send({ labels: ['Joggen', 'Quidditch'] });
    expect(res.status).toBe(201);
    expect(res.body.map(t => t.label)).toEqual(['Joggen']);
  });
});

describe('GET /api/activity-types auto-seed gating', () => {
  it('does not auto-seed while onboarding is pending', async () => {
    const { token } = await createOnboardingUser();

    const res = await request(app)
      .get('/api/activity-types')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('does not auto-seed after onboarding chose an empty set', async () => {
    const { token } = await createOnboardingUser();
    await request(app).put('/api/auth/me/onboarding').set(authHeader(token)).send({ completed: true });

    const res = await request(app)
      .get('/api/activity-types')
      .set(authHeader(token));
    expect(res.body).toEqual([]);
  });

  it('still auto-seeds defaults for legacy accounts', async () => {
    const { token } = await createUser();

    const res = await request(app)
      .get('/api/activity-types')
      .set(authHeader(token));
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.map(t => t.label)).toContain('Joggen');
  });
});

describe('habit selection after onboarding', () => {
  it('treats an explicitly saved empty selection as "none selected"', async () => {
    const { token } = await createUser();
    await HabitDefinition.create({
      userId: null, name: 'Wasser', unitSymbol: 'ml', type: 'amount',
      isPredefined: true, version: 1, nameHistory: [],
    });

    // Before any selection: everything counts as selected (legacy default)
    let res = await request(app).get('/api/habits/definitions').set(authHeader(token));
    expect(res.body[0].selected).toBe(true);

    await request(app)
      .put('/api/habits/selection')
      .set(authHeader(token))
      .send({ selectedIds: [] });

    res = await request(app).get('/api/habits/definitions').set(authHeader(token));
    expect(res.body[0].selected).toBe(false);
  });
});
