const {
  includeLog, filterLogs, distinctSources, appLabel, sourceMatches,
} = require('../services/metricSources');

const health = (origin, deviceId, value = 1) => ({ source: 'health', origin, deviceId, value });
const manual = (value = 1) => ({ source: 'manual', origin: '', deviceId: '', value });

describe('includeLog', () => {
  it('always keeps manual/imported readings regardless of policy', () => {
    const policy = { mode: 'selected', sources: [{ deviceId: 'x', app: 'y' }] };
    expect(includeLog(manual(), policy)).toBe(true);
    expect(includeLog({ source: 'import', origin: '', deviceId: '' }, policy)).toBe(true);
  });

  it('keeps every health reading when the mode is all (or unset)', () => {
    expect(includeLog(health('com.garmin', 'a'), { mode: 'all', sources: [] })).toBe(true);
    expect(includeLog(health('com.garmin', 'a'), undefined)).toBe(true);
    expect(includeLog(health('com.garmin', 'a'), { mode: 'selected', sources: [] })).toBe(false);
  });

  it('matches a specific (device, app) source', () => {
    const policy = { mode: 'selected', sources: [{ deviceId: 'phone-a', app: 'com.garmin' }] };
    expect(includeLog(health('com.garmin', 'phone-a'), policy)).toBe(true);
    expect(includeLog(health('com.garmin', 'phone-b'), policy)).toBe(false);
    expect(includeLog(health('com.samsung', 'phone-a'), policy)).toBe(false);
  });

  it('treats an app-only entry as a wildcard across devices', () => {
    const policy = { mode: 'selected', sources: [{ deviceId: '', app: 'com.garmin' }] };
    expect(includeLog(health('com.garmin', 'phone-a'), policy)).toBe(true);
    expect(includeLog(health('com.garmin', 'phone-b'), policy)).toBe(true);
    expect(includeLog(health('com.samsung', 'phone-a'), policy)).toBe(false);
  });

  it('treats a device-only entry as every app on that device', () => {
    const policy = { mode: 'selected', sources: [{ deviceId: 'phone-a', app: '' }] };
    expect(includeLog(health('com.garmin', 'phone-a'), policy)).toBe(true);
    expect(includeLog(health('com.samsung', 'phone-a'), policy)).toBe(true);
    expect(includeLog(health('com.garmin', 'phone-b'), policy)).toBe(false);
  });
});

describe('filterLogs', () => {
  it('returns everything for mode all and filters for mode selected', () => {
    const logs = [health('com.garmin', 'a'), health('com.samsung', 'b'), manual()];
    expect(filterLogs(logs, { mode: 'all', sources: [] })).toHaveLength(3);
    const filtered = filterLogs(logs, { mode: 'selected', sources: [{ deviceId: '', app: 'com.garmin' }] });
    expect(filtered).toHaveLength(2); // garmin health + manual
    expect(filtered.some(l => l.origin === 'com.samsung')).toBe(false);
  });

  it('handles a non-array gracefully', () => {
    expect(filterLogs(null, { mode: 'selected', sources: [] })).toEqual([]);
  });
});

describe('distinctSources', () => {
  it('returns unique (device, app) pairs from health readings only', () => {
    const logs = [
      health('com.garmin', 'phone-a'), health('com.garmin', 'phone-a'),
      health('com.samsung', 'phone-b'), manual(), health('', ''),
    ];
    const sources = distinctSources(logs);
    expect(sources).toHaveLength(2);
    expect(sources).toEqual(expect.arrayContaining([
      { deviceId: 'phone-a', app: 'com.garmin' },
      { deviceId: 'phone-b', app: 'com.samsung' },
    ]));
  });
});

describe('appLabel', () => {
  it('maps known packages and passes through unknown ones', () => {
    expect(appLabel('com.sec.android.app.shealth')).toBe('Samsung Health');
    expect(appLabel('com.garmin.android.apps.connectmobile')).toBe('Garmin Connect');
    expect(appLabel('com.unknown.app')).toBe('com.unknown.app');
    expect(appLabel('')).toBe('Unbekannt');
  });
});

describe('sourceMatches', () => {
  it('a fully-empty entry matches any health reading', () => {
    expect(sourceMatches({ deviceId: '', app: '' }, health('x', 'y'))).toBe(true);
  });
});

