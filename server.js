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

// Helper: Check date metadata (Tuesday Weekly Off & Paid Holidays)
function getDateMeta(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const dayOfWeek = d.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const isTuesday = dayOfWeek === 2;
  const holiday = db.prepare('SELECT * FROM holidays WHERE date = ?').get(dateStr);
  const isPaidHoliday = !!(holiday && holiday.is_paid);
  const isPaidDayOff = isTuesday || isPaidHoliday;

  let dayOffReason = '';
  if (isTuesday) {
    dayOffReason = 'Tuesday Weekly Off (Paid Leave)';
  } else if (isPaidHoliday) {
    dayOffReason = `Paid Holiday: ${holiday.title}`;
  }

  return {
    date: dateStr,
    dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek],
    isTuesday,
    holiday: holiday || null,
    isPaidHoliday,
    isPaidDayOff,
    dayOffReason
  };
}

// Helper: Wage calculation (Day-based wages, extra box overtime for packaging workers, manager exemption)
function calculateWage(
  dailyWage,
  status,
  otDays = 0,
  otMultiplier = 0.0,
  isHolidayWork = false,
  bonus = 0,
  deduction = 0,
  extraBoxes = 0,
  boxRate = 30.0,
  workerType = 'WORKER'
) {
  dailyWage = Number(dailyWage) || 0;
  bonus = Number(bonus) || 0;
  deduction = Number(deduction) || 0;

  let basePay = 0;
  let statusDays = 0;

  if (status === 'PRESENT') {
    statusDays = 1.0;
    basePay = dailyWage;
  } else if (status === 'HALF_DAY') {
    statusDays = 0.5;
    basePay = dailyWage * 0.5;
  } else if (status === 'PAID_LEAVE' || status === 'PAID_HOLIDAY') {
    statusDays = 1.0;
    basePay = dailyWage; // Paid day off gives full daily wage!
  } else {
    // ABSENT
    statusDays = 0.0;
    basePay = 0.0;
  }

  let overtimePay = 0;
  let parsedBoxes = 0;
  let parsedBoxRate = 30.0;
  let parsedOtDays = 0;
  let parsedOtMultiplier = 0.0;

  if (workerType === 'MANAGER') {
    // Manager: Exempt from packaging work categories & box overtime
    parsedOtDays = Number(otDays) || 0;
    if (otMultiplier === undefined || otMultiplier === null || isNaN(Number(otMultiplier))) {
      parsedOtMultiplier = 0.0;
    } else {
      parsedOtMultiplier = Math.max(0, Math.min(3.0, Math.round(Number(otMultiplier) * 100) / 100));
    }
    overtimePay = parsedOtDays * dailyWage * parsedOtMultiplier;
    parsedBoxes = 0;
    parsedBoxRate = 0.0;
  } else {
    // Packaging Worker: Overtime metric is based on count of extra boxes packed (default ₹30/box)
    parsedBoxes = Math.max(0, parseFloat(extraBoxes) || 0);
    parsedBoxRate = (boxRate !== undefined && boxRate !== null && !isNaN(parseFloat(boxRate)))
      ? Math.max(0, parseFloat(boxRate))
      : 30.0;
    overtimePay = parsedBoxes * parsedBoxRate;
    parsedOtDays = 0;
    parsedOtMultiplier = 0.0;
  }

  const totalPay = Math.max(0, basePay + overtimePay + bonus - deduction);

  return {
    dailyWage,
    statusDays,
    workerType: workerType || 'WORKER',
    basePay: Math.round(basePay * 100) / 100,
    extraBoxes: Math.round(parsedBoxes * 100) / 100,
    boxRate: Math.round(parsedBoxRate * 100) / 100,
    overtimeDays: Math.round(parsedOtDays * 100) / 100,
    overtimeMultiplier: parsedOtMultiplier,
    overtimePay: Math.round(overtimePay * 100) / 100,
    isHolidayWork: !!isHolidayWork,
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
  // Parse work_categories JSON array if present
  if (settings.work_categories) {
    try {
      settings.work_categories_list = JSON.parse(settings.work_categories);
    } catch (e) {
      settings.work_categories_list = [];
    }
  }
  res.json({ success: true, settings });
});

