const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');
const { db, DB_PATH } = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper: Get Primary Local Network IP Address
function getLocalNetworkIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Find non-internal IPv4 address
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

// Helper: Calculate wage breakdown
function calculateWage(dailyWage, standardHours, status, otHours, otMultiplier, bonus = 0, deduction = 0) {
  dailyWage = Number(dailyWage) || 0;
  standardHours = Number(standardHours) || 8.0;
  if (standardHours <= 0) standardHours = 8.0;
  otHours = Number(otHours) || 0;
  otMultiplier = Number(otMultiplier) || 1.5;
  bonus = Number(bonus) || 0;
  deduction = Number(deduction) || 0;

  let basePay = 0;
  if (status === 'PRESENT') {
    basePay = dailyWage;
  } else if (status === 'HALF_DAY') {
    basePay = dailyWage * 0.5;
  } else if (status === 'PAID_LEAVE') {
    basePay = dailyWage;
  } else {
    // ABSENT
    basePay = 0;
  }

  const hourlyRate = dailyWage / standardHours;
  const overtimePay = otHours * hourlyRate * otMultiplier;
  const totalPay = Math.max(0, basePay + overtimePay + bonus - deduction);

  return {
    dailyWage,
    standardHours,
    hourlyRate: Math.round(hourlyRate * 100) / 100,
    basePay: Math.round(basePay * 100) / 100,
    overtimeHours: otHours,
    overtimeMultiplier: otMultiplier,
    overtimePay: Math.round(overtimePay * 100) / 100,
    bonusAllowance: bonus,
    deduction: deduction,
    totalPay: Math.round(totalPay * 100) / 100
  };
}

