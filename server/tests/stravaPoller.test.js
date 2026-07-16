const { startDb, stopDb, clearDb, createUser } = require('./helpers/testApp');
const poller = require('../services/stravaPoller');
const strava = require('../services/strava');
const StravaConnection = require('../models/StravaConnection');
const config = require('../utils/config');

beforeAll(async () => {
  await startDb();
});

beforeEach(() => {
  poller._reset();
  process.env.STRAVA_CLIENT_ID = '12345';
  process.env.STRAVA_CLIENT_SECRET = 'test-secret';
  process.env.STRAVA_POLL_INTERVAL_MINUTES = '15';
});

afterEach(async () => {
  await clearDb();
  config._resetCache();
  jest.restoreAllMocks();
  delete process.env.STRAVA_CLIENT_ID;
  delete process.env.STRAVA_CLIENT_SECRET;
  delete process.env.STRAVA_POLL_INTERVAL_MINUTES;
});

afterAll(async () => {
  poller._reset();
  await stopDb();
});

async function createConnection(athleteId = 4711) {
  const { user } = await createUser({ name: `User ${athleteId}` });
  return StravaConnection.create({
    userId: user._id,
    athleteId,
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: new Date(Date.now() + 3600000),
  });
}

describe('stravaPoller.tick', () => {
  it('does nothing when polling is disabled (interval 0)', async () => {
    process.env.STRAVA_POLL_INTERVAL_MINUTES = '0';
    const sync = jest.spyOn(strava, 'syncConnection');
    expect(await poller.tick()).toBe(false);
    expect(sync).not.toHaveBeenCalled();
  });

  it('does nothing when Strava is unconfigured', async () => {
    delete process.env.STRAVA_CLIENT_ID;
    const sync = jest.spyOn(strava, 'syncConnection');
    expect(await poller.tick()).toBe(false);
    expect(sync).not.toHaveBeenCalled();
  });

  it('syncs every connection when the interval has elapsed', async () => {
    await createConnection(1);
    await createConnection(2);
    const sync = jest.spyOn(strava, 'syncConnection').mockResolvedValue({ synced: 0, failed: 0 });

    expect(await poller.tick()).toBe(true);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('skips ticks inside the interval window', async () => {
    await createConnection(1);
    const sync = jest.spyOn(strava, 'syncConnection').mockResolvedValue({ synced: 0, failed: 0 });

    const t0 = Date.now();
    expect(await poller.tick(t0)).toBe(true);
    expect(await poller.tick(t0 + 5 * 60 * 1000)).toBe(false); // 5 min later
    expect(await poller.tick(t0 + 16 * 60 * 1000)).toBe(true); // 16 min later
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('continues with the next connection when one sync fails', async () => {
    await createConnection(1);
    await createConnection(2);
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const sync = jest.spyOn(strava, 'syncConnection')
      .mockRejectedValueOnce(new Error('kaputt'))
      .mockResolvedValueOnce({ synced: 1, failed: 0 });

    expect(await poller.tick()).toBe(true);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalled();
  });
});

describe('stravaPoller start/stop', () => {
  it('start is idempotent and stop clears the timer', () => {
    jest.useFakeTimers();
    poller.start();
    poller.start(); // no second timer
    expect(jest.getTimerCount()).toBe(1);
    poller.stop();
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });
});
