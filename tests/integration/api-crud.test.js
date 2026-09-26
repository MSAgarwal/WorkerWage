const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { db } = require('../../db');

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

describe('CRUD API & Business Workflow Integration Tests', () => {
  let authToken = '';
  let authHeaders = {};
  let testWorkerId = null;

  before(async () => {
    // Authenticate admin
    const authRes = await apiRequest('/api/auth/verify', 'POST', { pin: '1234' });
    authToken = authRes.body.token;
    authHeaders = { 'Authorization': `Bearer ${authToken}` };
  });

  after(() => {
    // Clean up test worker and related rows if still present
    if (testWorkerId) {
      db.prepare('DELETE FROM employees WHERE id = ?').run(testWorkerId);
    }
    db.prepare("DELETE FROM employees WHERE employee_code = 'TEST-INT-001'").run();
  });

  it('POST /api/employees creates employee with sanitized fields', async () => {
    const res = await apiRequest('/api/employees', 'POST', {
      name: '  <b>Int Test Worker</b>  ',
      employee_code: 'TEST-INT-001',
      role: 'Test Packer <script>',
      worker_type: 'WORKER',
      daily_wage: 500,
      phone: '9988776655'
    }, authHeaders);

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.employee.name, '&lt;b&gt;Int Test Worker&lt;/b&gt;');
    assert.equal(res.body.employee.role, 'Test Packer &lt;script&gt;');
    testWorkerId = res.body.employee.id;
  });

  it('POST /api/employees rejects duplicate employee_code with 409', async () => {
    const res = await apiRequest('/api/employees', 'POST', {
      name: 'Duplicate Worker',
      employee_code: 'TEST-INT-001',
      daily_wage: 500
    }, authHeaders);

    assert.equal(res.status, 409);
    assert.ok(res.body.error.includes('already exists'));
  });

  it('PUT /api/employees/:id updates employee details', async () => {
    const res = await apiRequest(`/api/employees/${testWorkerId}`, 'PUT', {
      daily_wage: 550,
      notes: 'Promoted to senior'
    }, authHeaders);

    assert.equal(res.status, 200);
    assert.equal(res.body.employee.daily_wage, 550);
    assert.equal(res.body.employee.notes, 'Promoted to senior');
  });

  it('POST /api/attendance records day attendance and calculates packaging box overtime', async () => {
    const res = await apiRequest('/api/attendance', 'POST', {
      employee_id: testWorkerId,
      date: '2026-11-01',
      status: 'PRESENT',
      work_category: 'Standard Box',
      extra_boxes: 10,
      box_rate: 30
    }, authHeaders);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    // Base 550 + 10 boxes * ₹30 = 850
    assert.equal(res.body.calculation.basePay, 550);
    assert.equal(res.body.calculation.overtimePay, 300);
    assert.equal(res.body.calculation.totalPay, 850);
  });

  it('POST /api/attendance/batch updates attendance in an atomic transaction', async () => {
    const res = await apiRequest('/api/attendance/batch', 'POST', {
      date: '2026-11-02',
      records: [
        {
          employee_id: testWorkerId,
          status: 'HALF_DAY',
          extra_boxes: 4,
          box_rate: 30
        }
      ]
    }, authHeaders);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);

    const saved = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(testWorkerId, '2026-11-02');
    assert.ok(saved);
    assert.equal(saved.status, 'HALF_DAY');
    // Base: 550 * 0.5 = 275, OT: 4 * 30 = 120, Total: 395
    assert.equal(saved.base_pay, 275);
    assert.equal(saved.overtime_pay, 120);
    assert.equal(saved.total_pay, 395);
  });

  it('POST /api/payments records an advance payout', async () => {
    const res = await apiRequest('/api/payments', 'POST', {
      employee_id: testWorkerId,
      date: '2026-11-02',
      amount: 400,
      type: 'ADVANCE',
      payment_method: 'CASH',
      notes: 'Weekly advance'
    }, authHeaders);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.payment.amount, 400);
  });

  it('GET /api/reports/payroll computes payroll and deducts advances correctly', async () => {
    const res = await apiRequest(`/api/reports/payroll?startDate=2026-11-01&endDate=2026-11-30&employee_id=${testWorkerId}`, 'GET', null, authHeaders);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.workers.length, 1);

    const workerReport = res.body.workers[0];
    // Day 1: 850 total_pay; Day 2: 395 total_pay. Gross = 850 + 395 = 1245
    // Advances: 400. Net Payable: 1245 - 400 = 845
    assert.equal(workerReport.grossPayTotal, 1245);
    assert.equal(workerReport.totalAdvances, 400);
    assert.equal(workerReport.netPayable, 845);
  });

  it('DELETE /api/employees/:id removes worker and cascades associated records', async () => {
    const res = await apiRequest(`/api/employees/${testWorkerId}?hardDelete=true`, 'DELETE', null, authHeaders);
    assert.equal(res.status, 200);

    const exists = db.prepare('SELECT id FROM employees WHERE id = ?').get(testWorkerId);
    assert.equal(exists, undefined, 'Worker should be removed from database');
    testWorkerId = null; // Prevent double cleanup in after()
  });
});
