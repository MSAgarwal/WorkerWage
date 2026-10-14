/**
 * Security Headers Middleware
 * Protects against MIME-sniffing, clickjacking, and XSS attacks.
 */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'"
  );
  next();
}

/**
 * CSRF Protection for Cookie-Authenticated State-Changing Requests (SEC-01)
 * Protects against cross-site request forgery when using ambient cookie sessions.
 */
function csrfProtection(isAllowedOrigin) {
  return (req, res, next) => {
    const stateChangingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
    if (!stateChangingMethods.includes(req.method)) {
      return next();
    }

    // Explicit Bearer tokens are not vulnerable to ambient cookie CSRF
    const hasBearerAuth = req.headers.authorization && req.headers.authorization.startsWith('Bearer ');
    if (hasBearerAuth) {
      return next();
    }

    // Public unauthenticated endpoints do not possess ambient session state
    if (req.path === '/auth/verify' || req.path === '/auth/worker-login') {
      return next();
    }

    // Only apply if session cookies (admin_token or worker_token) are present
    const hasAuthCookie = req.cookies && (req.cookies.admin_token || req.cookies.worker_token);
    if (!hasAuthCookie) {
      return next();
    }

    // Modern browsers: Sec-Fetch-Site protection
    const secFetchSite = req.headers['sec-fetch-site'];
    if (secFetchSite && secFetchSite === 'cross-site') {
      return res.status(403).json({
        success: false,
        error: 'Cross-site request blocked by CSRF policy',
        code: 'CSRF_BLOCKED'
      });
    }

    // Validate Origin header if present
    const origin = req.headers['origin'];
    if (origin && typeof isAllowedOrigin === 'function') {
      if (!isAllowedOrigin(origin)) {
        return res.status(403).json({
          success: false,
          error: 'Invalid request origin',
          code: 'INVALID_ORIGIN'
        });
      }
    }

    next();
  };
}

module.exports = {
  securityHeaders,
  csrfProtection
};
