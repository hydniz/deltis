const { reduce, dayKey, dailySeries, periodValue, latestValue } = require('../services/metricAggregate');

describe('reduce', () => {
  it('handles every mode', () => {
    const v = [3, 1, 2];
    expect(reduce(v, 'sum')).toBe(6);
    expect(reduce(v, 'avg')).toBe(2);
    expect(reduce(v, 'min')).toBe(1);
    expect(reduce(v, 'max')).toBe(3);
    expect(reduce(v, 'last')).toBe(2);        // chronological order preserved
    expect(reduce(v, 'unknown')).toBe(2);     // default = last
  });

  it('ignores non-finite values and returns null when empty', () => {
    expect(reduce([NaN, undefined, 5, 'x'], 'sum')).toBe(5);
    expect(reduce([], 'avg')).toBeNull();
    expect(reduce(['x', null], 'max')).toBeNull();
  });
});

describe('dayKey', () => {
  it('uses UTC by default', () => {
    expect(dayKey('2026-05-01T23:30:00.000Z')).toBe('2026-05-01');
  });

  it('shifts by a timezone offset', () => {
    // 23:30 UTC + 120 min = 01:30 next day local.
    expect(dayKey('2026-05-01T23:30:00.000Z', 120)).toBe('2026-05-02');
    // 01:00 UTC - 300 min = 20:00 previous day local.
    expect(dayKey('2026-05-02T01:00:00.000Z', -300)).toBe('2026-05-01');
  });
});

describe('dailySeries', () => {
  it('collapses several readings per day with the day mode', () => {
    const logs = [
      { date: '2026-05-01T06:00:00Z', value: 70 },
      { date: '2026-05-01T20:00:00Z', value: 72 },
      { date: '2026-05-02T06:00:00Z', value: 68 },
    ];
    const last = dailySeries(logs, 'last');
    expect(last.get('2026-05-01')).toBe(72);
    expect(last.get('2026-05-02')).toBe(68);

    const sum = dailySeries(logs, 'sum');
    expect(sum.get('2026-05-01')).toBe(142);
  });
});

describe('periodValue', () => {
  it('collapses per day then across the period', () => {
    const logs = [
      { date: '2026-05-01T06:00:00Z', value: 60 },  // day1 min 55
      { date: '2026-05-01T20:00:00Z', value: 55 },
      { date: '2026-05-02T06:00:00Z', value: 50 },  // day2 min 50
    ];
    // resting HR: min per day, avg across days → (55 + 50) / 2
    expect(periodValue(logs, 'min', 'avg')).toBeCloseTo(52.5);
    // steps: sum per day, sum across → 115 + 50
    expect(periodValue(logs, 'sum', 'sum')).toBe(165);
  });

  it('returns null with no logs', () => {
    expect(periodValue([], 'avg', 'avg')).toBeNull();
  });
});

describe('latestValue', () => {
  it('returns the newest reading', () => {
    expect(latestValue([
      { date: '2026-05-01T06:00:00Z', value: 1 },
      { date: '2026-05-03T06:00:00Z', value: 3 },
      { date: '2026-05-02T06:00:00Z', value: 2 },
    ])).toBe(3);
  });

  it('returns null for empty/invalid input', () => {
    expect(latestValue([])).toBeNull();
    expect(latestValue(null)).toBeNull();
  });
});
