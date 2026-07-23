// Plugin manifest schema + validator (deltis-plugin.json).
//
// A plugin manifest is the single source of truth for what a plugin is and
// what it may access. It is validated here on install (this server) and
// again on submission to the store backend (deltis-store-backend duplicates
// this validator — keep both in sync, see docs/plugins/MANIFEST.md).
//
// Capability vocabulary: a fixed list of data/UI/background/notification
// capabilities, plus one open-ended family (`network:<domain>`) so a plugin
// can request outbound access to exactly the third-party hosts it needs.
// Nothing outside this vocabulary is a valid capability — an unknown string
// fails validation rather than being silently granted.

const DATA_CAPABILITIES = [
  'habits:read', 'habits:write',
  'activities:read', 'activities:write',
  'goals:read', 'goals:write',
  'planner:read', 'planner:write',
  'weight:read', 'weight:write',
  'user:read',
];

const UI_CAPABILITIES = ['ui:dashboard-widget', 'ui:settings-panel', 'ui:goal-criteria-provider'];
const BACKGROUND_CAPABILITIES = ['background:cron', 'background:webhook-receiver'];
const NOTIFICATION_CAPABILITIES = ['notifications:send'];

const FIXED_CAPABILITIES = [
  ...DATA_CAPABILITIES,
  ...UI_CAPABILITIES,
  ...BACKGROUND_CAPABILITIES,
  ...NOTIFICATION_CAPABILITIES,
];

// network:<domain> — one capability per distinct outbound host.
const NETWORK_CAPABILITY_RE = /^network:[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const RUNTIME_TYPES = ['docker'];
const DOCKER_IMAGE_RE = /^[a-z0-9]+([._-][a-z0-9]+)*(\/[a-z0-9]+([._-][a-z0-9]+)*)*(:[\w][\w.-]{0,127})?$/;

function isValidCapability(cap) {
  return typeof cap === 'string' && (FIXED_CAPABILITIES.includes(cap) || NETWORK_CAPABILITY_RE.test(cap));
}

// Validates a manifest object. Returns { valid, errors } — never throws, so
// callers (install route, store submission) can always show every problem
// at once instead of stopping at the first one.
function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: ['Manifest muss ein JSON-Objekt sein.'] };
  }

  if (manifest.manifestVersion !== 1) errors.push('manifestVersion muss 1 sein.');
  if (typeof manifest.id !== 'string' || !ID_RE.test(manifest.id)) {
    errors.push('id muss lowercase kebab-case sein, 3-64 Zeichen (a-z, 0-9, -), darf nicht mit "-" beginnen.');
  }
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) errors.push('name darf nicht leer sein.');
  if (typeof manifest.version !== 'string' || !SEMVER_RE.test(manifest.version)) {
    errors.push('version muss Semver sein (z. B. "1.0.0").');
  }
  if (typeof manifest.description !== 'string' || !manifest.description.trim()) {
    errors.push('description darf nicht leer sein.');
  }
  if (typeof manifest.author !== 'string' || !manifest.author.trim()) errors.push('author darf nicht leer sein.');

  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
    errors.push('capabilities muss ein nicht-leeres Array sein.');
  } else {
    const seen = new Set();
    for (const cap of manifest.capabilities) {
      if (!isValidCapability(cap)) {
        errors.push(`Unbekannte oder ungültige capability: "${cap}".`);
      } else if (seen.has(cap)) {
        errors.push(`Doppelte capability: "${cap}".`);
      }
      seen.add(cap);
    }
  }

  const runtime = manifest.runtime;
  if (!runtime || typeof runtime !== 'object') {
    errors.push('runtime fehlt.');
  } else {
    if (!RUNTIME_TYPES.includes(runtime.type)) {
      errors.push(`runtime.type muss eines von [${RUNTIME_TYPES.join(', ')}] sein.`);
    }
    if (runtime.type === 'docker' && (typeof runtime.image !== 'string' || !DOCKER_IMAGE_RE.test(runtime.image))) {
      errors.push('runtime.image muss eine gültige Docker-Image-Referenz sein.');
    }
  }

  // Optional: which core version/Host API this plugin was last tested
  // against (server/services/pluginCompatibility.js warns when the running
  // core has moved past it). Absent is valid — it just means no automated
  // compatibility check is possible for this plugin.
  if (manifest.compatibility !== undefined) {
    const compat = manifest.compatibility;
    if (typeof compat !== 'object' || compat === null || Array.isArray(compat)) {
      errors.push('compatibility muss ein Objekt sein.');
    } else {
      if (compat.testedCoreVersion !== undefined && (typeof compat.testedCoreVersion !== 'string' || !SEMVER_RE.test(compat.testedCoreVersion))) {
        errors.push('compatibility.testedCoreVersion muss Semver sein (z. B. "0.6.0").');
      }
      if (compat.minHostApiVersion !== undefined && (!Number.isInteger(compat.minHostApiVersion) || compat.minHostApiVersion < 1)) {
        errors.push('compatibility.minHostApiVersion muss eine positive ganze Zahl sein.');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// The domain part of every network:<domain> capability, used to configure
// container egress allowlisting (see docs/plugins/MANIFEST.md "Known
// limitations" — the allowlist is recorded here but not yet enforced at the
// Docker network layer).
function networkDomainsOf(capabilities) {
  return (capabilities || [])
    .filter((c) => typeof c === 'string' && c.startsWith('network:'))
    .map((c) => c.slice('network:'.length));
}

module.exports = {
  DATA_CAPABILITIES,
  UI_CAPABILITIES,
  BACKGROUND_CAPABILITIES,
  NOTIFICATION_CAPABILITIES,
  FIXED_CAPABILITIES,
  isValidCapability,
  validateManifest,
  networkDomainsOf,
};
