const { startDb, stopDb, clearDb } = require('./helpers/testApp');
const User = require('../models/User');
const HealthActivity = require('../models/HealthActivity');
const { priorityMap, detectedSources } = require('../services/activitySources');

beforeAll(async () => { await startDb(); });
afterEach(async () => { await clearDb(); });
afterAll(async () => { await stopDb(); });

async function makeUser(activityOriginPriority) {
  return User.create({ username: 'tester', passwordHash: 'x', activityOriginPriority });
}

function activity(userId, healthId, dataOrigin) {
  return HealthActivity.create({
    userId, healthId, dataOrigin,
    startDate: new Date('2026-05-01T08:00:00Z'),
    endDate: new Date('2026-05-01T09:00:00Z'),
  });
}

describe('priorityMap', () => {
  it('maps the saved order to ascending priority indices', async () => {
    const user = await makeUser(['com.garmin', 'com.sec', '']);
    // The empty entry is skipped, real ones keep their index.
    expect(await priorityMap(user._id)).toEqual({ 'com.garmin': 0, 'com.sec': 1 });
  });

  it('returns an empty map when the user has no preference', async () => {
    const user = await makeUser(undefined);
    expect(await priorityMap(user._id)).toEqual({});
  });
});

describe('detectedSources', () => {
  it('returns distinct non-empty origins with friendly labels', async () => {
    const user = await makeUser([]);
    await activity(user._id, 'a1', 'com.sec.android.app.shealth');
    await activity(user._id, 'a2', 'com.sec.android.app.shealth');
    await activity(user._id, 'a3', 'com.garmin.android.apps.connectmobile');
    await activity(user._id, 'a4', ''); // an origin-less record is dropped

    const sources = await detectedSources(user._id);
    expect(sources).toHaveLength(2);
    expect(sources).toEqual(expect.arrayContaining([
      { origin: 'com.sec.android.app.shealth', appLabel: 'Samsung Health' },
      { origin: 'com.garmin.android.apps.connectmobile', appLabel: 'Garmin Connect' },
    ]));
  });
});
