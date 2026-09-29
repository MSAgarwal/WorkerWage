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

describe('Worker Passbook & RBAC Security Integration Tests', () => {
  let adminToken = null;
  let worker1 = null;
  let worker2 = null;
  let worker1Token = null;

  it('sets up admin session and creates two test workers', async () => {
    const authRes = await apiRequest('/api/auth/verify', 'POST', { pin: ADMIN_PIN });
    assert.equal(authRes.status, 200);
    adminToken = authRes.body.token;

    // Create worker 1 with custom 5-digit PIN
    const res1 = await apiRequest('/api/employees', 'POST', {
      name: 'Sunil Packaging Worker',
      employee_code: 'TESTEMP01',
      daily_wage: 600,
      phone: '9876500001',
      worker_type: 'WORKER',
      default_box_rate: 30,
      pin: '98765'
    }, { Authorization: `Bearer ${adminToken}` });
    assert.equal(res1.status, 201);
    worker1 = res1.body.employee;
    assert.equal(worker1.has_pin, true);
    assert.equal(worker1.pin_hash, undefined, 'pin_hash must not be exposed');

    // Reject worker creation with PIN shorter than 5 digits
    const resShortPin = await apiRequest('/api/employees', 'POST', {
      name: 'Invalid Short Pin Worker',
      daily_wage: 500,
      pin: '1234' // Only 4 digits
    }, { Authorization: `Bearer ${adminToken}` });
    assert.equal(resShortPin.status, 400);
    assert.ok(resShortPin.body.details.some(d => d.includes('at least 5 digits')));

    // Create worker 2 (Manager) without explicit PIN (defaults to '12345')
    const res2 = await apiRequest('/api/employees', 'POST', {
      name: 'Anil Factory Manager',
      employee_code: 'TESTEMP02',
      daily_wage: 900,
      phone: '9876500002',
      worker_type: 'MANAGER'
    }, { Authorization: `Bearer ${adminToken}` });
    assert.equal(res2.status, 201);
    worker2 = res2.body.employee;

    // Record attendance and advance for worker 1
    const attRes = await apiRequest('/api/attendance', 'POST', {
      employee_id: worker1.id,
      date: '2026-09-01',
      status: 'PRESENT',
      work_category: 'Sp 100',
      extra_boxes: 10
    }, { Authorization: `Bearer ${adminToken}` });
    assert.equal(attRes.status, 200);

    const payRes = await apiRequest('/api/payments', 'POST', {
      employee_id: worker1.id,
      date: '2026-09-02',
      amount: 500,
      type: 'ADVANCE',
      payment_method: 'CASH',
      notes: 'Test cash advance'
    }, { Authorization: `Bearer ${adminToken}` });
    assert.equal(payRes.status, 200);
    assert.equal(payRes.body.success, true);
  });

  it('POST /api/auth/worker-login rejects invalid or empty identifiers', async () => {
    const res1 = await apiRequest('/api/auth/worker-login', 'POST', { identifier: '', pin: '98765' });
    assert.equal(res1.status, 400);

    const res2 = await apiRequest('/api/auth/worker-login', 'POST', { identifier: 'NONEXISTENT999', pin: '98765' });
    assert.equal(res2.status, 404);
  });

  it('POST /api/auth/worker-login enforces minimum 5-digit PIN and rejects wrong password', async () => {
    // 1. Missing PIN
    const resNoPin = await apiRequest('/api/auth/worker-login', 'POST', { identifier: 'testemp01' });
    assert.equal(resNoPin.status, 400);

    // 2. Short PIN (< 5 digits)
    const resShortPin = await apiRequest('/api/auth/worker-login', 'POST', { identifier: 'testemp01', pin: '1234' });
    assert.equal(resShortPin.status, 400);

    // 3. Incorrect PIN
    const resWrongPin = await apiRequest('/api/auth/worker-login', 'POST', { identifier: 'testemp01', pin: '00000' });
    assert.equal(resWrongPin.status, 401);
    assert.ok(resWrongPin.body.error.includes('Incorrect Passbook password'));
  });

  it('POST /api/auth/worker-login authenticates by worker code and phone with correct PIN', async () => {
    // Authenticate worker 1 with custom pin '98765' and lowercase code
    const resCode = await apiRequest('/api/auth/worker-login', 'POST', { identifier: 'testemp01', pin: '98765' });
    assert.equal(resCode.status, 200);
    assert.equal(resCode.body.success, true);
    assert.equal(resCode.body.worker.id, worker1.id);
    assert.ok(resCode.body.token);
    assert.ok(resCode.headers['set-cookie'], 'Should set worker_token cookie');
    worker1Token = resCode.body.token;

    // Authenticate worker 1 with phone number and PIN
    const resPhone = await apiRequest('/api/auth/worker-login', 'POST', { identifier: '9876500001', pin: '98765' });
    assert.equal(resPhone.status, 200);
    assert.equal(resPhone.body.worker.employee_code, 'TESTEMP01');

    // Authenticate worker 2 with default pin '12345'
    const resWorker2 = await apiRequest('/api/auth/worker-login', 'POST', { identifier: 'TESTEMP02', pin: '12345' });
    assert.equal(resWorker2.status, 200);
    assert.equal(resWorker2.body.worker.id, worker2.id);
  });

  it('GET /api/worker/passbook returns read-only data for worker session', async () => {
    const res = await apiRequest('/api/worker/passbook?month=2026-09', 'GET', null, {
      Authorization: `Bearer ${worker1Token}`
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.worker.id, worker1.id);
    assert.equal(res.body.worker.name, 'Sunil Packaging Worker');

    // Check summary calculation (wage ₹600 + 10 boxes * ₹30 = ₹900 gross, - ₹500 advance = ₹400 net)
    assert.equal(res.body.summary.grossPayTotal, 900);
    assert.equal(res.body.summary.totalAdvances, 500);
    assert.equal(res.body.summary.netPayable, 400);

    // Check attendance list
    assert.equal(res.body.attendance.length, 1);
    assert.equal(res.body.attendance[0].extra_boxes, 10);

    // Check payments list
    assert.equal(res.body.payments.length, 1);
    assert.equal(res.body.payments[0].amount, 500);
  });

  it('SECURITY: Worker CANNOT view another worker’s passbook by changing employee_id query param', async () => {
    // Worker 1 attempts to pass ?employee_id=<worker2.id>
    const res = await apiRequest(`/api/worker/passbook?month=2026-09&employee_id=${worker2.id}`, 'GET', null, {
      Authorization: `Bearer ${worker1Token}`
    });
    assert.equal(res.status, 200);
    // MUST still return Worker 1's records, NOT Worker 2's!
    assert.equal(res.body.worker.id, worker1.id);
    assert.equal(res.body.worker.name, 'Sunil Packaging Worker');
  });

  it('ADMIN: Admin CAN view any worker’s passbook by providing employee_id', async () => {
    const res = await apiRequest(`/api/worker/passbook?month=2026-09&employee_id=${worker2.id}`, 'GET', null, {
      Authorization: `Bearer ${adminToken}`
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.worker.id, worker2.id);
    assert.equal(res.body.worker.name, 'Anil Factory Manager');
  });

  it('RBAC ENFORCEMENT: Worker token is strictly denied (403 Forbidden) from administrative endpoints', async () => {
    // 1. Worker cannot mark attendance
    const resAtt = await apiRequest('/api/attendance', 'POST', {
      employee_id: worker1.id,
      date: '2026-09-03',
      status: 'PRESENT'
    }, { Authorization: `Bearer ${worker1Token}` });
    assert.equal(resAtt.status, 403);
    assert.equal(resAtt.body.code, 'FORBIDDEN');

    // 2. Worker cannot create or modify workers
    const resEmp = await apiRequest('/api/employees', 'POST', {
      name: 'Hacker Worker',
      daily_wage: 9999
    }, { Authorization: `Bearer ${worker1Token}` });
    assert.equal(resEmp.status, 403);

    // 3. Worker cannot record payments
    const resPay = await apiRequest('/api/payments', 'POST', {
      employee_id: worker1.id,
      amount: 10000,
      type: 'PAYOUT'
    }, { Authorization: `Bearer ${worker1Token}` });
    assert.equal(resPay.status, 403);

    // 4. Worker cannot access server info
    const resInfo = await apiRequest('/api/server-info', 'GET', null, {
      Authorization: `Bearer ${worker1Token}`
    });
    assert.equal(resInfo.status, 403);

    // 5. Worker cannot modify settings
    const resSet = await apiRequest('/api/settings', 'PUT', {
      daily_wage_default: 9999
    }, { Authorization: `Bearer ${worker1Token}` });
    assert.equal(resSet.status, 403);
  });
});
