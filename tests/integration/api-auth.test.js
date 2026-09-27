const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const jwt = require('jsonwebtoken');

const PORT = parseInt(process.env.PORT, 10) || 5099;
const ADMIN_PIN = process.env.DEFAULT_ADMIN_PIN || 'test-pin-9876';

function apiRequest(path, method = 'GET', data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (e) { json = body; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

describe('Authentication & Security API Integration Tests', () => {
  it('denies access to protected routes when unauthorized (no token)', async () => {
    const res = await apiRequest('/api/settings');
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'UNAUTHORIZED');
  });

  it('rejects incorrect PIN with 401', async () => {
    const res = await apiRequest('/api/auth/verify', 'POST', { pin: '000000' });
    assert.equal(res.status, 401);
    assert.ok(res.body.error.includes('Incorrect Admin PIN'));
  });

  it('authenticates with correct PIN and returns signed JWT token', async () => {
    const res = await apiRequest('/api/auth/verify', 'POST', { pin: ADMIN_PIN });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.token, 'Should return JWT token');
    assert.ok(res.headers['set-cookie'], 'Should set HTTP-only admin_token cookie');
  });

  it('allows access to protected routes with valid Bearer token', async () => {
    const authRes = await apiRequest('/api/auth/verify', 'POST', { pin: ADMIN_PIN });
    const token = authRes.body.token;

    const settingsRes = await apiRequest('/api/settings', 'GET', null, {
      'Authorization': `Bearer ${token}`
    });
    assert.equal(settingsRes.status, 200);
    assert.equal(settingsRes.body.success, true);
    assert.ok(settingsRes.body.settings);
  });

  it('verifies token validity via GET /api/auth/check', async () => {
    const authRes = await apiRequest('/api/auth/verify', 'POST', { pin: ADMIN_PIN });
    const token = authRes.body.token;

    const checkRes = await apiRequest('/api/auth/check', 'GET', null, {
      'Authorization': `Bearer ${token}`
    });
    assert.equal(checkRes.status, 200);
    assert.equal(checkRes.body.authenticated, true);
    assert.equal(checkRes.body.user.role, 'admin');
  });

  it('rejects forged JWT signed with an arbitrary/attacker secret (401)', async () => {
    const forgedToken = jwt.sign(
      { role: 'admin' },
      'attacker-arbitrary-unauthorized-secret-key-12345',
      { expiresIn: '7d' }
    );

    const res = await apiRequest('/api/settings', 'GET', null, {
      'Authorization': `Bearer ${forgedToken}`
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'SESSION_EXPIRED');
  });

  it('rejects expired JWT token (401)', async () => {
    const expiredToken = jwt.sign(
      { role: 'admin' },
      process.env.JWT_SECRET || 'test-jwt-secret-isolated-automated-runner-987654321',
      { expiresIn: '-1s' }
    );

    const res = await apiRequest('/api/settings', 'GET', null, {
      'Authorization': `Bearer ${expiredToken}`
    });
    assert.equal(res.status, 401);
  });

  it('rejects token passed via query string parameter (no URL token leakage)', async () => {
    const authRes = await apiRequest('/api/auth/verify', 'POST', { pin: ADMIN_PIN });
    const token = authRes.body.token;

    // Passing token in query parameter must NOT be accepted on protected routes
    const res = await apiRequest(`/api/settings?token=${token}`, 'GET');
    assert.equal(res.status, 401);
  });
});
