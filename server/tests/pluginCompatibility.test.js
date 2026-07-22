const pkg = require('../../package.json');
const { PLUGIN_HOST_API_VERSION, compareSemver, checkCompatibility } = require('../services/pluginCompatibility');

describe('compareSemver', () => {
  it.each([
    ['1.0.0', '1.0.0', 0],
    ['1.0.0', '1.0.1', -1],
    ['1.0.1', '1.0.0', 1],
    ['1.1.0', '1.0.9', 1],
    ['2.0.0', '1.9.9', 1],
    ['1.9.9', '2.0.0', -1],
    ['1.0.0-beta.1', '1.0.0', 0], // prerelease suffix stripped
  ])('compareSemver(%p, %p) === %p', (a, b, expected) => {
    expect(compareSemver(a, b)).toBe(expected);
  });
});

describe('checkCompatibility', () => {
  it('returns no warnings when compatibility is absent', () => {
    expect(checkCompatibility({ id: 'x' })).toEqual([]);
  });

  it('returns no warnings when compatibility is present and everything matches', () => {
    const warnings = checkCompatibility({
      compatibility: { testedCoreVersion: pkg.version, minHostApiVersion: PLUGIN_HOST_API_VERSION },
    });
    expect(warnings).toEqual([]);
  });

  it('warns when the plugin needs a newer Plugin Host API version than this server provides', () => {
    const warnings = checkCompatibility({ compatibility: { minHostApiVersion: PLUGIN_HOST_API_VERSION + 1 } });
    expect(warnings).toEqual([expect.stringContaining('Plugin-Host-API-Version')]);
  });

  it('does not warn when the plugin needs an older or equal Host API version', () => {
    expect(checkCompatibility({ compatibility: { minHostApiVersion: PLUGIN_HOST_API_VERSION } })).toEqual([]);
  });

  it('warns when the plugin was tested against an older core version than this server runs', () => {
    const warnings = checkCompatibility({ compatibility: { testedCoreVersion: '0.0.1' } });
    expect(warnings).toEqual([expect.stringContaining('nur mit Deltis 0.0.1 getestet')]);
  });

  it('does not warn when the plugin claims a newer tested version than this server (nothing to complain about)', () => {
    expect(checkCompatibility({ compatibility: { testedCoreVersion: '999.0.0' } })).toEqual([]);
  });

  it('ignores a malformed testedCoreVersion rather than crashing', () => {
    expect(checkCompatibility({ compatibility: { testedCoreVersion: 'not-a-version' } })).toEqual([]);
  });

  it('can return both warnings at once', () => {
    const warnings = checkCompatibility({
      compatibility: { testedCoreVersion: '0.0.1', minHostApiVersion: PLUGIN_HOST_API_VERSION + 1 },
    });
    expect(warnings).toHaveLength(2);
  });

  it('handles a manifest with no compatibility field and no manifest at all', () => {
    expect(checkCompatibility({})).toEqual([]);
    expect(checkCompatibility(null)).toEqual([]);
    expect(checkCompatibility(undefined)).toEqual([]);
  });
});
