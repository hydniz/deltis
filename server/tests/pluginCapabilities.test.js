const { describeCapability, describeAll } = require('../services/pluginCapabilities');
const { FIXED_CAPABILITIES } = require('../services/pluginManifest');

describe('describeCapability', () => {
  it('returns a German description for every fixed capability', () => {
    for (const cap of FIXED_CAPABILITIES) {
      const description = describeCapability(cap);
      expect(typeof description).toBe('string');
      expect(description.length).toBeGreaterThan(0);
      expect(description).not.toBe(cap);
    }
  });

  it('describes a network capability generically', () => {
    expect(describeCapability('network:api.strava.com')).toBe('Netzwerkzugriff auf api.strava.com.');
  });

  it('falls back to the raw string for something entirely unknown', () => {
    expect(describeCapability('totally:unknown')).toBe('totally:unknown');
  });
});

describe('describeAll', () => {
  it('maps a capability list to {capability, description} pairs', () => {
    const result = describeAll(['habits:read', 'network:api.strava.com']);
    expect(result).toEqual([
      { capability: 'habits:read', description: expect.any(String) },
      { capability: 'network:api.strava.com', description: 'Netzwerkzugriff auf api.strava.com.' },
    ]);
  });

  it('returns an empty array for empty/undefined input', () => {
    expect(describeAll([])).toEqual([]);
    expect(describeAll(undefined)).toEqual([]);
  });
});
