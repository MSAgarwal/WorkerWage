const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

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

describe('Health & Diagnostic API Integration Tests', () => {
  it('GET /api/health returns HTTP 200 with healthy database and WAL mode', async () => {
    const res = await apiRequest('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'healthy');
    assert.equal(res.body.database.integrity, 'OK');
    assert.equal(res.body.database.journalMode, 'wal');
    assert.ok(typeof res.body.uptime === 'number');
  });

  it('GET /api/nonexistent returns structured 404 JSON error', async () => {
    const res = await apiRequest('/api/nonexistent');
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'NOT_FOUND');
    assert.ok(res.body.error.includes('not found'));
  });

  it('GET /api/server-info requires authentication and returns connection details for admin', async () => {
    // Unauthenticated request should be rejected
    const unauth = await apiRequest('/api/server-info');
    assert.equal(unauth.status, 401);

    // Authenticate admin
    const authRes = await apiRequest('/api/auth/verify', 'POST', { pin: ADMIN_PIN });
    assert.equal(authRes.status, 200);
    const token = authRes.body.token;

    // Authenticated request succeeds
    const res = await apiRequest('/api/server-info', 'GET', null, {
      'Authorization': `Bearer ${token}`
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(Number(res.body.port), PORT);
    assert.ok(res.body.localUrl);
    assert.ok(res.body.networkUrl);
    assert.ok(res.body.qrCodeDataUrl);
  });
});
