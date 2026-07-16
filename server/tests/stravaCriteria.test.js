const {
  METRICS,
  RULE_TYPES,
  validateCriteria,
  evaluateActivity,
  heartratePercentInRange,
  heartrateZonePercent,
} = require('../services/stravaCriteria');

// Base activity: 45 min run, 8 km, avg HR 150
function makeActivity(overrides = {}) {
  return {
    sportType: 'Run',
    type: 'Run',
    movingTime: 2700,
    elapsedTime: 2900,
    distance: 8000,
    totalElevationGain: 120,
    averageSpeed: 2.96,
    averageHeartrate: 150,
    maxHeartrate: 172,
    ...overrides,
  };
}

// HR stream: 10 samples, 1s apart — 8 of 10 in [140,160]
function withHrStream(activity, hr = [120, 145, 150, 152, 155, 158, 150, 149, 151, 130]) {
  return {
    ...activity,
    streams: {
      heartrate: { data: hr },
      time: { data: hr.map((_, i) => i) },
    },
  };
}

function withZones(activity, times = [60, 120, 600, 300, 120]) {
  return {
    ...activity,
    zones: [
      { type: 'heartrate', distribution_buckets: times.map(t => ({ min: 0, max: 0, time: t })) },
    ],
  };
}

describe('validateCriteria', () => {
  it('accepts a valid flat criteria tree', () => {
    const { valid, errors } = validateCriteria({
      operator: 'AND',
      rules: [
        { kind: 'sportType', values: ['Run', 'Ride'] },
        { kind: 'metricRange', metric: 'movingTime', min: 30 },
      ],
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it('accepts nested groups', () => {
    const { valid } = validateCriteria({
      operator: 'AND',
      rules: [
        { kind: 'sportType', values: ['Run'] },
        {
          kind: 'group',
          operator: 'OR',
          rules: [
            { kind: 'hrPercentInRange', minHr: 120, maxHr: 145, minPercent: 85 },
            { kind: 'hrZonePercent', zone: 2, minPercent: 85 },
          ],
        },
      ],
    });
    expect(valid).toBe(true);
  });

  it('rejects unknown rule kinds with the list of available kinds', () => {
    const { valid, errors } = validateCriteria({
      operator: 'AND',
      rules: [{ kind: 'weather', values: ['sunny'] }],
    });
    expect(valid).toBe(false);
    expect(errors[0]).toContain('unbekannter Regel-Typ');
    expect(errors[0]).toContain('sportType');
  });

  it('rejects invalid operators, empty rules and non-objects', () => {
    expect(validateCriteria({ operator: 'XOR', rules: [{ kind: 'sportType', values: ['Run'] }] }).valid).toBe(false);
    expect(validateCriteria({ operator: 'AND', rules: [] }).valid).toBe(false);
    expect(validateCriteria(null).valid).toBe(false);
    expect(validateCriteria('nope').valid).toBe(false);
  });

  it('validates sportType rules', () => {
    expect(validateCriteria({ operator: 'AND', rules: [{ kind: 'sportType', values: [] }] }).valid).toBe(false);
    expect(validateCriteria({ operator: 'AND', rules: [{ kind: 'sportType', values: [42] }] }).valid).toBe(false);
    expect(validateCriteria({ operator: 'AND', rules: [{ kind: 'sportType' }] }).valid).toBe(false);
  });

  it('validates metricRange rules', () => {
    const base = { kind: 'metricRange', metric: 'distance' };
    expect(validateCriteria({ operator: 'AND', rules: [{ ...base, min: 5 }] }).valid).toBe(true);
    expect(validateCriteria({ operator: 'AND', rules: [{ ...base }] }).valid).toBe(false); // no bound
    expect(validateCriteria({ operator: 'AND', rules: [{ ...base, min: 'x' }] }).valid).toBe(false);
    expect(validateCriteria({ operator: 'AND', rules: [{ ...base, min: 10, max: 5 }] }).valid).toBe(false);
    expect(validateCriteria({ operator: 'AND', rules: [{ kind: 'metricRange', metric: 'nope', min: 1 }] }).valid).toBe(false);
  });

  it('validates hrPercentInRange rules', () => {
    const ok = { kind: 'hrPercentInRange', minHr: 120, maxHr: 150, minPercent: 85 };
    expect(validateCriteria({ operator: 'AND', rules: [ok] }).valid).toBe(true);
    expect(validateCriteria({ operator: 'AND', rules: [{ ...ok, minHr: 160 }] }).valid).toBe(false); // min > max
    expect(validateCriteria({ operator: 'AND', rules: [{ ...ok, minPercent: 0 }] }).valid).toBe(false);
    expect(validateCriteria({ operator: 'AND', rules: [{ ...ok, minPercent: 101 }] }).valid).toBe(false);
  });

  it('validates hrZonePercent rules', () => {
    const ok = { kind: 'hrZonePercent', zone: 2, minPercent: 85 };
    expect(validateCriteria({ operator: 'AND', rules: [ok] }).valid).toBe(true);
    expect(validateCriteria({ operator: 'AND', rules: [{ ...ok, zone: 0 }] }).valid).toBe(false);
    expect(validateCriteria({ operator: 'AND', rules: [{ ...ok, zone: 6 }] }).valid).toBe(false);
    expect(validateCriteria({ operator: 'AND', rules: [{ ...ok, zone: 2.5 }] }).valid).toBe(false);
  });

  it('rejects trees deeper than the maximum nesting depth', () => {
    let group = { kind: 'group', operator: 'AND', rules: [{ kind: 'sportType', values: ['Run'] }] };
    for (let i = 0; i < 6; i++) {
      group = { kind: 'group', operator: 'AND', rules: [group] };
    }
    const { valid, errors } = validateCriteria({ operator: 'AND', rules: [group] });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('Verschachtelungstiefe'))).toBe(true);
  });
});

describe('sportType rule', () => {
  const criteria = { operator: 'AND', rules: [{ kind: 'sportType', values: ['Run', 'Swim', 'Ride'] }] };

  it('matches on sport_type case-insensitively', () => {
    expect(evaluateActivity(makeActivity({ sportType: 'run' }), criteria)).toBe(true);
    expect(evaluateActivity(makeActivity({ sportType: 'Walk', type: 'Walk' }), criteria)).toBe(false);
  });

  it('matches on the legacy type field (e.g. TrailRun reported with type Run)', () => {
    expect(evaluateActivity(makeActivity({ sportType: 'TrailRun', type: 'Run' }), criteria)).toBe(true);
  });
});

describe('metricRange rule', () => {
  it('checks min/max in user-facing units (minutes, km, km/h)', () => {
    const a = makeActivity(); // 45 min, 8 km
    expect(evaluateActivity(a, { operator: 'AND', rules: [{ kind: 'metricRange', metric: 'movingTime', min: 30 }] })).toBe(true);
    expect(evaluateActivity(a, { operator: 'AND', rules: [{ kind: 'metricRange', metric: 'movingTime', min: 60 }] })).toBe(false);
    expect(evaluateActivity(a, { operator: 'AND', rules: [{ kind: 'metricRange', metric: 'distance', min: 5, max: 10 }] })).toBe(true);
    expect(evaluateActivity(a, { operator: 'AND', rules: [{ kind: 'metricRange', metric: 'distance', max: 5 }] })).toBe(false);
    // averageSpeed 2.96 m/s ≈ 10.66 km/h
    expect(evaluateActivity(a, { operator: 'AND', rules: [{ kind: 'metricRange', metric: 'averageSpeed', min: 10 }] })).toBe(true);
  });

  it('fails when the metric value is missing on the activity', () => {
    const a = makeActivity({ averageWatts: undefined });
    expect(evaluateActivity(a, { operator: 'AND', rules: [{ kind: 'metricRange', metric: 'averageWatts', min: 100 }] })).toBe(false);
  });

  it('exposes every metric with a label, unit and accessor', () => {
    for (const def of Object.values(METRICS)) {
      expect(typeof def.label).toBe('string');
      expect(typeof def.get).toBe('function');
    }
  });
});

describe('hrPercentInRange rule', () => {
  it('matches when enough time was spent in the range', () => {
    const a = withHrStream(makeActivity()); // 8/10 samples in [140,160] ≈ 80 %... but first sample dt is 1
    const criteria = p => ({ operator: 'AND', rules: [{ kind: 'hrPercentInRange', minHr: 140, maxHr: 160, minPercent: p }] });
    expect(evaluateActivity(a, criteria(75))).toBe(true);
    expect(evaluateActivity(a, criteria(95))).toBe(false);
  });

  it('fails without a heart-rate stream', () => {
    const a = makeActivity();
    expect(evaluateActivity(a, { operator: 'AND', rules: [{ kind: 'hrPercentInRange', minHr: 100, maxHr: 200, minPercent: 50 }] })).toBe(false);
  });

  it('caps large time-stream gaps so pauses do not dominate', () => {
    // 3 samples: gap of 1000s between the 2nd and 3rd is capped at 60s
    const activity = {
      streams: {
        heartrate: { data: [150, 150, 90] },
        time: { data: [0, 10, 1010] },
      },
    };
    // weights: 1 (first) + 10 + 60 → in range 11/71 ≈ 15 %
    const percent = heartratePercentInRange(activity, 140, 160);
    expect(percent).toBeGreaterThan(14);
    expect(percent).toBeLessThan(17);
  });

  it('weights each sample equally when no time stream exists', () => {
    const activity = { streams: { heartrate: { data: [150, 150, 150, 90] } } };
    expect(heartratePercentInRange(activity, 140, 160)).toBe(75);
  });

  it('returns null for empty streams', () => {
    expect(heartratePercentInRange({ streams: { heartrate: { data: [] } } }, 1, 2)).toBeNull();
    expect(heartratePercentInRange({}, 1, 2)).toBeNull();
  });
});

describe('hrZonePercent rule', () => {
  it('computes the share of time per Strava zone', () => {
    const a = withZones(makeActivity(), [100, 500, 300, 50, 50]); // total 1000
    expect(heartrateZonePercent(a, 2)).toBe(50);
    expect(evaluateActivity(a, { operator: 'AND', rules: [{ kind: 'hrZonePercent', zone: 2, minPercent: 50 }] })).toBe(true);
    expect(evaluateActivity(a, { operator: 'AND', rules: [{ kind: 'hrZonePercent', zone: 2, minPercent: 51 }] })).toBe(false);
  });

  it('fails without zones data', () => {
    expect(evaluateActivity(makeActivity(), { operator: 'AND', rules: [{ kind: 'hrZonePercent', zone: 2, minPercent: 10 }] })).toBe(false);
    expect(heartrateZonePercent({ zones: [] }, 2)).toBeNull();
    expect(heartrateZonePercent({ zones: [{ type: 'power', distribution_buckets: [{ time: 10 }] }] }, 1)).toBeNull();
    expect(heartrateZonePercent(withZones({}, [0, 0, 0, 0, 0]), 2)).toBeNull(); // zero total
  });
});

describe('group logic', () => {
  const zone2ByStream = { kind: 'hrPercentInRange', minHr: 120, maxHr: 145, minPercent: 85 };

  it('combines rules with AND and OR', () => {
    const run = withHrStream(makeActivity(), Array(10).fill(130)); // 100 % in [120,145]
    const and = { operator: 'AND', rules: [{ kind: 'sportType', values: ['Run'] }, zone2ByStream] };
    const or = { operator: 'OR', rules: [{ kind: 'sportType', values: ['Swim'] }, zone2ByStream] };
    expect(evaluateActivity(run, and)).toBe(true);
    expect(evaluateActivity(run, or)).toBe(true);
    expect(evaluateActivity({ ...run, sportType: 'Ride', type: 'Ride' }, and)).toBe(false);
  });

  it('evaluates the user example: Zone 2 = (Run|Swim|Ride) AND 85 % of HR in range', () => {
    const criteria = {
      operator: 'AND',
      rules: [
        { kind: 'sportType', values: ['Run', 'Swim', 'Ride'] },
        {
          kind: 'group',
          operator: 'OR',
          rules: [
            { kind: 'hrPercentInRange', minHr: 120, maxHr: 145, minPercent: 85 },
            { kind: 'hrZonePercent', zone: 2, minPercent: 85 },
          ],
        },
      ],
    };

    const zone2Run = withHrStream(makeActivity(), Array(20).fill(135));
    expect(evaluateActivity(zone2Run, criteria)).toBe(true);

    // Zones data satisfies the OR branch even without a stream
    const zone2ByZones = withZones(makeActivity(), [0, 900, 50, 0, 0]);
    expect(evaluateActivity(zone2ByZones, criteria)).toBe(true);

    const hardRun = withHrStream(makeActivity(), Array(20).fill(170));
    expect(evaluateActivity(hardRun, criteria)).toBe(false);

    const weightTraining = withHrStream(makeActivity({ sportType: 'WeightTraining', type: 'Workout' }), Array(20).fill(135));
    expect(evaluateActivity(weightTraining, criteria)).toBe(false);
  });

  it('never matches on invalid criteria', () => {
    expect(evaluateActivity(makeActivity(), { operator: 'AND', rules: [{ kind: 'nope' }] })).toBe(false);
    expect(evaluateActivity(makeActivity(), null)).toBe(false);
  });
});

describe('extensibility', () => {
  it('exposes the rule registry so new kinds can be added', () => {
    expect(Object.keys(RULE_TYPES)).toEqual(
      expect.arrayContaining(['sportType', 'metricRange', 'hrPercentInRange', 'hrZonePercent', 'group'])
    );
    for (const type of Object.values(RULE_TYPES)) {
      expect(typeof type.validate).toBe('function');
      expect(typeof type.evaluate).toBe('function');
    }
  });
});
