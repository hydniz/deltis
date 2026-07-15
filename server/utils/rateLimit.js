// Minimal in-memory rate limiter (fixed window, keyed by client IP).
// Sufficient for a single-instance self-hosted deployment — no external
// store needed. State resets on server restart, which is acceptable for
// abuse protection of auth endpoints.

function createRateLimiter({ windowMs, max, message }) {
  const hits = new Map();

  // Lazy sweep instead of a timer: keeps tests free of open handles and the
  // map bounded even under address-spoofing attempts.
  function sweep(now) {
    if (hits.size < 500) return;
    for (const [key, entry] of hits) {
      if (now >= entry.resetAt) hits.delete(key);
    }
  }

  const limiter = (req, res, next) => {
    const now = Date.now();
    sweep(now);

    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    let entry = hits.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };

  limiter.reset = () => hits.clear(); // for tests
  return limiter;
}

module.exports = { createRateLimiter };
