const { validateManifest, isValidCapability, networkDomainsOf, FIXED_CAPABILITIES } = require('../services/pluginManifest');

function validManifest(overrides = {}) {
  return {
    manifestVersion: 1,
    id: 'strava-integration',
    name: 'Strava',
    version: '1.0.0',
    description: 'Synchronisiert Aktivitäten von Strava.',
    author: 'hydniz',
    capabilities: ['habits:read', 'activities:write', 'network:api.strava.com'],
    runtime: { type: 'docker', image: 'ghcr.io/hydniz/deltis-strava-integration:1.0.0' },
    ...overrides,
  };
}

describe('validateManifest', () => {
  it('accepts a well-formed manifest', () => {
    const { valid, errors } = validateManifest(validManifest());
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('rejects a non-object manifest', () => {
    expect(validateManifest(null).valid).toBe(false);
    expect(validateManifest('x').valid).toBe(false);
    expect(validateManifest([]).valid).toBe(false);
  });

  it('rejects a wrong manifestVersion', () => {
    const { valid, errors } = validateManifest(validManifest({ manifestVersion: 2 }));
    expect(valid).toBe(false);
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('manifestVersion')]));
  });

  it.each([
    ['', false], ['ab', false], ['-strava', false], ['Strava', false],
    ['strava_integration', false], ['strava-integration', true], ['a'.repeat(64), true], ['a'.repeat(65), false],
  ])('validates id format %p → %p', (id, expected) => {
    const { valid } = validateManifest(validManifest({ id }));
    expect(valid).toBe(expected);
  });

  it('rejects a blank name/description/author', () => {
    expect(validateManifest(validManifest({ name: '  ' })).valid).toBe(false);
    expect(validateManifest(validManifest({ description: '' })).valid).toBe(false);
    expect(validateManifest(validManifest({ author: '' })).valid).toBe(false);
  });

  it.each([
    ['1.0.0', true], ['1.2.3-beta.1', true], ['1.0', false], ['v1.0.0', false], ['1.0.0.0', false],
  ])('validates semver %p → %p', (version, expected) => {
    expect(validateManifest(validManifest({ version })).valid).toBe(expected);
  });

  it('rejects an empty capabilities array', () => {
    const { valid, errors } = validateManifest(validManifest({ capabilities: [] }));
    expect(valid).toBe(false);
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('capabilities')]));
  });

  it('rejects an unknown capability string', () => {
    const { valid, errors } = validateManifest(validManifest({ capabilities: ['habits:read', 'mongodb:root'] }));
    expect(valid).toBe(false);
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('mongodb:root')]));
  });

  it('rejects duplicate capabilities', () => {
    const { valid, errors } = validateManifest(validManifest({ capabilities: ['habits:read', 'habits:read'] }));
    expect(valid).toBe(false);
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('Doppelte')]));
  });

  it('accepts every fixed capability individually', () => {
    for (const cap of FIXED_CAPABILITIES) {
      expect(isValidCapability(cap)).toBe(true);
    }
  });

  it('accepts a network:<domain> capability and rejects a malformed one', () => {
    expect(isValidCapability('network:api.strava.com')).toBe(true);
    expect(isValidCapability('network:localhost')).toBe(false); // no TLD
    expect(isValidCapability('network:')).toBe(false);
    expect(isValidCapability('network:..')).toBe(false);
  });

  it('rejects a missing/invalid runtime', () => {
    expect(validateManifest(validManifest({ runtime: undefined })).valid).toBe(false);
    expect(validateManifest(validManifest({ runtime: { type: 'wasm' } })).valid).toBe(false);
    expect(validateManifest(validManifest({ runtime: { type: 'docker', image: 'not a valid ref!' } })).valid).toBe(false);
  });

  it('accepts a manifest with no compatibility field', () => {
    expect(validateManifest(validManifest()).valid).toBe(true);
  });

  it('accepts a well-formed compatibility block', () => {
    const { valid } = validateManifest(validManifest({ compatibility: { testedCoreVersion: '0.6.0', minHostApiVersion: 1 } }));
    expect(valid).toBe(true);
  });

  it('accepts a compatibility block with only one of the two optional fields', () => {
    expect(validateManifest(validManifest({ compatibility: { testedCoreVersion: '0.6.0' } })).valid).toBe(true);
    expect(validateManifest(validManifest({ compatibility: { minHostApiVersion: 1 } })).valid).toBe(true);
    expect(validateManifest(validManifest({ compatibility: {} })).valid).toBe(true);
  });

  it('rejects a non-object compatibility value', () => {
    expect(validateManifest(validManifest({ compatibility: 'yes' })).valid).toBe(false);
    expect(validateManifest(validManifest({ compatibility: [] })).valid).toBe(false);
    expect(validateManifest(validManifest({ compatibility: null })).valid).toBe(false);
  });

  it('rejects a non-semver testedCoreVersion', () => {
    const { valid, errors } = validateManifest(validManifest({ compatibility: { testedCoreVersion: 'v1' } }));
    expect(valid).toBe(false);
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('testedCoreVersion')]));
  });

  it('rejects a non-positive-integer minHostApiVersion', () => {
    expect(validateManifest(validManifest({ compatibility: { minHostApiVersion: 0 } })).valid).toBe(false);
    expect(validateManifest(validManifest({ compatibility: { minHostApiVersion: 1.5 } })).valid).toBe(false);
    expect(validateManifest(validManifest({ compatibility: { minHostApiVersion: '1' } })).valid).toBe(false);
  });

  it('extracts the network domains from a capability list', () => {
    expect(networkDomainsOf(['habits:read', 'network:api.strava.com', 'network:www.strava.com']))
      .toEqual(['api.strava.com', 'www.strava.com']);
    expect(networkDomainsOf([])).toEqual([]);
    expect(networkDomainsOf(undefined)).toEqual([]);
  });
});
