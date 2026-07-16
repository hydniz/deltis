// Security response headers for every request (API and static frontend).
// Hand-rolled instead of helmet to avoid an extra dependency; the set below
// matches helmet's relevant defaults for this app.
//
// CSP notes:
// - script-src needs 'unsafe-inline' for the theme bootstrap script in
//   client/index.html (runs before first paint).
// - style-src/font-src allow the Google Fonts used by the frontend.
// - frame-ancestors 'none' + X-Frame-Options DENY: the app is never embedded.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

module.exports = function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', CSP);
  // HSTS only in production: browsers ignore it over plain HTTP, and dev
  // setups must not accidentally pin localhost to HTTPS.
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  }
  next();
};
