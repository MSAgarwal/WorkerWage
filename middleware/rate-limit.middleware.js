const config = require('../config/env');

/**
 * In-memory sliding window rate limiter (Zero external dependencies).
 * Automatically tracks request timestamps per client IP and cleans up expired entries.
 */
class SlidingWindowRateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60 * 1000;
    this.max = options.max || 100;
    this.message = options.message || 'Too many requests, please try again later.';
    this.whitelist = options.whitelist || ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
    this.skipTestBypass = !!options.skipTestBypass;
    this.hits = new Map(); // ip -> Array of timestamps

    // Regular interval to purge old keys to keep memory footprint minimal
    this.cleanupTimer = setInterval(() => this.cleanup(), Math.max(30000, this.windowMs));
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  cleanup() {
    const now = Date.now();
    for (const [key, timestamps] of this.hits.entries()) {
      const valid = timestamps.filter(t => now - t < this.windowMs);
      if (valid.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, valid);
      }
    }
  }

  getClientKey(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    return req.ip || (req.socket && req.socket.remoteAddress) || '127.0.0.1';
  }

  middleware() {
    return (req, res, next) => {
      // In test mode, bypass rate limiting to prevent test flakiness (unless unit testing limiter directly)
      if (config.IS_TEST && !this.skipTestBypass) {
        return next();
      }

      const clientIp = this.getClientKey(req);

      // Loopback/localhost whitelist for local server console operations
      if (this.whitelist.includes(clientIp)) {
        return next();
      }

      const now = Date.now();
      const windowStart = now - this.windowMs;

      let timestamps = this.hits.get(clientIp) || [];
      timestamps = timestamps.filter(t => t > windowStart);

      if (timestamps.length >= this.max) {
        const oldest = timestamps[0];
        const retryAfter = Math.ceil((oldest + this.windowMs - now) / 1000);

        res.setHeader('Retry-After', Math.max(1, retryAfter));
        res.setHeader('RateLimit-Limit', this.max);
        res.setHeader('RateLimit-Remaining', 0);
        res.setHeader('RateLimit-Reset', Math.ceil((oldest + this.windowMs) / 1000));

        return res.status(429).json({
          success: false,
          error: this.message,
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: Math.max(1, retryAfter)
        });
      }

      timestamps.push(now);
      this.hits.set(clientIp, timestamps);

      res.setHeader('RateLimit-Limit', this.max);
      res.setHeader('RateLimit-Remaining', Math.max(0, this.max - timestamps.length));
      res.setHeader('RateLimit-Reset', Math.ceil((now + this.windowMs) / 1000));

      next();
    };
  }
}

const globalRateLimiter = new SlidingWindowRateLimiter({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX_REQUESTS,
  message: 'High traffic detected. Please slow down and try again shortly.'
}).middleware();

const authRateLimiter = new SlidingWindowRateLimiter({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.AUTH_RATE_LIMIT_MAX,
  message: 'Too many authentication attempts. Please wait a minute before trying again.'
}).middleware();

module.exports = {
  SlidingWindowRateLimiter,
  globalRateLimiter,
  authRateLimiter
};