app.put('/api/settings', (req, res) => {
  const allowedKeys = ['business_name', 'currency_symbol', 'default_ot_multiplier', 'default_box_rate', 'work_categories', 'site_location'];
  const updateStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');

  for (const key of allowedKeys) {
    if (req.body[key] !== undefined) {
      let val = req.body[key];
      if (key === 'work_categories' && Array.isArray(val)) {
        val = JSON.stringify(val);
      }
      updateStmt.run(key, String(val));
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
  const { name, phone, role, worker_type, daily_wage, default_ot_multiplier, default_box_rate, notes } = req.body;

  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Worker name is required' });
  }

  const wage = parseFloat(daily_wage);
  if (isNaN(wage) || wage < 0) {
    return res.status(400).json({ error: 'Valid daily wage is required' });
  }

  const parsedType = (worker_type === 'MANAGER') ? 'MANAGER' : 'WORKER';
  const boxRate = (!isNaN(parseFloat(default_box_rate)) && parseFloat(default_box_rate) >= 0)
    ? parseFloat(default_box_rate)
    : 30.0;

  // Generate unique employee code if not provided
  let code = req.body.employee_code;
  if (!code || code.trim() === '') {
    const lastRow = db.prepare('SELECT id FROM employees ORDER BY id DESC LIMIT 1').get();
    const nextId = lastRow ? lastRow.id + 1 : 1;
    code = 'EMP' + String(nextId).padStart(3, '0');
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO employees (employee_code, name, phone, role, worker_type, daily_wage, default_ot_multiplier, default_box_rate, notes, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `);

    const result = stmt.run(
      code.trim(),
      name.trim(),
      phone ? phone.trim() : '',
      role ? role.trim() : (parsedType === 'MANAGER' ? 'Manager' : 'Worker'),
      parsedType,
      wage,
      default_ot_multiplier !== undefined && !isNaN(parseFloat(default_ot_multiplier)) ? parseFloat(default_ot_multiplier) : 0.0,
      boxRate,
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
  const { name, phone, role, worker_type, daily_wage, default_ot_multiplier, default_box_rate, notes, status } = req.body;

  const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Worker not found' });
  }

  const parsedType = (worker_type !== undefined)
    ? (worker_type === 'MANAGER' ? 'MANAGER' : 'WORKER')
    : (existing.worker_type || 'WORKER');

  const boxRate = (default_box_rate !== undefined && !isNaN(parseFloat(default_box_rate)) && parseFloat(default_box_rate) >= 0)
    ? parseFloat(default_box_rate)
    : (existing.default_box_rate !== undefined ? existing.default_box_rate : 30.0);

  try {
    const stmt = db.prepare(`
      UPDATE employees
      SET name = ?, phone = ?, role = ?, worker_type = ?, daily_wage = ?, default_ot_multiplier = ?, default_box_rate = ?, notes = ?, status = ?
      WHERE id = ?
    `);

    stmt.run(
      name ? name.trim() : existing.name,
      phone !== undefined ? phone.trim() : existing.phone,
      role !== undefined ? role.trim() : existing.role,
      parsedType,
      daily_wage !== undefined ? parseFloat(daily_wage) : existing.daily_wage,
      default_ot_multiplier !== undefined && !isNaN(parseFloat(default_ot_multiplier)) ? parseFloat(default_ot_multiplier) : existing.default_ot_multiplier,
      boxRate,
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
// API: Holidays & Paid Leaves Management
// -------------------------------------------------------------
app.get('/api/holidays', (req, res) => {
  try {
    const holidays = db.prepare('SELECT * FROM holidays ORDER BY date ASC').all();
    res.json({ success: true, holidays });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/holidays', (req, res) => {
  const { date, title, is_paid } = req.body;
  if (!date || !title) {
    return res.status(400).json({ error: 'Date and Title are required' });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO holidays (date, title, is_paid)
      VALUES (?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET title = excluded.title, is_paid = excluded.is_paid
    `);

    stmt.run(date.trim(), title.trim(), is_paid === false ? 0 : 1);
    const holiday = db.prepare('SELECT * FROM holidays WHERE date = ?').get(date.trim());
    res.json({ success: true, message: 'Holiday saved successfully', holiday });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/holidays/:id', (req, res) => {
  const { id } = req.params;
  try {
    db.prepare('DELETE FROM holidays WHERE id = ?').run(id);
    res.json({ success: true, message: 'Holiday removed successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// API: Daily Attendance (Day-Wise with Tuesday / Holiday Auto-Pay)
// -------------------------------------------------------------
// Get attendance list for a specific date (merged with all active employees)
app.get('/api/attendance', (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const meta = getDateMeta(date);

  try {
    const activeWorkers = db.prepare("SELECT * FROM employees WHERE status = 'ACTIVE' ORDER BY name ASC").all();
    const existingAttendance = db.prepare('SELECT * FROM attendance WHERE date = ?').all(date);

    const attMap = {};
    for (const a of existingAttendance) {
      attMap[a.employee_id] = a;
    }

    const result = activeWorkers.map(w => {
      const rec = attMap[w.id];
      const workerType = w.worker_type || 'WORKER';
      const defaultBoxRate = (w.default_box_rate !== undefined && w.default_box_rate !== null) ? w.default_box_rate : 30.0;

      if (rec) {
        const otDays = rec.overtime_days || 0;
        return {
          id: rec.id,
          employee_id: w.id,
          employee_code: w.employee_code,
          name: w.name,
          role: w.role,
          worker_type: workerType,
          phone: w.phone,
          date: rec.date,
          status: rec.status,
          is_marked: true,
          daily_wage: rec.daily_wage_snapshot,
          base_pay: rec.base_pay,
          work_category: rec.work_category || '',
          extra_boxes: rec.extra_boxes || 0,
          box_rate: (rec.box_rate !== undefined && rec.box_rate !== null) ? rec.box_rate : defaultBoxRate,
          overtime_days: otDays,
          overtime_multiplier: rec.overtime_multiplier,
          overtime_pay: rec.overtime_pay,
          is_holiday_work: rec.is_holiday_work === 1,
          bonus_allowance: rec.bonus_allowance,
          deduction: rec.deduction,
          total_pay: rec.total_pay,
          notes: rec.notes || ''
        };
      } else {
        // Unmarked entry: Check if date is Tuesday (Weekly Off) or Paid Holiday
        const workerDefaultOt = (w.default_ot_multiplier !== undefined && w.default_ot_multiplier !== null) ? w.default_ot_multiplier : 0.0;
        if (meta.isPaidDayOff) {
          // Every Tuesday or Paid Holiday defaults to Paid Leave (full day wage)!
          const defaultCalc = calculateWage(w.daily_wage, 'PAID_LEAVE', 0, workerDefaultOt, false, 0, 0, 0, defaultBoxRate, workerType);
          return {
            id: null,
            employee_id: w.id,
            employee_code: w.employee_code,
            name: w.name,
            role: w.role,
            worker_type: workerType,
            phone: w.phone,
            date: date,
            status: 'PAID_LEAVE',
            is_marked: false,
            daily_wage: w.daily_wage,
            base_pay: defaultCalc.basePay,
            work_category: '',
            extra_boxes: 0,
            box_rate: defaultBoxRate,
            overtime_days: 0,
            overtime_multiplier: workerDefaultOt,
            overtime_pay: 0,
            is_holiday_work: false,
            bonus_allowance: 0,
            deduction: 0,
            total_pay: defaultCalc.totalPay,
            notes: meta.dayOffReason
          };
        } else {
          // Regular day
          return {
            id: null,
            employee_id: w.id,
            employee_code: w.employee_code,
            name: w.name,
            role: w.role,
            worker_type: workerType,
            phone: w.phone,
            date: date,
            status: 'NOT_MARKED',
            is_marked: false,
            daily_wage: w.daily_wage,
            base_pay: 0,
            work_category: '',
            extra_boxes: 0,
            box_rate: defaultBoxRate,
            overtime_days: 0,
            overtime_multiplier: workerDefaultOt,
            overtime_pay: 0,
            is_holiday_work: false,
            bonus_allowance: 0,
            deduction: 0,
            total_pay: 0,
            notes: ''
          };
        }
      }
    });

    // Summary calculations for the date
    let totalPresent = 0;
    let totalHalfDay = 0;
    let totalPaidLeave = 0;
    let totalAbsent = 0;
    let totalUnmarked = 0;
    let totalOtDays = 0;
    let totalExtraBoxes = 0;
    let totalHolidayWorkers = 0;
    let totalWagesToday = 0;

    for (const item of result) {
      if (item.status === 'PRESENT') totalPresent++;
      else if (item.status === 'HALF_DAY') totalHalfDay++;
      else if (item.status === 'PAID_LEAVE' || item.status === 'PAID_HOLIDAY') totalPaidLeave++;
      else if (item.status === 'ABSENT') totalAbsent++;
      else totalUnmarked++;

      if (item.is_holiday_work) totalHolidayWorkers++;
      totalOtDays += (item.overtime_days || 0);
      totalExtraBoxes += (item.extra_boxes || 0);
      totalWagesToday += (item.total_pay || 0);
    }

    res.json({
      success: true,
      date,
      meta,
      workersCount: activeWorkers.length,
      summary: {
        totalPresent,
        totalHalfDay,
        totalPaidLeave,
        totalAbsent,
        totalUnmarked,
        totalOtDays: Math.round(totalOtDays * 100) / 100,
        totalExtraBoxes: Math.round(totalExtraBoxes * 100) / 100,
        totalHolidayWorkers,
        totalWagesToday: Math.round(totalWagesToday * 100) / 100
      },
      records: result
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save or Update Attendance for single employee (Day-Wise & Packaging Box OT)
app.post('/api/attendance', (req, res) => {
  const {
    employee_id,
    date,
    status,
    work_category,
    extra_boxes,
    box_rate,
    overtime_days,
    overtime_multiplier,
    is_holiday_work,
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

  const workerType = worker.worker_type || 'WORKER';
  const isManager = workerType === 'MANAGER';
  const effectiveCategory = isManager ? '' : (work_category ? String(work_category).trim() : '');
  const parsedExtraBoxes = isManager ? 0 : Math.max(0, parseFloat(extra_boxes || 0));
  const effectiveBoxRate = (!isNaN(parseFloat(box_rate)) && parseFloat(box_rate) >= 0)
    ? parseFloat(box_rate)
    : (worker.default_box_rate !== undefined && worker.default_box_rate !== null ? worker.default_box_rate : 30.0);

  const otDays = parseFloat(overtime_days || 0);
  const holidayWork = is_holiday_work ? 1 : 0;
  const otMult = (overtime_multiplier !== undefined && overtime_multiplier !== null && !isNaN(parseFloat(overtime_multiplier)))
    ? parseFloat(overtime_multiplier)
    : (worker.default_ot_multiplier !== undefined && worker.default_ot_multiplier !== null ? worker.default_ot_multiplier : 0.0);

  const calc = calculateWage(
    worker.daily_wage,
    status,
    otDays,
    otMult,
    holidayWork,
    bonus_allowance,
    deduction,
    parsedExtraBoxes,
    effectiveBoxRate,
    workerType
  );

  try {
    const upsertStmt = db.prepare(`
      INSERT INTO attendance (
        employee_id, date, status, daily_wage_snapshot,
        base_pay, work_category, extra_boxes, box_rate,
        overtime_days, overtime_multiplier, overtime_pay,
        is_holiday_work, bonus_allowance, deduction, total_pay, notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(employee_id, date) DO UPDATE SET
        status = excluded.status,
        daily_wage_snapshot = excluded.daily_wage_snapshot,
        base_pay = excluded.base_pay,
        work_category = excluded.work_category,
        extra_boxes = excluded.extra_boxes,
        box_rate = excluded.box_rate,
        overtime_days = excluded.overtime_days,
        overtime_multiplier = excluded.overtime_multiplier,
        overtime_pay = excluded.overtime_pay,
        is_holiday_work = excluded.is_holiday_work,
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
      calc.dailyWage,
      calc.basePay,
      effectiveCategory,
      calc.extraBoxes,
      calc.boxRate,
      calc.overtimeDays,
      calc.overtimeMultiplier,
      calc.overtimePay,
      holidayWork,
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

// Batch Save Attendance (Day-Wise & Packaging Box OT)
app.post('/api/attendance/batch', (req, res) => {
  const { date, records } = req.body;
  if (!date || !Array.isArray(records)) {
    return res.status(400).json({ error: 'date and records array are required' });
  }

  const upsertStmt = db.prepare(`
    INSERT INTO attendance (
      employee_id, date, status, daily_wage_snapshot,
      base_pay, work_category, extra_boxes, box_rate,
      overtime_days, overtime_multiplier, overtime_pay,
      is_holiday_work, bonus_allowance, deduction, total_pay, notes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(employee_id, date) DO UPDATE SET
      status = excluded.status,
      daily_wage_snapshot = excluded.daily_wage_snapshot,
      base_pay = excluded.base_pay,
      work_category = excluded.work_category,
      extra_boxes = excluded.extra_boxes,
      box_rate = excluded.box_rate,
      overtime_days = excluded.overtime_days,
      overtime_multiplier = excluded.overtime_multiplier,
      overtime_pay = excluded.overtime_pay,
      is_holiday_work = excluded.is_holiday_work,
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

      const workerType = worker.worker_type || 'WORKER';
      const isManager = workerType === 'MANAGER';
      const effectiveCategory = isManager ? '' : (r.work_category ? String(r.work_category).trim() : '');
      const parsedExtraBoxes = isManager ? 0 : Math.max(0, parseFloat(r.extra_boxes || 0));
      const effectiveBoxRate = (!isNaN(parseFloat(r.box_rate)) && parseFloat(r.box_rate) >= 0)
        ? parseFloat(r.box_rate)
        : (worker.default_box_rate !== undefined && worker.default_box_rate !== null ? worker.default_box_rate : 30.0);

      const otDays = parseFloat(r.overtime_days || 0);
      const holidayWork = r.is_holiday_work ? 1 : 0;
      const otMult = (r.overtime_multiplier !== undefined && r.overtime_multiplier !== null && !isNaN(parseFloat(r.overtime_multiplier)))
        ? parseFloat(r.overtime_multiplier)
        : (worker.default_ot_multiplier !== undefined && worker.default_ot_multiplier !== null ? worker.default_ot_multiplier : 0.0);

      const calc = calculateWage(
        worker.daily_wage,
        r.status || 'PRESENT',
        otDays,
        otMult,
        holidayWork,
        r.bonus_allowance || 0,
        r.deduction || 0,
        parsedExtraBoxes,
        effectiveBoxRate,
        workerType
      );

      upsertStmt.run(
        r.employee_id,
        date,
        r.status || 'PRESENT',
        calc.dailyWage,
        calc.basePay,
        effectiveCategory,
        calc.extraBoxes,
        calc.boxRate,
        calc.overtimeDays,
        calc.overtimeMultiplier,
        calc.overtimePay,
        holidayWork,
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
    let grandOtDays = 0;
    let grandOtPay = 0;
    let grandTotalExtraBoxes = 0;
    let grandGrossPay = 0;
    let grandAdvances = 0;
    let grandNetPayable = 0;

    for (const w of workers) {
      const attRecords = attendanceStmt.all(w.id, start, end);
      const payRecords = paymentsStmt.all(w.id, start, end);
      const workerType = w.worker_type || 'WORKER';

      let presentDays = 0;
      let halfDays = 0;
      let paidLeaveDays = 0;
      let absentDays = 0;
      let totalOtDays = 0;
      let totalExtraBoxes = 0;
      let holidayWorkDays = 0;
      const otMultiplierMap = {};
      const categoriesMap = {};
      let basePayTotal = 0;
      let otPayTotal = 0;
      let bonusTotal = 0;
      let deductionTotal = 0;
      let grossPayTotal = 0;

      for (const a of attRecords) {
        if (a.status === 'PRESENT') presentDays++;
        else if (a.status === 'HALF_DAY') halfDays++;
        else if (a.status === 'PAID_LEAVE' || a.status === 'PAID_HOLIDAY') paidLeaveDays++;
        else if (a.status === 'ABSENT') absentDays++;

        if (a.is_holiday_work) holidayWorkDays++;

        if (a.extra_boxes > 0) {
          totalExtraBoxes += a.extra_boxes;
        }

        if (a.work_category && a.work_category.trim()) {
          const cat = a.work_category.trim();
          categoriesMap[cat] = (categoriesMap[cat] || 0) + 1;
        }

        const otDays = a.overtime_days || 0;
        if (otDays > 0) {
          totalOtDays += otDays;
          const multKey = Number(a.overtime_multiplier !== undefined && a.overtime_multiplier !== null ? a.overtime_multiplier : 0.0).toFixed(2);
          otMultiplierMap[multKey] = (otMultiplierMap[multKey] || 0) + otDays;
        }

        basePayTotal += a.base_pay;
        otPayTotal += a.overtime_pay;
        bonusTotal += a.bonus_allowance;
        deductionTotal += a.deduction;
        grossPayTotal += a.total_pay;
      }

      // Format OT summary string, e.g. "1.5x (2.0d), 2x (1.0d)"
      const otSummaryParts = Object.keys(otMultiplierMap).sort((a,b) => parseFloat(a) - parseFloat(b)).map(m => {
        const cleanM = parseFloat(m).toString();
        return `${cleanM}x (${otMultiplierMap[m].toFixed(2)}d)`;
      });
      const otSummaryText = otSummaryParts.join(', ');

      // Format Work Categories summary string, e.g. "Sp 100 (5d), Pd 80 (3d)"
      const categoriesSummary = Object.keys(categoriesMap).sort().map(c => `${c} (${categoriesMap[c]}d)`).join(', ');

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
      grandOtDays += totalOtDays;
      grandTotalExtraBoxes += totalExtraBoxes;
      grandOtPay += otPayTotal;
      grandGrossPay += grossPayTotal;
      grandAdvances += totalAdvances;
      grandNetPayable += netPayable;

      report.push({
        employee_id: w.id,
        employee_code: w.employee_code,
        name: w.name,
        role: w.role,
        worker_type: workerType,
        phone: w.phone,
        daily_wage: w.daily_wage,
        presentDays,
        halfDays,
        paidLeaveDays,
        absentDays,
        holidayWorkDays,
        effectiveDays: Math.round((presentDays + (halfDays * 0.5) + paidLeaveDays) * 100) / 100,
        totalOtDays: Math.round(totalOtDays * 100) / 100,
        totalExtraBoxes: Math.round(totalExtraBoxes * 100) / 100,
        categoriesMap,
        categoriesSummary,
        otMultiplierMap,
        otSummaryText,
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
        grandOtDays: Math.round(grandOtDays * 100) / 100,
        grandTotalExtraBoxes: Math.round(grandTotalExtraBoxes * 100) / 100,
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

// CSV Export (Day-Wise & Packaging Metrics)
app.get('/api/reports/export-csv', (req, res) => {
  const { startDate, endDate } = req.query;
  const now = new Date();
  const start = startDate || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const end = endDate || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

  try {
    const workers = db.prepare("SELECT * FROM employees WHERE status = 'ACTIVE' ORDER BY name ASC").all();
    const rows = [];

    rows.push(['Code', 'Name', 'Worker Type', 'Role', 'Daily Wage', 'Present (Days)', 'Half Days', 'Paid Leave/Tuesdays', 'Effective Paid Days', 'Work Categories', 'Extra Boxes Packed', 'Base Wage', 'OT Wage', 'Gross Earnings', 'Advances Paid', 'Net Balance Payable'].join(','));

    for (const w of workers) {
      const attRecords = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date >= ? AND date <= ?').all(w.id, start, end);
      const payRecords = db.prepare('SELECT * FROM payments WHERE employee_id = ? AND date >= ? AND date <= ?').all(w.id, start, end);
      const workerType = w.worker_type || 'WORKER';

      let present = 0, half = 0, paidLeave = 0, absent = 0, totalOt = 0, totalBoxes = 0, basePay = 0, otPay = 0, gross = 0;
      const catMap = {};

      for (const a of attRecords) {
        if (a.status === 'PRESENT') present++;
        else if (a.status === 'HALF_DAY') half++;
        else if (a.status === 'PAID_LEAVE' || a.status === 'PAID_HOLIDAY') paidLeave++;
        else if (a.status === 'ABSENT') absent++;

        if (a.extra_boxes > 0) totalBoxes += a.extra_boxes;
        if (a.work_category && a.work_category.trim()) {
          const cat = a.work_category.trim();
          catMap[cat] = (catMap[cat] || 0) + 1;
        }

        const otDays = a.overtime_days || 0;
        if (otDays > 0) totalOt += otDays;

        basePay += a.base_pay;
        otPay += a.overtime_pay;
        gross += a.total_pay;
      }

      const catDesc = Object.keys(catMap).map(c => `${c} (${catMap[c]}d)`).join('; ');

      let advances = 0;
      for (const p of payRecords) {
        if (p.type === 'ADVANCE') advances += p.amount;
      }

      const effectivePaidDays = present + (half * 0.5) + paidLeave;
      const net = Math.max(0, gross - advances);

      rows.push([
        `"${w.employee_code}"`,
        `"${w.name}"`,
        `"${workerType === 'MANAGER' ? 'Manager' : 'Packaging Worker'}"`,
        `"${w.role || ''}"`,
        w.daily_wage,
        present,
        half,
        paidLeave,
        effectivePaidDays.toFixed(1),
        `"${catDesc || '-'}"`,
        totalBoxes,
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
