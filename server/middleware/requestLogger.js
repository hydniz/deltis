// Logs every API request as one detailed info-level entry once the response
// is finished: method, path, status, duration, authenticated user, client IP
// and — for mutating requests — the sanitized body. Bodies pass through the
// logger's redaction (passwords, tokens, UUIDs … never reach the log file).
const logger = require('../utils/logger');

// SSE streams stay open for minutes and would log misleading durations.
const SKIP_PATHS = ['/api/admin/update/stream'];

module.exports = function requestLogger(req, res, next) {
  if (SKIP_PATHS.includes(req.path)) return next();
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const meta = {
      ip: req.ip,
      durationMs: Math.round(durationMs * 10) / 10,
      userId: req.user?._id ? String(req.user._id) : undefined,
      query: Object.keys(req.query || {}).length ? req.query : undefined,
    };
    if (req.method !== 'GET' && req.body && Object.keys(req.body).length) {
      meta.body = req.body; // sanitized by the logger
    }
    logger.info('http', `${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode}`, meta);
  });

  next();
};
