const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createUser, authHeader } = require('./helpers/testApp');
const StravaActivity = require('../models/StravaActivity');

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

// "3× Cardio pro Woche": Run/Ride/Swim of at least 20 minutes
const CARDIO_CRITERIA = {
  operator: 'AND',
  rules: [
    { kind: 'sportType', values: ['Run', 'Ride', 'Swim'] },
    { kind: 'metricRange', metric: 'movingTime', min: 20 },
  ],
};

function goalPayload(overrides = {}) {
  return {
    name: '3× Cardio pro Woche',
    type: 'periodic-strava',
    intervalValue: 1,
    intervalUnit: 'week',
    targetRef: 'strava',
    targetRefModel: 'StravaActivity',
    condition: 'min',
    targetValue: 3,
    metric: 'count',
    stravaCriteria: CARDIO_CRITERIA,
    ...overrides,
  };
}

async function seedActivity(userId, overrides = {}) {
  return StravaActivity.create({
    userId,
    stravaId: Math.floor(Math.random() * 1e9),
    sportType: 'Run',
    type: 'Run',
    startDate: new Date(),
    movingTime: 1800, // 30 min
    distance: 5000,
    ...overrides,
  });
}

describe('POST /api/goals (Strava)', () => {
  it('creates a Strava goal with criteria and enriches it with targetName', async () => {
    const { token } = await createUser();
    const res = await request(app).post('/api/goals').set(authHeader(token)).send(goalPayload());
    expect(res.status).toBe(201);
    expect(res.body.targetRefModel).toBe('StravaActivity');
    expect(res.body.targetName).toBe('Strava');
    expect(res.body.stravaCriteria).toEqual(CARDIO_CRITERIA);
  });

  it('rejects invalid criteria with a helpful error', async () => {
    const { token } = await createUser();
    const res = await request(app).post('/api/goals').set(authHeader(token)).send(goalPayload({
      stravaCriteria: { operator: 'AND', rules: [{ kind: 'unbekannt' }] },
    }));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Ungültige Strava-Kriterien');
  });

  it('rejects invalid criteria on update as well', async () => {
    const { token } = await createUser();
    const created = await request(app).post('/api/goals').set(authHeader(token)).send(goalPayload());
    const res = await request(app)
      .put(`/api/goals/${created.body._id}`)
      .set(authHeader(token))
      .send({ stravaCriteria: { operator: 'NOPE', rules: [] } });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/goals/:id/progress (Strava)', () => {
  it('counts only activities matching the criteria within the interval', async () => {
    const { token, user } = await createUser();
    const created = await request(app).post('/api/goals').set(authHeader(token)).send(goalPayload());

    await seedActivity(user._id); // Run 30 min → counts
    await seedActivity(user._id, { sportType: 'Ride', type: 'Ride' }); // counts
    await seedActivity(user._id, { movingTime: 600 }); // 10 min → too short
    await seedActivity(user._id, { sportType: 'WeightTraining', type: 'Workout' }); // wrong sport
    await seedActivity(user._id, { startDate: new Date('2020-01-01') }); // outside interval

    const res = await request(app)
      .get(`/api/goals/${created.body._id}/progress`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.conditions[0].currentValue).toBe(2);
    expect(res.body.met).toBe(false); // 2 of 3

    await seedActivity(user._id, { sportType: 'Swim', type: 'Swim' });
    const after = await request(app)
      .get(`/api/goals/${created.body._id}/progress`)
      .set(authHeader(token));
    expect(after.body.conditions[0].currentValue).toBe(3);
    expect(after.body.met).toBe(true);
  });

  it('ignores other users\' Strava activities', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    const created = await request(app).post('/api/goals').set(authHeader(token)).send(goalPayload());
    await seedActivity(other._id);

    const res = await request(app)
      .get(`/api/goals/${created.body._id}/progress`)
      .set(authHeader(token));
    expect(res.body.conditions[0].currentValue).toBe(0);
  });

  it('supports duration and distance metrics over the matching set', async () => {
    const { token, user } = await createUser();
    await seedActivity(user._id, { movingTime: 1800, distance: 5000 });
    await seedActivity(user._id, { movingTime: 3600, distance: 10000, sportType: 'Ride', type: 'Ride' });
    await seedActivity(user._id, { movingTime: 6000, distance: 42000, sportType: 'Hike', type: 'Hike' }); // filtered out

    const durationGoal = await request(app).post('/api/goals').set(authHeader(token)).send(goalPayload({
      name: '90 Cardio-Minuten', metric: 'duration', targetValue: 90,
    }));
    const durationRes = await request(app)
      .get(`/api/goals/${durationGoal.body._id}/progress`)
      .set(authHeader(token));
    expect(durationRes.body.conditions[0].currentValue).toBe(90); // 30 + 60 min
    expect(durationRes.body.met).toBe(true);

    const distanceGoal = await request(app).post('/api/goals').set(authHeader(token)).send(goalPayload({
      name: '20 km', metric: 'distance', targetValue: 20,
    }));
    const distanceRes = await request(app)
      .get(`/api/goals/${distanceGoal.body._id}/progress`)
      .set(authHeader(token));
    expect(distanceRes.body.conditions[0].currentValue).toBe(15); // 5 + 10 km
    expect(distanceRes.body.met).toBe(false);
  });

  it('counts every Strava activity when no criteria are set', async () => {
    const { token, user } = await createUser();
    const created = await request(app).post('/api/goals').set(authHeader(token)).send(goalPayload({
      stravaCriteria: null,
    }));
    await seedActivity(user._id);
    await seedActivity(user._id, { sportType: 'Yoga', type: 'Yoga', movingTime: 60 });

    const res = await request(app)
      .get(`/api/goals/${created.body._id}/progress`)
      .set(authHeader(token));
    expect(res.body.conditions[0].currentValue).toBe(2);
  });

  it('evaluates HR-stream criteria (Zone-2 example) in progress', async () => {
    const { token, user } = await createUser();
    const zone2 = {
      operator: 'AND',
      rules: [
        { kind: 'sportType', values: ['Run', 'Swim', 'Ride'] },
        { kind: 'hrPercentInRange', minHr: 120, maxHr: 145, minPercent: 85 },
      ],
    };
    const created = await request(app).post('/api/goals').set(authHeader(token)).send(goalPayload({
      stravaCriteria: zone2, targetValue: 1,
    }));

    // 100 % of samples at 130 bpm → matches
    await seedActivity(user._id, {
      streams: { heartrate: { data: Array(30).fill(130) }, time: { data: Array.from({ length: 30 }, (_, i) => i) } },
    });
    // Hard run at 170 bpm → no match
    await seedActivity(user._id, {
      streams: { heartrate: { data: Array(30).fill(170) }, time: { data: Array.from({ length: 30 }, (_, i) => i) } },
    });

    const res = await request(app)
      .get(`/api/goals/${created.body._id}/progress`)
      .set(authHeader(token));
    expect(res.body.conditions[0].currentValue).toBe(1);
    expect(res.body.met).toBe(true);
  });
});

describe('GET /api/goals (Strava)', () => {
  it('lists Strava goals alongside other goals', async () => {
    const { token } = await createUser();
    await request(app).post('/api/goals').set(authHeader(token)).send(goalPayload());

    const res = await request(app).get('/api/goals').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].targetName).toBe('Strava');
  });
});
