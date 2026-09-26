const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

function apiRequest(path, method = 'GET', data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
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
    const res = await apiRequest('/api/auth/verify', 'POST', { pin: '0000' });
    assert.equal(res.status, 401);
    assert.ok(res.body.error.includes('Incorrect Admin PIN'));
  });

  it('authenticates with correct PIN and returns signed JWT token', async () => {
    const res = await apiRequest('/api/auth/verify', 'POST', { pin: '1234' });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.token, 'Should return JWT token');
    assert.ok(res.headers['set-cookie'], 'Should set HTTP-only admin_token cookie');
  });

  it('allows access to protected routes with valid Bearer token', async () => {
    // Authenticate first
    const authRes = await apiRequest('/api/auth/verify', 'POST', { pin: '1234' });
    const token = authRes.body.token;

    const settingsRes = await apiRequest('/api/settings', 'GET', null, {
      'Authorization': `Bearer ${token}`
    });
    assert.equal(settingsRes.status, 200);
    assert.equal(settingsRes.body.success, true);
    assert.ok(settingsRes.body.settings);
  });

  it('verifies token validity via GET /api/auth/check', async () => {
    const authRes = await apiRequest('/api/auth/verify', 'POST', { pin: '1234' });
    const token = authRes.body.token;

    const checkRes = await apiRequest('/api/auth/check', 'GET', null, {
      'Authorization': `Bearer ${token}`
    });
    assert.equal(checkRes.status, 200);
    assert.equal(checkRes.body.authenticated, true);
    assert.equal(checkRes.body.user.role, 'admin');
  });
});
