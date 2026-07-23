const { startDb, stopDb, clearDb, createUser } = require('./helpers/testApp');
const healthCriteria = require('../services/healthCriteria');
const trainingCriteria = require('../services/trainingCriteria');
const HealthActivity = require('../models/HealthActivity');

beforeAll(async () => { await startDb(); });
afterEach(async () => { await clearDb(); });
afterAll(async () => { await stopDb(); });

const run = {
  exerciseType: 'EXERCISE_TYPE_RUNNING',
  sportType: 'run',
  movingTime: 3600,
  elapsedTime: 3600,
  distance: 10000,
  averageHeartrate: 150,
  calories: 700,
  streams: {
    heartrate: { data: [120, 140, 150, 160] },
    time: { data: [0, 60, 120, 180] },
  },
};

const AND = (...rules) => ({ operator: 'AND', rules });

describe('validateCriteria', () => {
  it('accepts a well-formed tree', () => {
    expect(healthCriteria.validateCriteria(
      AND({ kind: 'sportType', values: ['run'] })).valid).toBe(true);
  });

  it('rejects an unknown operator', () => {
    const result = healthCriteria.validateCriteria({ operator: 'XOR', rules: [] });
    expect(result.valid).toBe(false);
  });

  it('rejects an empty rule list', () => {
    expect(healthCriteria.validateCriteria(AND()).valid).toBe(false);
  });

  it('rejects an unknown rule kind and names the available ones', () => {
    const result = healthCriteria.validateCriteria(AND({ kind: 'telepathy' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('sportType');
  });

  it('rejects an unknown metric', () => {
    expect(healthCriteria.validateCriteria(
      AND({ kind: 'metricRange', metric: 'aura', min: 1 })).valid).toBe(false);
  });

  it('requires min or max on a metric range', () => {
    expect(healthCriteria.validateCriteria(
      AND({ kind: 'metricRange', metric: 'distance' })).valid).toBe(false);
  });

  it('rejects min greater than max', () => {
    expect(healthCriteria.validateCriteria(
      AND({ kind: 'metricRange', metric: 'distance', min: 10, max: 1 })).valid).toBe(false);
  });

  it('rejects an invalid heart-rate range', () => {
    expect(healthCriteria.validateCriteria(
      AND({ kind: 'hrPercentInRange', minHr: 180, maxHr: 120, minPercent: 50 })).valid).toBe(false);
    expect(healthCriteria.validateCriteria(
      AND({ kind: 'hrPercentInRange', minHr: 120, maxHr: 180, minPercent: 0 })).valid).toBe(false);
  });

  it('rejects a non-object group', () => {
    expect(healthCriteria.validateCriteria(null).valid).toBe(false);
  });

  it('enforces the nesting depth limit', () => {
    let tree = AND({ kind: 'sportType', values: ['run'] });
    for (let i = 0; i < 8; i++) tree = AND({ kind: 'group', ...tree });
    expect(healthCriteria.validateCriteria(tree).valid).toBe(false);
  });

  it('exposes group alongside the integration rule kinds', () => {
    expect(Object.keys(healthCriteria.RULE_TYPES).sort())
      .toEqual(['group', 'hrPercentInRange', 'metricRange', 'sportType']);
  });
});

describe('evaluateActivity', () => {
  it('matches the normalized family', () => {
    expect(healthCriteria.evaluateActivity(run, AND({ kind: 'sportType', values: ['run'] }))).toBe(true);
  });

  it('matches a treadmill run written as a raw Health Connect type', () => {
    const treadmill = { ...run, exerciseType: 'EXERCISE_TYPE_RUNNING_TREADMILL' };
    expect(healthCriteria.evaluateActivity(
      treadmill, AND({ kind: 'sportType', values: ['run'] }))).toBe(true);
  });

  it('rejects a different sport', () => {
    expect(healthCriteria.evaluateActivity(run, AND({ kind: 'sportType', values: ['ride'] }))).toBe(false);
  });

  it('evaluates metric ranges in user-facing units', () => {
    expect(healthCriteria.evaluateActivity(
      run, AND({ kind: 'metricRange', metric: 'distance', min: 5 }))).toBe(true);   // km
    expect(healthCriteria.evaluateActivity(
      run, AND({ kind: 'metricRange', metric: 'movingTime', min: 90 }))).toBe(false); // min
  });

  it('treats a missing metric as unfulfilled', () => {
    expect(healthCriteria.evaluateActivity(
      { ...run, steps: undefined }, AND({ kind: 'metricRange', metric: 'steps', min: 1 }))).toBe(false);
  });

  it('evaluates heart-rate share from the stream', () => {
    expect(healthCriteria.evaluateActivity(
      run, AND({ kind: 'hrPercentInRange', minHr: 100, maxHr: 200, minPercent: 90 }))).toBe(true);
    expect(healthCriteria.evaluateActivity(
      run, AND({ kind: 'hrPercentInRange', minHr: 190, maxHr: 200, minPercent: 10 }))).toBe(false);
  });

  it('honours OR and nested groups', () => {
    const tree = {
      operator: 'OR',
      rules: [
        { kind: 'sportType', values: ['ride'] },
        { kind: 'group', operator: 'AND', rules: [{ kind: 'sportType', values: ['run'] }] },
      ],
    };
    expect(healthCriteria.evaluateActivity(run, tree)).toBe(true);
  });

  it('never matches on an invalid tree', () => {
    expect(healthCriteria.evaluateActivity(run, { operator: 'XOR', rules: [] })).toBe(false);
  });
});

describe('trainingCriteria integration registry', () => {
  it('registers health next to strava', () => {
    expect(trainingCriteria.knownIntegrations()).toContain('health');
  });

  it('validates a health criteria map', () => {
    expect(trainingCriteria.validateCriteriaMap({
      health: AND({ kind: 'sportType', values: ['run'] }),
    }).valid).toBe(true);

    expect(trainingCriteria.validateCriteriaMap({
      health: AND({ kind: 'nonsense' }),
    }).valid).toBe(false);
  });

  // The whole point of the canonical flag: a deduplicated session must not
  // fulfil a habit or feed a goal a second time.
  it('returns only canonical sessions', async () => {
    const { user } = await createUser();
    await HealthActivity.create({
      userId: user._id, healthId: 'keep', exerciseType: 'EXERCISE_TYPE_RUNNING',
      sportType: 'run', distance: 10000, movingTime: 3600,
      startDate: new Date('2026-05-01T08:00:00Z'), endDate: new Date('2026-05-01T09:00:00Z'),
    });
    await HealthActivity.create({
      userId: user._id, healthId: 'dupe', exerciseType: 'EXERCISE_TYPE_RUNNING',
      sportType: 'run', distance: 10000, movingTime: 3600,
      startDate: new Date('2026-05-01T08:00:00Z'), endDate: new Date('2026-05-01T09:00:00Z'),
      canonical: false,
    });

    const matches = await trainingCriteria.findMatches(
      user._id, { health: null },
      new Date('2026-04-01T00:00:00Z'), new Date('2026-06-01T00:00:00Z'));

    expect(matches.length).toBe(1);
    expect(matches[0].integration).toBe('health');
  });

  it('finds health matches on a single day', async () => {
    const { user } = await createUser();
    await HealthActivity.create({
      userId: user._id, healthId: 'day', exerciseType: 'EXERCISE_TYPE_RUNNING',
      sportType: 'run', movingTime: 3600,
      startDate: new Date('2026-05-01T08:00:00Z'), endDate: new Date('2026-05-01T09:00:00Z'),
      startDateLocal: new Date('2026-05-01T08:00:00Z'),
    });

    const matches = await trainingCriteria.findMatchesOnDay(user._id, { health: null }, '2026-05-01');
    expect(matches.length).toBe(1);
  });
});

describe('METRICS', () => {
  const full = {
    movingTime: 3600, elapsedTime: 3900, distance: 10000, totalElevationGain: 120,
    averageSpeed: 2.5, averageHeartrate: 150, maxHeartrate: 175, calories: 700, steps: 9000,
  };

  it.each([
    ['movingTime', 60],
    ['elapsedTime', 65],
    ['distance', 10],
    ['totalElevationGain', 120],
    ['averageSpeed', 9],
    ['averageHeartrate', 150],
    ['maxHeartrate', 175],
    ['calories', 700],
    ['steps', 9000],
  ])('converts %s into its user-facing unit', (metric, expected) => {
    expect(healthCriteria.METRICS[metric].get(full)).toBeCloseTo(expected);
  });

  it.each(Object.keys(full))('returns null when %s is absent', (metric) => {
    expect(healthCriteria.METRICS[metric].get({})).toBeNull();
  });

  it('rejects a sportType rule whose values are not strings', () => {
    expect(healthCriteria.validateCriteria(
      AND({ kind: 'sportType', values: 'run' })).valid).toBe(false);
    expect(healthCriteria.validateCriteria(
      AND({ kind: 'sportType', values: [' '] })).valid).toBe(false);
    expect(healthCriteria.validateCriteria(
      AND({ kind: 'sportType', values: [] })).valid).toBe(false);
  });

  it('rejects non-numeric metric bounds', () => {
    expect(healthCriteria.validateCriteria(
      AND({ kind: 'metricRange', metric: 'distance', min: 'weit' })).valid).toBe(false);
    expect(healthCriteria.validateCriteria(
      AND({ kind: 'metricRange', metric: 'distance', max: 'weit' })).valid).toBe(false);
  });
});
