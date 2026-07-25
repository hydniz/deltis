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
