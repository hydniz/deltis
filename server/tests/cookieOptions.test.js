const { authCookieOptions, clearCookieOptions, MAX_AGE_MS } = require('../utils/cookieOptions');

describe('cookieOptions', () => {
  it('marks the cookie Secure only when the request is HTTPS', () => {
    expect(authCookieOptions({ secure: true }).secure).toBe(true);
    expect(authCookieOptions({ secure: false }).secure).toBe(false);
    // A missing req.secure (never HTTPS) coerces to false, not undefined.
    expect(authCookieOptions({}).secure).toBe(false);
  });

  it('always sets httpOnly, lax same-site and the 30-day lifetime', () => {
    const opts = authCookieOptions({ secure: true });
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('lax');
    expect(opts.maxAge).toBe(MAX_AGE_MS);
  });

  it('mirrors the Secure flag when clearing, without a maxAge', () => {
    expect(clearCookieOptions({ secure: true }).secure).toBe(true);
    expect(clearCookieOptions({ secure: false }).secure).toBe(false);
    expect(clearCookieOptions({ secure: true }).maxAge).toBeUndefined();
  });
});