// -------------------------------------------------------------
// API: Server Info & Mobile Connection QR Code
// -------------------------------------------------------------
app.get('/api/server-info', async (req, res) => {
  try {
    const ip = getLocalNetworkIp();
    const networkUrl = `http://${ip}:${PORT}`;
    const localUrl = `http://localhost:${PORT}`;
    const qrCodeDataUrl = await QRCode.toDataURL(networkUrl, {
      width: 280,
      margin: 2,
      color: {
        dark: '#1e293b',
        light: '#ffffff'
      }
    });

    res.json({
      success: true,
      ip,
      port: PORT,
      networkUrl,
      localUrl,
      qrCodeDataUrl,
      hostname: os.hostname(),
      platform: os.platform()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// API: Admin Authentication (PIN based for Employer)
// -------------------------------------------------------------
app.post('/api/auth/verify', (req, res) => {
  const { pin } = req.body;
  if (!pin) {
    return res.status(400).json({ error: 'PIN is required' });
  }

  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_pin');
  const storedPin = row ? row.value : '1234';

  if (String(pin).trim() === String(storedPin).trim()) {
    return res.json({ success: true, message: 'Admin verified successfully' });
  } else {
    return res.status(401).json({ error: 'Incorrect Admin PIN. Please try again.' });
  }
});

app.post('/api/auth/change-pin', (req, res) => {
  const { currentPin, newPin } = req.body;
  if (!currentPin || !newPin) {
    return res.status(400).json({ error: 'Both current PIN and new PIN are required' });
  }

  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_pin');
  const storedPin = row ? row.value : '1234';

  if (String(currentPin).trim() !== String(storedPin).trim()) {
    return res.status(401).json({ error: 'Current PIN does not match' });
  }

  if (String(newPin).trim().length < 4) {
    return res.status(400).json({ error: 'New PIN must be at least 4 digits' });
  }

  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(String(newPin).trim(), 'admin_pin');
  res.json({ success: true, message: 'Admin PIN updated successfully' });
});

// -------------------------------------------------------------
// API: Settings
// -------------------------------------------------------------
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings WHERE key != ?').all('admin_pin');
  const settings = {};
  for (const r of rows) {
    settings[r.key] = r.value;
  }
  res.json({ success: true, settings });
});

app.put('/api/settings', (req, res) => {
  const allowedKeys = ['business_name', 'currency_symbol', 'default_standard_hours', 'default_ot_multiplier', 'site_location'];
  const updateStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');

  for (const key of allowedKeys) {
    if (req.body[key] !== undefined) {
      updateStmt.run(key, String(req.body[key]));
    }
  }

  res.json({ success: true, message: 'Settings saved successfully' });
});

// -------------------------------------------------------------
// API: Employees
// -------------------------------------------------------------
app.get('/api/employees', (req, res) => {
  const { status } = req.query;
  let query = 'SELECT * FROM employees';
  const params = [];

  if (status && status !== 'ALL') {
    query += ' WHERE status = ?';
    params.push(status);
  }

  query += ' ORDER BY status ASC, name ASC';
  const employees = db.prepare(query).all(...params);
  res.json({ success: true, employees });
});

app.post('/api/employees', (req, res) => {
  const { name, phone, role, daily_wage, standard_hours, default_ot_multiplier, notes } = req.body;

  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Worker name is required' });
  }

  const wage = parseFloat(daily_wage);
  if (isNaN(wage) || wage < 0) {
    return res.status(400).json({ error: 'Valid daily wage is required' });
  }

  // Generate unique employee code if not provided
  let code = req.body.employee_code;
  if (!code || code.trim() === '') {
    const lastRow = db.prepare('SELECT id FROM employees ORDER BY id DESC LIMIT 1').get();
    const nextId = lastRow ? lastRow.id + 1 : 1;
    code = 'EMP' + String(nextId).padStart(3, '0');
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO employees (employee_code, name, phone, role, daily_wage, standard_hours, default_ot_multiplier, notes, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `);

    const result = stmt.run(
      code.trim(),
      name.trim(),
      phone ? phone.trim() : '',
      role ? role.trim() : 'Worker',
      wage,
      parseFloat(standard_hours) || 8.0,
      parseFloat(default_ot_multiplier) || 1.5,
      notes ? notes.trim() : ''
    );

    const newWorker = db.prepare('SELECT * FROM employees WHERE id = ?').get(result.lastInsertRowid);
    res.json({ success: true, message: 'Worker added successfully', employee: newWorker });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/employees/:id', (req, res) => {
  const { id } = req.params;
  const { name, phone, role, daily_wage, standard_hours, default_ot_multiplier, notes, status } = req.body;

  const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Worker not found' });
  }

  try {
    const stmt = db.prepare(`
      UPDATE employees
      SET name = ?, phone = ?, role = ?, daily_wage = ?, standard_hours = ?, default_ot_multiplier = ?, notes = ?, status = ?
      WHERE id = ?
    `);

    stmt.run(
      name ? name.trim() : existing.name,
      phone !== undefined ? phone.trim() : existing.phone,
      role !== undefined ? role.trim() : existing.role,
      daily_wage !== undefined ? parseFloat(daily_wage) : existing.daily_wage,
      standard_hours !== undefined ? parseFloat(standard_hours) : existing.standard_hours,
      default_ot_multiplier !== undefined ? parseFloat(default_ot_multiplier) : existing.default_ot_multiplier,
      notes !== undefined ? notes.trim() : existing.notes,
      status !== undefined ? status : existing.status,
      id
    );

    const updated = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
    res.json({ success: true, message: 'Worker details updated', employee: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/employees/:id', (req, res) => {
  const { id } = req.params;
  const { hardDelete } = req.query;

  try {
    if (hardDelete === 'true') {
      db.prepare('DELETE FROM employees WHERE id = ?').run(id);
      return res.json({ success: true, message: 'Worker deleted permanently' });
    } else {
      // Soft deactivate
      db.prepare("UPDATE employees SET status = 'INACTIVE' WHERE id = ?").run(id);
      return res.json({ success: true, message: 'Worker deactivated successfully' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// API: Daily Attendance
// -------------------------------------------------------------
// Get attendance list for a specific date (merged with all active employees)
app.get('/api/attendance', (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];

  try {
    const activeWorkers = db.prepare("SELECT * FROM employees WHERE status = 'ACTIVE' ORDER BY name ASC").all();
    const existingAttendance = db.prepare('SELECT * FROM attendance WHERE date = ?').all(date);

    const attMap = {};
    for (const a of existingAttendance) {
      attMap[a.employee_id] = a;
    }

    const result = activeWorkers.map(w => {
      const rec = attMap[w.id];
      if (rec) {
        return {
          id: rec.id,
          employee_id: w.id,
          employee_code: w.employee_code,
          name: w.name,
          role: w.role,
          phone: w.phone,
          date: rec.date,
          status: rec.status,
          is_marked: true,
          standard_hours: rec.standard_hours,
          daily_wage: rec.daily_wage_snapshot,
          base_pay: rec.base_pay,
          overtime_hours: rec.overtime_hours,
          overtime_multiplier: rec.overtime_multiplier,
          overtime_pay: rec.overtime_pay,
          bonus_allowance: rec.bonus_allowance,
          deduction: rec.deduction,
          total_pay: rec.total_pay,
          notes: rec.notes || ''
        };
      } else {
        // Unmarked default entry
        const defaultCalc = calculateWage(w.daily_wage, w.standard_hours, 'NOT_MARKED', 0, w.default_ot_multiplier);
        return {
          id: null,
          employee_id: w.id,
          employee_code: w.employee_code,
          name: w.name,
          role: w.role,
          phone: w.phone,
          date: date,
          status: 'NOT_MARKED',
          is_marked: false,
          standard_hours: w.standard_hours,
          daily_wage: w.daily_wage,
          base_pay: 0,
          overtime_hours: 0,
          overtime_multiplier: w.default_ot_multiplier || 1.5,
          overtime_pay: 0,
          bonus_allowance: 0,
          deduction: 0,
          total_pay: 0,
          notes: ''
        };
      }
    });

    // Summary calculations for the date
    let totalPresent = 0;
    let totalHalfDay = 0;
    let totalAbsent = 0;
    let totalUnmarked = 0;
    let totalOtHours = 0;
    let totalWagesToday = 0;

    for (const item of result) {
      if (item.status === 'PRESENT') totalPresent++;
      else if (item.status === 'HALF_DAY') totalHalfDay++;
      else if (item.status === 'ABSENT') totalAbsent++;
      else totalUnmarked++;

      totalOtHours += (item.overtime_hours || 0);
      totalWagesToday += (item.total_pay || 0);
    }

    res.json({
      success: true,
      date,
      workersCount: activeWorkers.length,
      summary: {
        totalPresent,
        totalHalfDay,
        totalAbsent,
        totalUnmarked,
        totalOtHours: Math.round(totalOtHours * 10) / 10,
        totalWagesToday: Math.round(totalWagesToday * 100) / 100
      },
      records: result
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save or Update Attendance for single employee
app.post('/api/attendance', (req, res) => {
  const {
    employee_id,
    date,
    status,
    overtime_hours,
    overtime_multiplier,
    bonus_allowance,
    deduction,
    notes
  } = req.body;

  if (!employee_id || !date || !status) {
    return res.status(400).json({ error: 'employee_id, date, and status are required' });
  }

  const worker = db.prepare('SELECT * FROM employees WHERE id = ?').get(employee_id);
  if (!worker) {
    return res.status(404).json({ error: 'Worker not found' });
  }

  const calc = calculateWage(
    worker.daily_wage,
    worker.standard_hours,
    status,
    overtime_hours,
    overtime_multiplier || worker.default_ot_multiplier,
    bonus_allowance,
    deduction
  );

  try {
    const upsertStmt = db.prepare(`
      INSERT INTO attendance (
        employee_id, date, status, standard_hours, daily_wage_snapshot,
        base_pay, overtime_hours, overtime_multiplier, overtime_pay,
        bonus_allowance, deduction, total_pay, notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(employee_id, date) DO UPDATE SET
        status = excluded.status,
        standard_hours = excluded.standard_hours,
        daily_wage_snapshot = excluded.daily_wage_snapshot,
        base_pay = excluded.base_pay,
        overtime_hours = excluded.overtime_hours,
        overtime_multiplier = excluded.overtime_multiplier,
        overtime_pay = excluded.overtime_pay,
        bonus_allowance = excluded.bonus_allowance,
        deduction = excluded.deduction,
        total_pay = excluded.total_pay,
        notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP
    `);

    upsertStmt.run(
      employee_id,
      date,
      status,
      calc.standardHours,
      calc.dailyWage,
      calc.basePay,
      calc.overtimeHours,
      calc.overtimeMultiplier,
      calc.overtimePay,
      calc.bonusAllowance,
      calc.deduction,
      calc.totalPay,
      notes || ''
    );

    const saved = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(employee_id, date);
    res.json({ success: true, message: 'Attendance recorded', record: saved, calculation: calc });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Batch Save Attendance (e.g., Mark All Present, or Bulk update for a date)
app.post('/api/attendance/batch', (req, res) => {
  const { date, records } = req.body;
  if (!date || !Array.isArray(records)) {
    return res.status(400).json({ error: 'date and records array are required' });
  }

  const upsertStmt = db.prepare(`
    INSERT INTO attendance (
      employee_id, date, status, standard_hours, daily_wage_snapshot,
      base_pay, overtime_hours, overtime_multiplier, overtime_pay,
      bonus_allowance, deduction, total_pay, notes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(employee_id, date) DO UPDATE SET
      status = excluded.status,
      standard_hours = excluded.standard_hours,
      daily_wage_snapshot = excluded.daily_wage_snapshot,
      base_pay = excluded.base_pay,
      overtime_hours = excluded.overtime_hours,
      overtime_multiplier = excluded.overtime_multiplier,
      overtime_pay = excluded.overtime_pay,
      bonus_allowance = excluded.bonus_allowance,
      deduction = excluded.deduction,
      total_pay = excluded.total_pay,
      notes = excluded.notes,
      updated_at = CURRENT_TIMESTAMP
  `);

  try {
    let count = 0;
    for (const r of records) {
      const worker = db.prepare('SELECT * FROM employees WHERE id = ?').get(r.employee_id);
      if (!worker) continue;

      const calc = calculateWage(
        worker.daily_wage,
        worker.standard_hours,
        r.status || 'PRESENT',
        r.overtime_hours || 0,
        r.overtime_multiplier || worker.default_ot_multiplier || 1.5,
        r.bonus_allowance || 0,
        r.deduction || 0
      );

      upsertStmt.run(
        r.employee_id,
        date,
        r.status || 'PRESENT',
        calc.standardHours,
        calc.dailyWage,
        calc.basePay,
        calc.overtimeHours,
        calc.overtimeMultiplier,
        calc.overtimePay,
        calc.bonusAllowance,
        calc.deduction,
        calc.totalPay,
        r.notes || ''
      );
      count++;
    }

    res.json({ success: true, message: `Successfully updated attendance for ${count} workers` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// API: Advances & Payouts (Payments)
// -------------------------------------------------------------
app.get('/api/payments', (req, res) => {
  const { employee_id, startDate, endDate } = req.query;
  let query = `
    SELECT p.*, e.name as employee_name, e.employee_code, e.role
    FROM payments p
    JOIN employees e ON p.employee_id = e.id
    WHERE 1=1
  `;
  const params = [];

  if (employee_id) {
    query += ' AND p.employee_id = ?';
    params.push(employee_id);
  }
  if (startDate) {
    query += ' AND p.date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND p.date <= ?';
    params.push(endDate);
  }

  query += ' ORDER BY p.date DESC, p.id DESC';
  const payments = db.prepare(query).all(...params);
  res.json({ success: true, payments });
});

app.post('/api/payments', (req, res) => {
  const { employee_id, date, amount, type, payment_method, notes } = req.body;
  if (!employee_id || !date || !amount) {
    return res.status(400).json({ error: 'employee_id, date, and amount are required' });
  }

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ error: 'Amount must be greater than 0' });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO payments (employee_id, date, amount, type, payment_method, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      employee_id,
      date,
      numAmount,
      type || 'ADVANCE',
      payment_method || 'CASH',
      notes || ''
    );

    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(result.lastInsertRowid);
    res.json({ success: true, message: 'Payment recorded successfully', payment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/payments/:id', (req, res) => {
  const { id } = req.params;
  try {
    db.prepare('DELETE FROM payments WHERE id = ?').run(id);
    res.json({ success: true, message: 'Payment entry removed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// API: Payroll Reports & Wage Calculations
// -------------------------------------------------------------
app.get('/api/reports/payroll', (req, res) => {
  const { startDate, endDate, employee_id } = req.query;

  // Default to current month if no dates provided
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

  const start = startDate || defaultStart;
  const end = endDate || defaultEnd;

  try {
    let empQuery = 'SELECT * FROM employees';
    const empParams = [];
    if (employee_id) {
      empQuery += ' WHERE id = ?';
      empParams.push(employee_id);
    } else {
      empQuery += ' WHERE status = ? ORDER BY name ASC';
      empParams.push('ACTIVE');
    }

    const workers = db.prepare(empQuery).all(...empParams);

    const attendanceStmt = db.prepare(`
      SELECT * FROM attendance
      WHERE employee_id = ? AND date >= ? AND date <= ?
      ORDER BY date ASC
    `);

    const paymentsStmt = db.prepare(`
      SELECT * FROM payments
      WHERE employee_id = ? AND date >= ? AND date <= ?
      ORDER BY date ASC
    `);

    const report = [];
    let grandBasePay = 0;
    let grandOtHours = 0;
    let grandOtPay = 0;
    let grandGrossPay = 0;
    let grandAdvances = 0;
    let grandNetPayable = 0;

    for (const w of workers) {
      const attRecords = attendanceStmt.all(w.id, start, end);
      const payRecords = paymentsStmt.all(w.id, start, end);

      let presentDays = 0;
      let halfDays = 0;
      let absentDays = 0;
      let ot15Hours = 0;
      let ot20Hours = 0;
      let totalOtHours = 0;
      let basePayTotal = 0;
      let otPayTotal = 0;
      let bonusTotal = 0;
      let deductionTotal = 0;
      let grossPayTotal = 0;

      for (const a of attRecords) {
        if (a.status === 'PRESENT') presentDays++;
        else if (a.status === 'HALF_DAY') halfDays++;
        else if (a.status === 'ABSENT') absentDays++;

        if (a.overtime_hours > 0) {
          totalOtHours += a.overtime_hours;
          if (a.overtime_multiplier === 2.0) {
            ot20Hours += a.overtime_hours;
          } else {
            ot15Hours += a.overtime_hours;
          }
        }

        basePayTotal += a.base_pay;
        otPayTotal += a.overtime_pay;
        bonusTotal += a.bonus_allowance;
        deductionTotal += a.deduction;
        grossPayTotal += a.total_pay;
      }

      let totalAdvances = 0;
      let totalSettlements = 0;
      for (const p of payRecords) {
        if (p.type === 'ADVANCE') {
          totalAdvances += p.amount;
        } else if (p.type === 'PAYOUT' || p.type === 'SETTLEMENT') {
          totalSettlements += p.amount;
        }
      }

      const netPayable = Math.max(0, grossPayTotal - totalAdvances - totalSettlements);

      grandBasePay += basePayTotal;
      grandOtHours += totalOtHours;
      grandOtPay += otPayTotal;
      grandGrossPay += grossPayTotal;
      grandAdvances += totalAdvances;
      grandNetPayable += netPayable;

      report.push({
        employee_id: w.id,
        employee_code: w.employee_code,
        name: w.name,
        role: w.role,
        phone: w.phone,
        daily_wage: w.daily_wage,
        standard_hours: w.standard_hours,
        hourly_rate: Math.round((w.daily_wage / w.standard_hours) * 100) / 100,
        presentDays,
        halfDays,
        absentDays,
        effectiveDays: presentDays + (halfDays * 0.5),
        ot15Hours: Math.round(ot15Hours * 10) / 10,
        ot20Hours: Math.round(ot20Hours * 10) / 10,
        totalOtHours: Math.round(totalOtHours * 10) / 10,
        basePayTotal: Math.round(basePayTotal * 100) / 100,
        otPayTotal: Math.round(otPayTotal * 100) / 100,
        bonusTotal: Math.round(bonusTotal * 100) / 100,
        deductionTotal: Math.round(deductionTotal * 100) / 100,
        grossPayTotal: Math.round(grossPayTotal * 100) / 100,
        totalAdvances: Math.round(totalAdvances * 100) / 100,
        totalSettlements: Math.round(totalSettlements * 100) / 100,
        netPayable: Math.round(netPayable * 100) / 100,
        attendanceRecords: attRecords,
        paymentRecords: payRecords
      });
    }

    res.json({
      success: true,
      startDate: start,
      endDate: end,
      grandTotals: {
        totalWorkers: workers.length,
        grandBasePay: Math.round(grandBasePay * 100) / 100,
        grandOtHours: Math.round(grandOtHours * 10) / 10,
        grandOtPay: Math.round(grandOtPay * 100) / 100,
        grandGrossPay: Math.round(grandGrossPay * 100) / 100,
        grandAdvances: Math.round(grandAdvances * 100) / 100,
        grandNetPayable: Math.round(grandNetPayable * 100) / 100
      },
      workers: report
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CSV Export
app.get('/api/reports/export-csv', (req, res) => {
  const { startDate, endDate } = req.query;
  const now = new Date();
  const start = startDate || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const end = endDate || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

  try {
    const workers = db.prepare("SELECT * FROM employees WHERE status = 'ACTIVE' ORDER BY name ASC").all();
    const rows = [];

    rows.push(['Code', 'Name', 'Role', 'Daily Wage', 'Present Days', 'Half Days', 'Absent Days', 'Effective Days', '1.5x OT (hrs)', '2.0x OT (hrs)', 'Total OT (hrs)', 'Base Wage', 'OT Wage', 'Gross Earnings', 'Advances Paid', 'Net Balance Payable'].join(','));

    for (const w of workers) {
      const attRecords = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date >= ? AND date <= ?').all(w.id, start, end);
      const payRecords = db.prepare('SELECT * FROM payments WHERE employee_id = ? AND date >= ? AND date <= ?').all(w.id, start, end);

      let present = 0, half = 0, absent = 0, ot15 = 0, ot20 = 0, basePay = 0, otPay = 0, gross = 0;
      for (const a of attRecords) {
        if (a.status === 'PRESENT') present++;
        else if (a.status === 'HALF_DAY') half++;
        else if (a.status === 'ABSENT') absent++;

        if (a.overtime_hours > 0) {
          if (a.overtime_multiplier === 2.0) ot20 += a.overtime_hours;
          else ot15 += a.overtime_hours;
        }

        basePay += a.base_pay;
        otPay += a.overtime_pay;
        gross += a.total_pay;
      }

      let advances = 0;
      for (const p of payRecords) {
        if (p.type === 'ADVANCE') advances += p.amount;
      }

      const net = Math.max(0, gross - advances);

      rows.push([
        `"${w.employee_code}"`,
        `"${w.name}"`,
        `"${w.role || ''}"`,
        w.daily_wage,
        present,
        half,
        absent,
        present + (half * 0.5),
        ot15,
        ot20,
        ot15 + ot20,
        basePay.toFixed(2),
        otPay.toFixed(2),
        gross.toFixed(2),
        advances.toFixed(2),
        net.toFixed(2)
      ].join(','));
    }

    const csvContent = rows.join('\r\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="attendance_payroll_${start}_to_${end}.csv"`);
    res.send(csvContent);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Database Backup Download
app.get('/api/backup', (req, res) => {
  res.download(DB_PATH, `attendance_backup_${new Date().toISOString().split('T')[0]}.db`);
});

// Fallback to SPA (Express 5 compatible)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', async () => {
  const ip = getLocalNetworkIp();
  const localUrl = `http://localhost:${PORT}`;
  const networkUrl = `http://${ip}:${PORT}`;

  console.log('\n============================================================');
  console.log('   🚀 EMPLOYEE ATTENDANCE & PAYROLL SERVER RUNNING');
  console.log('============================================================');
  console.log(`💻 LAPTOP ACCESS : ${localUrl}`);
  console.log(`📱 MOBILE ACCESS : ${networkUrl}`);
  console.log('------------------------------------------------------------');
  console.log('👉 To access from mobile:');
  console.log(`   1. Ensure phone and laptop are on same Wi-Fi / Hotspot`);
  console.log(`   2. Open browser on phone and type: ${networkUrl}`);
  console.log(`   3. OR scan the QR code below with your phone camera:`);
  console.log('------------------------------------------------------------\n');

  try {
    const qrString = await QRCode.toString(networkUrl, { type: 'terminal', small: true });
    console.log(qrString);
  } catch (e) {
    console.log('(QR code generation preview omitted in console)');
  }

  console.log('Default Admin PIN: 1234');
  console.log('============================================================\n');
});
