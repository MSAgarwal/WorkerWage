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

describe('v6 Security Hardening Integration Tests (SEC-01, SEC-02, AUTH-01)', () => {
  it('SEC-01: accepts allowed local development origin in CORS preflight', async () => {
    const res = await apiRequest('/api/health', 'OPTIONS', null, {
      'Origin': 'http://localhost:5000',
      'Access-Control-Request-Method': 'GET'
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5000');
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
  });

  it('SEC-01: blocks untrusted external origin and unapproved trycloudflare tunnel', async () => {
    // 1. Random untrusted origin
    const resEvil = await apiRequest('/api/health', 'OPTIONS', null, {
      'Origin': 'https://evil-attacker-site.com',
      'Access-Control-Request-Method': 'GET'
    });
    // CORS middleware either errors or does not set Access-Control-Allow-Origin
    assert.notEqual(resEvil.headers['access-control-allow-origin'], 'https://evil-attacker-site.com');

    // 2. Unapproved trycloudflare.com subdomain
    const resTunnel = await apiRequest('/api/health', 'OPTIONS', null, {
      'Origin': 'https://rogue-subdomain.trycloudflare.com',
      'Access-Control-Request-Method': 'GET'
    });
    assert.notEqual(resTunnel.headers['access-control-allow-origin'], 'https://rogue-subdomain.trycloudflare.com');
  });

  it('SEC-01: CSRF protection blocks cross-site cookie-authenticated state-changing requests', async () => {
    // Authenticate admin to obtain cookie
    const loginRes = await apiRequest('/api/auth/verify', 'POST', { pin: ADMIN_PIN });
    assert.equal(loginRes.status, 200);
    const setCookie = loginRes.headers['set-cookie'];
    assert.ok(setCookie);
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;

    // Send a state-changing POST with Sec-Fetch-Site: cross-site using the cookie
    const csrfRes = await apiRequest('/api/employees', 'POST', {
      name: 'CSRF Attack Worker',
      daily_wage: 500
    }, {
      'Cookie': cookieHeader,
      'Sec-Fetch-Site': 'cross-site'
    });

    assert.equal(csrfRes.status, 403);
    assert.equal(csrfRes.body.code, 'CSRF_BLOCKED');
  });

  it('AUTH-01: worker created without credentials cannot authenticate with 12345', async () => {
    const authRes = await apiRequest('/api/auth/verify', 'POST', { pin: ADMIN_PIN });
    const adminToken = authRes.body.token;

    // Create worker without PIN
    const createRes = await apiRequest('/api/employees', 'POST', {
      name: 'Uncredentialed Worker',
      employee_code: 'UNCRED01',
      daily_wage: 500
    }, { Authorization: `Bearer ${adminToken}` });
    assert.equal(createRes.status, 201);
    assert.equal(createRes.body.employee.has_pin, false);

    // Attempting login with 12345 fails with 403
    const loginRes = await apiRequest('/api/auth/worker-login', 'POST', {
      identifier: 'UNCRED01',
      pin: '12345'
    });
    assert.equal(loginRes.status, 403);
    assert.ok(loginRes.body.error.includes('credential setup required'));
  });
});
