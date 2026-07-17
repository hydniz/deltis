const { verify } = require('../../scripts/verify-release-version');

const pkg = (version, stage = '') => ({ version, stage });

describe('verify-release-version', () => {
  it('accepts a stable tag matching both package.json files', () => {
    expect(verify('v0.5.7', pkg('0.5.7'), pkg('0.5.7'))).toEqual([]);
  });

  it('accepts a prerelease tag when the stage field matches', () => {
    expect(verify('v0.6.0-beta.1', pkg('0.6.0', 'beta'), pkg('0.6.0', 'beta'))).toEqual([]);
    expect(verify('v0.6.0-alpha.2', pkg('0.6.0', 'alpha'), pkg('0.6.0', 'alpha'))).toEqual([]);
  });

  it('rejects the v0.5.6 scenario: tag bumped, package.json not', () => {
    const problems = verify('v0.5.6', pkg('0.5.4'), pkg('0.5.4'));
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('package.json');
    expect(problems[0]).toContain('0.5.4');
    expect(problems[0]).toContain('0.5.6');
  });

  it('rejects when only one of the two package.json files was bumped', () => {
    const problems = verify('v0.5.7', pkg('0.5.7'), pkg('0.5.4'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('client/package.json');
  });

  it('rejects a stable tag while a stage is still set', () => {
    const problems = verify('v0.5.7', pkg('0.5.7', 'beta'), pkg('0.5.7'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('stage "beta"');
  });

  it('rejects a prerelease tag when the stage field is empty', () => {
    const problems = verify('v0.5.7-beta.1', pkg('0.5.7'), pkg('0.5.7'));
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('does not match tag suffix "beta"');
  });

  it('rejects malformed tags', () => {
    for (const tag of ['0.5.7', 'v0.5', 'main', '', undefined, 'v0.5.7-beta-1']) {
      const problems = verify(tag, pkg('0.5.7'), pkg('0.5.7'));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('not a release tag');
    }
  });
});
