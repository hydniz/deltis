// Request sanitizer: strips MongoDB operator keys ($…), dotted paths and
// prototype-pollution keys from req.body and req.query before any route
// touches them. Values are never modified — only malicious KEYS are removed,
// so legitimate payloads pass through unchanged.
//
// This is the safety net behind the per-route field whitelists: even if a
// route passes an object into a Mongoose query or update, no client-supplied
// `$where`, `$gt`, `field.nested` or `__proto__` key can reach the database.

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isUnsafeKey(key) {
  return key.startsWith('$') || key.includes('.') || BLOCKED_KEYS.has(key);
}

function sanitize(value) {
  if (!value || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    for (const item of value) sanitize(item);
    return value;
  }

  for (const key of Object.keys(value)) {
    if (isUnsafeKey(key)) {
      delete value[key];
      continue;
    }
    sanitize(value[key]);
  }
  return value;
}

module.exports = function sanitizeBody(req, _res, next) {
  if (req.body) sanitize(req.body);
  if (req.query) sanitize(req.query);
  next();
};

// Exported for direct unit testing.
module.exports._sanitize = sanitize;
