#!/usr/bin/env node
// Verifies that a release tag matches the versions checked into package.json
// (root + client) and that the tag's prerelease suffix matches the "stage"
// field. Called by the release/deploy workflows BEFORE anything is built or
// shipped, so a tag created without bumping the versions fails fast instead
// of publishing a build that reports the previous version (v0.5.5/v0.5.6
// both shipped reporting 0.5.4 this way).
//
// Usage: node scripts/verify-release-version.js <tag>   e.g. v0.5.7
const path = require('path');

// Returns a list of problems; empty = tag and versions are consistent.
function verify(tag, rootPkg, clientPkg) {
  const match = /^v(\d+\.\d+\.\d+)(?:-([a-z]+)(?:\.\d+)?)?$/.exec(String(tag || ''));
  if (!match) {
    return [`tag "${tag}" is not a release tag (expected vX.Y.Z or vX.Y.Z-<stage>.N)`];
  }
  const [, base, suffix = ''] = match;

  const problems = [];
  for (const [name, pkg] of [['package.json', rootPkg], ['client/package.json', clientPkg]]) {
    if (pkg.version !== base) {
      problems.push(`${name}: version "${pkg.version}" does not match tag base "${base}"`);
    }
    const stage = pkg.stage || '';
    if (stage !== suffix) {
      problems.push(`${name}: stage "${stage}" does not match tag suffix "${suffix}"`);
    }
  }
  return problems;
}

if (require.main === module) {
  const tag = process.argv[2];
  const rootPkg = require(path.join(__dirname, '..', 'package.json'));
  const clientPkg = require(path.join(__dirname, '..', 'client', 'package.json'));

  const problems = verify(tag, rootPkg, clientPkg);
  if (problems.length > 0) {
    console.error(`✗ Release tag ${tag} does not match the checked-in versions:`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error('  Bump "version" (and "stage") in package.json AND client/package.json,');
    console.error('  commit, then delete and re-create the tag.');
    process.exit(1);
  }
  console.log(`✓ ${tag} matches package.json versions.`);
}

module.exports = { verify };
