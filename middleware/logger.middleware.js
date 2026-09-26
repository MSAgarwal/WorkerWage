/**
 * Structured Request Logger Middleware
 * Logs incoming HTTP requests and response durations, skipping static assets.
 */
function requestLogger(req, res, next) {
  if (
    req.url.startsWith('/css') ||
    req.url.startsWith('/js') ||
    req.url.startsWith('/img') ||
    req.url === '/favicon.ico'
  ) {
    return next();
  }

  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '-';
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl || req.url} ${res.statusCode} (${duration}ms) - IP: ${ip}`
    );
  });
  next();
}

module.exports = {
  requestLogger
};
