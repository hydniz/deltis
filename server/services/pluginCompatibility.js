// Cross-checks a plugin's declared compatibility (manifest.compatibility,
// see docs/plugins/MANIFEST.md) against what this core server actually is —
// its own semver version and its Plugin Host API version. Nothing here
// blocks a plugin from running; it only produces warnings the admin/user
// sees (routes/plugins.js) and that get logged, so an operator always knows
// when a plugin hasn't been tested against the server version they're
// actually running.
const pkg = require('../../package.json');

// Bump whenever a Plugin Host API route/capability is added or changed in a
// way a plugin might need to know about (new routes are additive and don't
// require a bump; only changes to existing route/response shapes do).
const PLUGIN_HOST_API_VERSION = 1;

// Minimal semver compare (no dependency) — returns -1/0/1 like Array.sort
// comparators. Only the MAJOR.MINOR.PATCH triple is compared; a prerelease
// suffix (e.g. "-beta.1") is stripped since "tested against 0.6.0-beta.1"
// and "0.6.0" carry the same practical meaning for this check.
function compareSemver(a, b) {
  const parse = (v) => String(v).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const [aMaj, aMin, aPatch] = parse(a);
  const [bMaj, bMin, bPatch] = parse(b);
  if (aMaj !== bMaj) return aMaj < bMaj ? -1 : 1;
  if (aMin !== bMin) return aMin < bMin ? -1 : 1;
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1;
  return 0;
}

const SEMVER_RE = /^\d+\.\d+\.\d+/;

// Returns a list of German warning strings — empty when no issue is
// detected (including when the manifest declares no compatibility info at
// all: absence isn't itself a warning, since we can't assess it either way).
function checkCompatibility(manifest) {
  const warnings = [];
  const compat = manifest?.compatibility;
  if (!compat) return warnings;

  if (compat.minHostApiVersion != null && compat.minHostApiVersion > PLUGIN_HOST_API_VERSION) {
    warnings.push(
      `Dieses Plugin benötigt Plugin-Host-API-Version ${compat.minHostApiVersion}, dieser Server bietet nur Version ${PLUGIN_HOST_API_VERSION} — möglicherweise nicht kompatibel.`
    );
  }

  if (typeof compat.testedCoreVersion === 'string' && SEMVER_RE.test(compat.testedCoreVersion)) {
    if (compareSemver(compat.testedCoreVersion, pkg.version) < 0) {
      warnings.push(
        `Dieses Plugin wurde nur mit Deltis ${compat.testedCoreVersion} getestet, dieser Server läuft mit ${pkg.version} — möglicherweise nicht vollständig kompatibel.`
      );
    }
  }

  return warnings;
}

module.exports = { PLUGIN_HOST_API_VERSION, compareSemver, checkCompatibility };
