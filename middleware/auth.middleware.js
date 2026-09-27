const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../db');

// In-memory rate limiter store for PIN attempts
const authAttempts = new Map(); // ip -> { count, firstAttempt, lockedUntil }
const AUTH_MAX_ATTEMPTS = 5;
const AUTH_WINDOW_MS = 60 * 1000; // 1 minute window
const AUTH_LOCK_MS = 2 * 60 * 1000; // 2 minutes lockout

/**
 * Middleware: Rate limiter for PIN authentication (brute-force protection)
 */
function checkAuthRateLimit(req, res, next) {
  const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  const record = authAttempts.get(clientIp);

  if (record) {
    if (record.lockedUntil && now < record.lockedUntil) {
      const remainingSec = Math.ceil((record.lockedUntil - now) / 1000);
      return res.status(429).json({
        error: `Too many failed PIN attempts. Please wait ${remainingSec} seconds before trying again.`,
        retryAfter: remainingSec
      });
    }
    if (now - record.firstAttempt > AUTH_WINDOW_MS) {
      authAttempts.set(clientIp, { count: 0, firstAttempt: now, lockedUntil: 0 });
    }
  } else {
    authAttempts.set(clientIp, { count: 0, firstAttempt: now, lockedUntil: 0 });
  }

  next();
}

/**
 * Record a failed authentication attempt for rate limiting
 */
function recordAuthFailure(clientIp) {
  const now = Date.now();
  const record = authAttempts.get(clientIp) || { count: 0, firstAttempt: now, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= AUTH_MAX_ATTEMPTS) {
    record.lockedUntil = now + AUTH_LOCK_MS;
  }
  authAttempts.set(clientIp, record);
}

/**
 * Reset authentication failure counter upon successful login
 */
function recordAuthSuccess(clientIp) {
  authAttempts.delete(clientIp);
}

/**
 * Middleware: Require Admin Authentication via JWT token
 * Supports:
 * 1. Authorization: Bearer <token>
 * 2. HttpOnly Cookie: admin_token
 */
function requireAdmin(req, res, next) {
  let token = null;

  // 1. Authorization header: Bearer <token>
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  // 2. HttpOnly Cookie
  if (!token && req.cookies && req.cookies.admin_token) {
    token = req.cookies.admin_token;
  }

  if (!token) {
    return res.status(401).json({
      error: 'Admin authentication required. Please unlock with PIN.',
      code: 'UNAUTHORIZED'
    });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      error: 'Invalid or expired session. Please unlock again.',
      code: 'SESSION_EXPIRED'
    });
  }
}

module.exports = {
  checkAuthRateLimit,
  recordAuthFailure,
  recordAuthSuccess,
  requireAdmin
};
