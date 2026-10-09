const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SlidingWindowRateLimiter } = require('../../middleware/rate-limit.middleware');

describe('Rate Limiter Unit Tests', () => {
  it('allows requests within window threshold', () => {
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 1000,
      max: 3,
      whitelist: [],
      skipTestBypass: true
    });
    const mw = limiter.middleware();

    let nextCalled = 0;
    const req = { ip: '10.0.0.1', headers: {} };
    const res = {
      headers: {},
      setHeader(k, v) { this.headers[k] = v; }
    };
    const next = () => { nextCalled++; };

    mw(req, res, next);
    mw(req, res, next);
    mw(req, res, next);

    assert.equal(nextCalled, 3);
    assert.equal(res.headers['RateLimit-Remaining'], 0);
  });

  it('blocks excess requests with 429 RATE_LIMIT_EXCEEDED', () => {
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 5000,
      max: 2,
      whitelist: [],
      skipTestBypass: true
    });
    const mw = limiter.middleware();

    let statusCode = 200;
    let jsonResponse = null;
    const req = { ip: '10.0.0.2', headers: {} };
    const res = {
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(code) {
        statusCode = code;
        return {
          json: (data) => { jsonResponse = data; }
        };
      }
    };
    const next = () => {};

    // 1st & 2nd allowed
    mw(req, res, next);
    mw(req, res, next);

    // 3rd should be blocked
    mw(req, res, next);

    assert.equal(statusCode, 429);
    assert.ok(jsonResponse);
    assert.equal(jsonResponse.code, 'RATE_LIMIT_EXCEEDED');
    assert.ok(jsonResponse.retryAfter > 0);
  });

  it('exempts whitelisted IP addresses from rate limits', () => {
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 5000,
      max: 1,
      whitelist: ['127.0.0.1']
    });
    const mw = limiter.middleware();

    let nextCount = 0;
    const req = { ip: '127.0.0.1', headers: {} };
    const res = {
      headers: {},
      setHeader(k, v) { this.headers[k] = v; }
    };
    const next = () => { nextCount++; };

    for (let i = 0; i < 10; i++) {
      mw(req, res, next);
    }

    assert.equal(nextCount, 10);
  });

  it('cleans up expired timestamps during cleanup cycle', () => {
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 50,
      max: 5,
      whitelist: []
    });

    limiter.hits.set('test-client', [Date.now() - 100]);
    limiter.cleanup();

    assert.equal(limiter.hits.has('test-client'), false);
  });
});
