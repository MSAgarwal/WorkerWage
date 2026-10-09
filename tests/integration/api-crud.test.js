const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { db } = require('../../db');

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

describe('CRUD API & Business Workflow Integration Tests', () => {
  let authToken = '';
  let authHeaders = {};
  let testWorkerId = null;

  before(async () => {
    // Authenticate admin with isolated test PIN
    const authRes = await apiRequest('/api/auth/verify', 'POST', { pin: ADMIN_PIN });
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
      name: '  Int Test Worker  ',
      employee_code: 'TEST-INT-001',
      role: 'Test Packer',
      worker_type: 'WORKER',
      daily_wage: 500,
      phone: '9988776655'
    }, authHeaders);

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.employee.name, 'Int Test Worker');
    assert.equal(res.body.employee.role, 'Test Packer');
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

  it('POST /api/employees rejects null or malformed body with 400', async () => {
    const res = await apiRequest('/api/employees', 'POST', null, authHeaders);
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
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

  it('CRITICAL: must NOT allow holiday overtime on a normal working day even if client claims is_holiday_work: true', async () => {
    // 2026-11-04 is a Wednesday (normal working day, not Tuesday, not a holiday)
    const res = await apiRequest('/api/attendance', 'POST', {
      employee_id: testWorkerId,
      date: '2026-11-04',
      status: 'PRESENT',
      work_category: 'Wedding Card',
      is_holiday_work: true // Attacker forged flag
    }, authHeaders);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    // Overtime pay MUST be 0, server refuses client-forged holiday overtime!
    assert.equal(res.body.calculation.overtimePay, 0);
  });

  it('POST /api/attendance/batch rejects entire batch atomically if any employee ID is unknown', async () => {
    const res = await apiRequest('/api/attendance/batch', 'POST', {
      date: '2026-11-05',
      records: [
        { employee_id: testWorkerId, status: 'PRESENT' },
        { employee_id: 999999, status: 'PRESENT' } // Nonexistent worker
      ]
    }, authHeaders);

    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('does not exist'));
  });

  it('POST /api/attendance/batch rejects batch if duplicate employee IDs are present in same batch', async () => {
    const res = await apiRequest('/api/attendance/batch', 'POST', {
      date: '2026-11-05',
      records: [
        { employee_id: testWorkerId, status: 'PRESENT' },
        { employee_id: testWorkerId, status: 'HALF_DAY' }
      ]
    }, authHeaders);

    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('Duplicate worker ID'));
  });

  it('POST /api/attendance/batch updates attendance in an atomic transaction when valid', async () => {
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
    // Day 1: 850 total_pay; Day 2: 395 total_pay; Day 4: 550 total_pay. Gross = 850 + 395 + 550 = 1795
    // Advances: 400. Net Payable: 1795 - 400 = 1395
    assert.equal(workerReport.grossPayTotal, 1795);
    assert.equal(workerReport.totalAdvances, 400);
    assert.equal(workerReport.netPayable, 1395);
  });

  it('FINANCIAL PARITY: GET /api/reports/export-csv matches JSON payroll numbers exactly', async () => {
    // Record a settlement of 500 to test both advances and settlements
    await apiRequest('/api/payments', 'POST', {
      employee_id: testWorkerId,
      date: '2026-11-03',
      amount: 500,
      type: 'SETTLEMENT',
      payment_method: 'UPI',
      notes: 'Mid-month settlement'
    }, authHeaders);

    const jsonRes = await apiRequest(`/api/reports/payroll?startDate=2026-11-01&endDate=2026-11-30&employee_id=${testWorkerId}`, 'GET', null, authHeaders);
    const workerJson = jsonRes.body.workers[0];

    const csvRes = await apiRequest(`/api/reports/export-csv?startDate=2026-11-01&endDate=2026-11-30`, 'GET', null, authHeaders);
    assert.equal(csvRes.status, 200);
    const csvLines = csvRes.body.split('\r\n');
    const workerLine = csvLines.find(l => l.includes('TEST-INT-001'));
    assert.ok(workerLine, 'Worker should appear in CSV');

    // Parse CSV line columns respecting quoted fields with commas
    const parseCsv = (line) => {
      const result = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
          else { inQuotes = !inQuotes; }
        } else if (c === ',' && !inQuotes) {
          result.push(cur);
          cur = '';
        } else {
          cur += c;
        }
      }
      result.push(cur);
      return result;
    };

    const cols = parseCsv(workerLine);
    // Header includes 'Bonus / Rewards' (col 14):
    // Gross is col 15, Advances is col 16, Settlements is col 17, Net is col 18
    const bonusCsv = parseFloat(cols[14]);
    const grossCsv = parseFloat(cols[15]);
    const advancesCsv = parseFloat(cols[16]);
    const settlementsCsv = parseFloat(cols[17]);
    const netCsv = parseFloat(cols[18]);

    assert.equal(bonusCsv, workerJson.bonusTotal, 'CSV bonus must equal JSON bonus');
    assert.equal(grossCsv, workerJson.grossPayTotal, 'CSV gross must equal JSON gross');
    assert.equal(advancesCsv, workerJson.totalAdvances, 'CSV advances must equal JSON advances');
    assert.equal(settlementsCsv, workerJson.totalSettlements, 'CSV settlements must equal JSON settlements');
    assert.equal(netCsv, workerJson.netPayable, 'CSV net payable must equal JSON net payable');
  });

  it('MANAGER role is exempt from work categories, piece bonuses, and box overtime in API and Payroll', async () => {
    // 1. Create a Manager
    const mgrRes = await apiRequest('/api/employees', 'POST', {
      employee_code: 'TEST-MGR-001',
      name: 'Test Manager Alice',
      role: 'Operations Manager',
      worker_type: 'MANAGER',
      daily_wage: 1200,
      phone: '9988776655'
    }, authHeaders);
    assert.equal(mgrRes.status, 201);
    const mgrId = mgrRes.body.employee.id;

    // 2. Mark attendance for Manager with work category and extra boxes provided in request body
    const attRes = await apiRequest('/api/attendance', 'POST', {
      employee_id: mgrId,
      date: '2026-11-10',
      status: 'PRESENT',
      work_category: 'Pd 100',
      extra_boxes: 25,
      notes: 'Supervised factory floor'
    }, authHeaders);
    assert.equal(attRes.status, 200);
    // Work category should be empty, extra boxes 0, box rate 0, overtime pay 0
    assert.equal(attRes.body.record.work_category, '');
    assert.equal(attRes.body.record.extra_boxes, 0);
    assert.equal(attRes.body.record.box_rate, 0);
    assert.equal(attRes.body.record.overtime_pay, 0);
    assert.equal(attRes.body.record.total_pay, 1200);

    // 3. Check Payroll report for Manager
    const payRes = await apiRequest(`/api/reports/payroll?startDate=2026-11-01&endDate=2026-11-30&employee_id=${mgrId}`, 'GET', null, authHeaders);
    assert.equal(payRes.status, 200);
    const mgrReport = payRes.body.workers[0];
    assert.equal(mgrReport.worker_type, 'MANAGER');
    assert.equal(mgrReport.categoriesSummary, '-');
    assert.equal(mgrReport.totalExtraBoxes, 0);
    assert.equal(mgrReport.totalExtraPieces, 0);
    assert.equal(mgrReport.holidayWorkDays, 0);
    assert.equal(mgrReport.grossPayTotal, 1200);

    // Clean up test manager
    await apiRequest(`/api/employees/${mgrId}?hardDelete=true`, 'DELETE', null, authHeaders);
  });

  it('POST /api/payments records a BONUS payment and reflects in payroll calculation', async () => {
    const res = await apiRequest('/api/payments', 'POST', {
      employee_id: testWorkerId,
      date: '2026-11-04',
      amount: 1000,
      type: 'BONUS',
      payment_method: 'CASH',
      notes: 'Festival reward'
    }, authHeaders);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.payment.type, 'BONUS');
    assert.equal(res.body.payment.amount, 1000);

    const payRes = await apiRequest(`/api/reports/payroll?startDate=2026-11-01&endDate=2026-11-30&employee_id=${testWorkerId}`, 'GET', null, authHeaders);
    const workerReport = payRes.body.workers[0];
    assert.equal(workerReport.bonusTotal >= 1000, true);
  });

  it('GET /api/employees/departments, branches, and CSV export succeed', async () => {
    await apiRequest(`/api/employees/${testWorkerId}`, 'PUT', {
      name: 'Int Test Worker',
      department: 'Packaging Dept',
      branch: 'Main Factory'
    }, authHeaders);

    const deptRes = await apiRequest('/api/employees/departments', 'GET', null, authHeaders);
    assert.equal(deptRes.status, 200);
    assert.ok(Array.isArray(deptRes.body.departments));
    assert.ok(deptRes.body.departments.includes('Packaging Dept'));

    const branchRes = await apiRequest('/api/employees/branches', 'GET', null, authHeaders);
    assert.equal(branchRes.status, 200);
    assert.ok(Array.isArray(branchRes.body.branches));
    assert.ok(branchRes.body.branches.includes('Main Factory'));

    const filterRes = await apiRequest('/api/employees?department=Packaging%20Dept', 'GET', null, authHeaders);
    assert.equal(filterRes.status, 200);
    assert.ok(filterRes.body.employees.some(e => e.id === testWorkerId));

    const csvRes = await apiRequest('/api/employees/export-csv', 'GET', null, authHeaders);
    assert.equal(csvRes.status, 200);
    assert.ok(csvRes.headers['content-type'].includes('text/csv'));
    assert.ok(String(csvRes.body).includes('Worker Code,Name,Phone'));
  });

  it('POST /api/employees/bulk-import imports multiple workers atomically', async () => {
    const bulkData = {
      employees: [
        { name: 'Bulk Worker 1', employee_code: 'BULK-001', daily_wage: 650, department: 'Assembly' },
        { name: 'Bulk Worker 2', employee_code: 'BULK-002', daily_wage: 700, department: 'Assembly' }
      ]
    };
    const res = await apiRequest('/api/employees/bulk-import', 'POST', bulkData, authHeaders);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.created, 2);

    db.prepare("DELETE FROM employees WHERE employee_code IN ('BULK-001', 'BULK-002')").run();
  });

  it('DELETE nonexistent records returns 404', async () => {
    const resWorker = await apiRequest('/api/employees/999999', 'DELETE', null, authHeaders);
    assert.equal(resWorker.status, 404);

    const resHoliday = await apiRequest('/api/holidays/999999', 'DELETE', null, authHeaders);
    assert.equal(resHoliday.status, 404);
  });

  it('DELETE /api/employees/:id removes worker and cascades associated records', async () => {
    const res = await apiRequest(`/api/employees/${testWorkerId}?hardDelete=true&force=true`, 'DELETE', null, authHeaders);
    assert.equal(res.status, 200);

    const exists = db.prepare('SELECT id FROM employees WHERE id = ?').get(testWorkerId);
    assert.equal(exists, undefined, 'Worker should be removed from database');
    testWorkerId = null; // Prevent double cleanup in after()
  });
});
