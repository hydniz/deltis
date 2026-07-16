// Options for the httpOnly JWT session cookie (auth_token).
//
// `secure` follows the ACTUAL request protocol (req.secure) rather than
// NODE_ENV. This matters for the common self-hosted setup: an instance reached
// over plain HTTP (e.g. http://<nas-ip>:3001, as documented in SETUP.md) must
// NOT receive a Secure cookie — the browser would silently drop it and every
// request after login would land back on the login page ("Sitzung abgelaufen").
//
// Behind an HTTPS-terminating reverse proxy, set TRUST_PROXY (see index.js) so
// req.secure reflects the X-Forwarded-Proto header and the cookie is hardened
// with the Secure attribute again. Direct HTTPS works without any extra config.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Options for res.cookie() when issuing a session.
function authCookieOptions(req) {
  return {
    httpOnly: true,
    secure: !!req.secure,
    sameSite: 'lax',
    maxAge: MAX_AGE_MS,
  };
}

// Options for res.clearCookie(). Must match the attributes the cookie was set
// with (minus maxAge) so the browser reliably removes it.
function clearCookieOptions(req) {
  return {
    httpOnly: true,
    secure: !!req.secure,
    sameSite: 'lax',
  };
}

module.exports = { authCookieOptions, clearCookieOptions, MAX_AGE_MS };