// Interval-level de-duplication (Phase 3): overlapping platform sources are
// never double-counted; disjoint ones are summed.
const { resolveLogs } = require('../services/metricSources');
const { dailySeries } = require('../services/metricAggregate');

const iv = (origin, device, value, s, e) =>
  ({ source: 'health', origin, deviceId: device, value, date: new Date(s), endTime: new Date(e) });
const dailyTotal = (origin, device, value, day) =>
  ({ source: 'health', origin, deviceId: device, value, date: new Date(day), endTime: null });
const manualLog = (value, day) => ({ source: 'manual', origin: '', deviceId: '', value, date: new Date(day), endTime: null });

const sumDef = (policy) => ({ dayAggregation: 'sum', sourcePolicy: policy });
const daySum = (logs) => [...dailySeries(logs, 'sum').values()].reduce((a, b) => a + b, 0);

describe('resolveLogs — interval dedup for sum metrics', () => {
  it('does nothing for non-sum metrics beyond the source filter', () => {
    const logs = [iv('com.garmin', 'a', 5000, '2026-05-01T08:00:00Z', '2026-05-01T09:00:00Z')];
    const out = resolveLogs(logs, { dayAggregation: 'last', sourcePolicy: { mode: 'all' } });
    expect(out).toHaveLength(1);
  });

  it('keeps a single source untouched', () => {
    const logs = [
      iv('com.garmin', 'a', 3000, '2026-05-01T06:00:00Z', '2026-05-01T10:00:00Z'),
      iv('com.garmin', 'a', 2000, '2026-05-01T18:00:00Z', '2026-05-01T20:00:00Z'),
    ];
    expect(daySum(resolveLogs(logs, sumDef({ mode: 'all' })))).toBe(5000);
  });

  it('drops the lower-priority source when two overlap (no double count)', () => {
    const logs = [
      iv('com.garmin', 'a', 5000, '2026-05-01T08:00:00Z', '2026-05-01T09:00:00Z'),
      iv('com.sec', 'b', 4800, '2026-05-01T08:00:00Z', '2026-05-01T09:00:00Z'),
    ];
    const policy = { mode: 'selected', sources: [{ deviceId: '', app: 'com.garmin' }, { deviceId: '', app: 'com.sec' }] };
    const out = resolveLogs(logs, sumDef(policy));
    expect(daySum(out)).toBe(5000);           // Garmin wins (listed first)
    expect(out.every(l => l.origin === 'com.garmin')).toBe(true);
  });

  it('sums disjoint sources (Garmin morning + another watch evening)', () => {
    const logs = [
      iv('com.garmin', 'a', 3000, '2026-05-01T06:00:00Z', '2026-05-01T10:00:00Z'),
      iv('com.sec', 'b', 4000, '2026-05-01T14:00:00Z', '2026-05-01T18:00:00Z'),
    ];
    expect(daySum(resolveLogs(logs, sumDef({ mode: 'all' })))).toBe(7000);
  });

  it('interval readings supersede a daily-total reading on the same day', () => {
    const logs = [
      iv('com.garmin', 'a', 5000, '2026-05-01T08:00:00Z', '2026-05-01T09:00:00Z'),
      dailyTotal('com.sec', 'b', 9999, '2026-05-01T12:00:00Z'),
    ];
    expect(daySum(resolveLogs(logs, sumDef({ mode: 'all' })))).toBe(5000);
  });

  it('keeps only the highest-priority source among competing daily totals', () => {
    const logs = [
      dailyTotal('com.garmin', 'a', 5000, '2026-05-01T12:00:00Z'),
      dailyTotal('com.sec', 'b', 4800, '2026-05-01T12:00:00Z'),
    ];
    const policy = { mode: 'selected', sources: [{ deviceId: '', app: 'com.sec' }, { deviceId: '', app: 'com.garmin' }] };
    expect(daySum(resolveLogs(logs, sumDef(policy)))).toBe(4800); // Samsung listed first
  });

  it('always adds manual entries on top of the deduped platform value', () => {
    const logs = [
      iv('com.garmin', 'a', 5000, '2026-05-01T08:00:00Z', '2026-05-01T09:00:00Z'),
      iv('com.sec', 'b', 4800, '2026-05-01T08:00:00Z', '2026-05-01T09:00:00Z'),
      manualLog(200, '2026-05-01T20:00:00Z'),
    ];
    expect(daySum(resolveLogs(logs, sumDef({ mode: 'all' })))).toBe(5200); // 5000 (one source) + 200 manual
  });
});
