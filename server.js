const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');
const { db, DB_PATH, getJwtSecret, verifyAdminPin, updateAdminPin, withTransaction, checkDatabaseIntegrity } = require('./db');
const { isPieceCategory, calculateWage } = require('./wageCalculator');
const {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  errorHandler
} = require('./errors');
const {
  isValidDate,
  sanitizeString,
  validateEmployeeInput,
  validateAttendanceInput,
  validateBatchAttendanceInput,
  validatePaymentInput,
  validateHolidayInput,
  validateChangePinInput
} = require('./validators');

const app = express();
const PORT = process.env.PORT || 5000;

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'"
  );
  next();
});

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Structured Request Logger
app.use((req, res, next) => {
  if (req.url.startsWith('/css') || req.url.startsWith('/js') || req.url.startsWith('/img') || req.url === '/favicon.ico') {
    return next();
  }
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '-';
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl || req.url} ${res.statusCode} (${duration}ms) - IP: ${ip}`);
  });
  next();
});

// Rate Limiter for PIN authentication (brute-force protection)
const authAttempts = new Map(); // ip -> { count, firstAttempt, lockedUntil }
const AUTH_MAX_ATTEMPTS = 5;
const AUTH_WINDOW_MS = 60 * 1000; // 1 minute window
const AUTH_LOCK_MS = 2 * 60 * 1000; // 2 minutes lockout

function checkAuthRateLimit(req, res, next) {
  const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  const record = authAttempts.get(clientIp);

  if (record) {
    if (record.lockedUntil && now < record.lockedUntil) {
      const remainingSec = Math.ceil((record.lockedUntil - now) / 1000);
      return res.status(429).json({
        error: `Too many failed PIN attempts. Please wait ${remainingSec} seconds before trying again.`,
        retryAfter: remainingSec
      });
    }
    if (now - record.firstAttempt > AUTH_WINDOW_MS) {
      authAttempts.set(clientIp, { count: 0, firstAttempt: now, lockedUntil: 0 });
    }
  } else {
    authAttempts.set(clientIp, { count: 0, firstAttempt: now, lockedUntil: 0 });
  }

  next();
}

function recordAuthFailure(clientIp) {
  const now = Date.now();
  const record = authAttempts.get(clientIp) || { count: 0, firstAttempt: now, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= AUTH_MAX_ATTEMPTS) {
    record.lockedUntil = now + AUTH_LOCK_MS;
  }
  authAttempts.set(clientIp, record);
}

function recordAuthSuccess(clientIp) {
  authAttempts.delete(clientIp);
}

// Authentication Middleware: Require Admin
function requireAdmin(req, res, next) {
  let token = null;

  // 1. Authorization header: Bearer <token>
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  // 2. HttpOnly Cookie
  if (!token && req.cookies && req.cookies.admin_token) {
    token = req.cookies.admin_token;
  }

  // 3. Query string token (for file download endpoints e.g. /api/backup)
  if (!token && req.method === 'GET' && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({
      error: 'Admin authentication required. Please unlock with PIN.',
      code: 'UNAUTHORIZED'
    });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      error: 'Invalid or expired session. Please unlock again.',
      code: 'SESSION_EXPIRED'
    });
  }
}

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

// Note: isPieceCategory and calculateWage are imported from ./wageCalculator


// -------------------------------------------------------------
// API: Server Info & Mobile Connection QR Code (Public)
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
// API: Admin Authentication (PIN based with rate-limiting & JWT)
// -------------------------------------------------------------
app.post('/api/auth/verify', checkAuthRateLimit, (req, res) => {
  const { pin } = req.body;
  const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

  if (!pin) {
    return res.status(400).json({ error: 'PIN is required' });
  }

  const isValid = verifyAdminPin(pin);
  if (!isValid) {
    recordAuthFailure(clientIp);
    return res.status(401).json({ error: 'Incorrect Admin PIN. Please try again.' });
  }

  recordAuthSuccess(clientIp);

  // Generate 7-day signed JWT token
  const token = jwt.sign(
    { role: 'admin' },
    getJwtSecret(),
    { expiresIn: '7d' }
  );

  // Set HTTP-only cookie for browser navigation & downloads
  res.cookie('admin_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });

  res.json({
    success: true,
    token,
    message: 'Admin verified successfully'
  });
});

app.get('/api/auth/check', (req, res) => {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }
  if (!token && req.cookies && req.cookies.admin_token) {
    token = req.cookies.admin_token;
  }

  if (!token) {
    return res.json({ authenticated: false });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    return res.json({ authenticated: true, user: decoded });
  } catch (err) {
    return res.json({ authenticated: false });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ success: true, message: 'Logged out successfully' });
});

app.post('/api/auth/change-pin', requireAdmin, (req, res) => {
  const validation = validateChangePinInput(req.body);
  if (!validation.isValid) {
    return res.status(400).json({ error: 'Validation failed', details: validation.errors });
  }

  const { currentPin, newPin } = validation.sanitized;

  if (!verifyAdminPin(currentPin)) {
    return res.status(401).json({ error: 'Current PIN does not match' });
  }

  updateAdminPin(newPin);
  res.json({ success: true, message: 'Admin PIN updated successfully' });
});

// -------------------------------------------------------------
// API: Settings (Protected)
// -------------------------------------------------------------
app.get('/api/settings', requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key NOT IN ('admin_pin', 'jwt_secret')").all();
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

app.put('/api/settings', requireAdmin, (req, res) => {
  const allowedKeys = ['business_name', 'currency_symbol', 'default_ot_multiplier', 'default_box_rate', 'work_categories', 'site_location'];
  const updateStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');

  for (const key of allowedKeys) {
    if (req.body[key] !== undefined) {
      let val = req.body[key];
      if (key === 'work_categories') {
        if (Array.isArray(val)) {
          val = JSON.stringify(val.map(c => sanitizeString(c, 50)).filter(c => c.length > 0));
        } else if (typeof val === 'string') {
          try {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed)) {
              val = JSON.stringify(parsed.map(c => sanitizeString(c, 50)).filter(c => c.length > 0));
            }
          } catch (e) {}
        }
      } else if (key === 'business_name' || key === 'site_location') {
        val = sanitizeString(val, 100);
      } else if (key === 'currency_symbol') {
        val = sanitizeString(val, 5);
      } else if (key === 'default_ot_multiplier') {
        const num = parseFloat(val);
        val = (!isNaN(num) && num >= 0 && num <= 5.0) ? num.toFixed(2) : '0.00';
      } else if (key === 'default_box_rate') {
        const num = parseFloat(val);
        val = (!isNaN(num) && num >= 0) ? num.toFixed(2) : '30.00';
      }
      updateStmt.run(key, String(val));
    }
  }

  res.json({ success: true, message: 'Settings saved successfully' });
});

// -------------------------------------------------------------
// API: Employees (Protected)
// -------------------------------------------------------------
app.get('/api/employees', requireAdmin, (req, res) => {
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

app.post('/api/employees', requireAdmin, (req, res) => {
  const validation = validateEmployeeInput(req.body, false);
  if (!validation.isValid) {
    return res.status(400).json({ error: 'Validation failed', details: validation.errors });
  }

  const { name, phone, role, worker_type, daily_wage, default_ot_multiplier, default_box_rate, notes, employee_code } = validation.sanitized;

  // Generate unique employee code if not provided
  let code = employee_code;
  if (!code || code.trim() === '') {
    const lastRow = db.prepare('SELECT id FROM employees ORDER BY id DESC LIMIT 1').get();
    const nextId = lastRow ? lastRow.id + 1 : 1;
    code = 'EMP' + String(nextId).padStart(3, '0');
  }

  try {
    // Check if employee_code is already taken
    const existingCode = db.prepare('SELECT id FROM employees WHERE employee_code = ?').get(code);
    if (existingCode) {
      return res.status(409).json({ error: `Worker code "${code}" already exists. Please choose a different code.` });
    }

    const stmt = db.prepare(`
      INSERT INTO employees (employee_code, name, phone, role, worker_type, daily_wage, default_ot_multiplier, default_box_rate, notes, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `);

    const result = stmt.run(
      code,
      name,
      phone,
      role,
      worker_type,
      daily_wage,
      default_ot_multiplier,
      default_box_rate,
      notes
    );

    const newWorker = db.prepare('SELECT * FROM employees WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, message: 'Worker added successfully', employee: newWorker });
  } catch (error) {
    if (error.message && error.message.includes('UNIQUE constraint failed: employees.employee_code')) {
      return res.status(409).json({ error: `Worker code "${code}" already exists. Please choose a different code.` });
    }
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/employees/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid worker ID' });
  }

  const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Worker not found' });
  }

  const validation = validateEmployeeInput(req.body, true);
  if (!validation.isValid) {
    return res.status(400).json({ error: 'Validation failed', details: validation.errors });
  }

  const { name, phone, role, worker_type, daily_wage, default_ot_multiplier, default_box_rate, notes, status } = validation.sanitized;

  try {
    const stmt = db.prepare(`
      UPDATE employees
      SET name = ?, phone = ?, role = ?, worker_type = ?, daily_wage = ?, default_ot_multiplier = ?, default_box_rate = ?, notes = ?, status = ?
      WHERE id = ?
    `);

    stmt.run(
      name !== undefined ? name : existing.name,
      phone !== undefined ? phone : existing.phone,
      role !== undefined ? role : existing.role,
      worker_type !== undefined ? worker_type : existing.worker_type,
      daily_wage !== undefined ? daily_wage : existing.daily_wage,
      default_ot_multiplier !== undefined ? default_ot_multiplier : existing.default_ot_multiplier,
      default_box_rate !== undefined ? default_box_rate : existing.default_box_rate,
      notes !== undefined ? notes : existing.notes,
      status !== undefined ? status : existing.status,
      id
    );

    const updated = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
    res.json({ success: true, message: 'Worker details updated', employee: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/employees/:id', requireAdmin, (req, res) => {
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
// API: Holidays & Paid Leaves Management (Protected)
// -------------------------------------------------------------
app.get('/api/holidays', requireAdmin, (req, res) => {
  try {
    const holidays = db.prepare('SELECT * FROM holidays ORDER BY date ASC').all();
    res.json({ success: true, holidays });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/holidays', requireAdmin, (req, res) => {
  const validation = validateHolidayInput(req.body);
  if (!validation.isValid) {
    return res.status(400).json({ error: 'Validation failed', details: validation.errors });
  }

  const { date, title, is_paid } = validation.sanitized;

  try {
    const stmt = db.prepare(`
      INSERT INTO holidays (date, title, is_paid)
      VALUES (?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET title = excluded.title, is_paid = excluded.is_paid
    `);

    stmt.run(date, title, is_paid);
    const holiday = db.prepare('SELECT * FROM holidays WHERE date = ?').get(date);
    res.json({ success: true, message: 'Holiday saved successfully', holiday });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/holidays/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid holiday ID' });
  }
  try {
    db.prepare('DELETE FROM holidays WHERE id = ?').run(id);
    res.json({ success: true, message: 'Holiday removed successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// API: Daily Attendance (Day-Wise with Tuesday / Holiday Auto-Pay) (Protected)
// -------------------------------------------------------------
// Get attendance list for a specific date (merged with all active employees)
app.get('/api/attendance', requireAdmin, (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  if (!isValidDate(date)) {
    return res.status(400).json({ error: 'Invalid date parameter. Date must be in YYYY-MM-DD format.' });
  }
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
        const isPiece = isPieceCategory(rec.work_category);
        const pieces = (rec.extra_pieces !== undefined && rec.extra_pieces !== null)
          ? rec.extra_pieces
          : (isPiece ? (rec.extra_boxes || 0) * 500 : 0);

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
          extra_pieces: pieces,
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
            extra_pieces: 0,
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
            extra_pieces: 0,
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
    let totalExtraPieces = 0;
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
      if (isPieceCategory(item.work_category)) {
        totalExtraPieces += (item.extra_pieces || 0);
      } else {
        totalExtraBoxes += (item.extra_boxes || 0);
      }
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
        totalExtraPieces: Math.round(totalExtraPieces * 100) / 100,
        totalHolidayWorkers,
        totalWagesToday: Math.round(totalWagesToday * 100) / 100
      },
      records: result
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save or Update Attendance for single employee (Day-Wise & Packaging Box/Piece OT)
app.post('/api/attendance', requireAdmin, (req, res) => {
  const validation = validateAttendanceInput(req.body);
  if (!validation.isValid) {
    return res.status(400).json({ error: 'Validation failed', details: validation.errors });
  }

  const {
    employee_id,
    date,
    status,
    work_category,
    extra_boxes,
    extra_pieces,
    box_rate,
    overtime_days,
    overtime_multiplier,
    is_holiday_work,
    bonus_allowance,
    deduction,
    notes
  } = validation.sanitized;

  const worker = db.prepare('SELECT * FROM employees WHERE id = ?').get(employee_id);
  if (!worker) {
    return res.status(404).json({ error: 'Worker not found' });
  }

  const dateMeta = getDateMeta(date);
  const isPaidDayOff = dateMeta.isPaidDayOff;
  const holidayWork = (is_holiday_work === true || (isPaidDayOff && (status === 'PRESENT' || status === 'HALF_DAY'))) ? 1 : 0;

  const workerType = worker.worker_type || 'WORKER';
  const isManager = workerType === 'MANAGER';
  const effectiveCategory = isManager ? '' : (work_category ? String(work_category).trim() : '');
  const isPiece = isPieceCategory(effectiveCategory);

  let parsedExtraPieces = 0;
  let parsedExtraBoxes = 0;

  if (isManager || isPiece) {
    parsedExtraPieces = 0;
    parsedExtraBoxes = 0;
  } else {
    parsedExtraBoxes = Math.max(0, parseFloat(extra_boxes || 0));
    parsedExtraPieces = 0;
  }

  const effectiveBoxRate = (!isNaN(parseFloat(box_rate)) && parseFloat(box_rate) >= 0)
    ? parseFloat(box_rate)
    : (worker.default_box_rate !== undefined && worker.default_box_rate !== null ? worker.default_box_rate : 30.0);

  const otDays = parseFloat(overtime_days || 0);
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
    workerType,
    effectiveCategory,
    parsedExtraPieces,
    isPaidDayOff
  );

  try {
    const upsertStmt = db.prepare(`
      INSERT INTO attendance (
        employee_id, date, status, daily_wage_snapshot,
        base_pay, work_category, extra_boxes, extra_pieces, box_rate,
        overtime_days, overtime_multiplier, overtime_pay,
        is_holiday_work, bonus_allowance, deduction, total_pay, notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(employee_id, date) DO UPDATE SET
        status = excluded.status,
        daily_wage_snapshot = excluded.daily_wage_snapshot,
        base_pay = excluded.base_pay,
        work_category = excluded.work_category,
        extra_boxes = excluded.extra_boxes,
        extra_pieces = excluded.extra_pieces,
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
      calc.extraPieces,
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

// Batch Save Attendance (Day-Wise & Packaging Box/Piece OT) - Wrapped in Database Transaction
app.post('/api/attendance/batch', requireAdmin, (req, res) => {
  const validation = validateBatchAttendanceInput(req.body);
  if (!validation.isValid) {
    return res.status(400).json({ error: 'Validation failed', details: validation.errors });
  }

  const { date, records } = validation.sanitized;

  const upsertStmt = db.prepare(`
    INSERT INTO attendance (
      employee_id, date, status, daily_wage_snapshot,
      base_pay, work_category, extra_boxes, extra_pieces, box_rate,
      overtime_days, overtime_multiplier, overtime_pay,
      is_holiday_work, bonus_allowance, deduction, total_pay, notes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(employee_id, date) DO UPDATE SET
      status = excluded.status,
      daily_wage_snapshot = excluded.daily_wage_snapshot,
      base_pay = excluded.base_pay,
      work_category = excluded.work_category,
      extra_boxes = excluded.extra_boxes,
      extra_pieces = excluded.extra_pieces,
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

  const dateMeta = getDateMeta(date);
  const isPaidDayOff = dateMeta.isPaidDayOff;

  try {
    let count = 0;
    // Execute all updates inside an atomic SQLite transaction
    withTransaction(() => {
      for (const r of records) {
        const worker = db.prepare('SELECT * FROM employees WHERE id = ?').get(r.employee_id);
        if (!worker) continue;

        const holidayWork = (r.is_holiday_work === true || (isPaidDayOff && (r.status === 'PRESENT' || r.status === 'HALF_DAY'))) ? 1 : 0;
        const workerType = worker.worker_type || 'WORKER';
        const isManager = workerType === 'MANAGER';
        const effectiveCategory = isManager ? '' : (r.work_category ? String(r.work_category).trim() : '');
        const isPiece = isPieceCategory(effectiveCategory);

        let parsedExtraPieces = 0;
        let parsedExtraBoxes = 0;

        if (isManager || isPiece) {
          parsedExtraPieces = 0;
          parsedExtraBoxes = 0;
        } else {
          parsedExtraBoxes = Math.max(0, parseFloat(r.extra_boxes || 0));
          parsedExtraPieces = 0;
        }

        const effectiveBoxRate = (!isNaN(parseFloat(r.box_rate)) && parseFloat(r.box_rate) >= 0)
          ? parseFloat(r.box_rate)
          : (worker.default_box_rate !== undefined && worker.default_box_rate !== null ? worker.default_box_rate : 30.0);

        const otDays = parseFloat(r.overtime_days || 0);
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
          workerType,
          effectiveCategory,
          parsedExtraPieces,
          isPaidDayOff
        );

        upsertStmt.run(
          r.employee_id,
          date,
          r.status || 'PRESENT',
          calc.dailyWage,
          calc.basePay,
          effectiveCategory,
          calc.extraBoxes,
          calc.extraPieces,
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
    });

    res.json({ success: true, message: `Successfully updated attendance for ${count} workers` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// API: Advances & Payouts (Payments) (Protected)
// -------------------------------------------------------------
app.get('/api/payments', requireAdmin, (req, res) => {
  const { employee_id, startDate, endDate } = req.query;

  if (startDate && !isValidDate(startDate)) {
    return res.status(400).json({ error: 'Invalid startDate parameter. Date must be in YYYY-MM-DD format.' });
  }
  if (endDate && !isValidDate(endDate)) {
    return res.status(400).json({ error: 'Invalid endDate parameter. Date must be in YYYY-MM-DD format.' });
  }

  let query = `
    SELECT p.*, e.name as employee_name, e.employee_code, e.role
    FROM payments p
    JOIN employees e ON p.employee_id = e.id
    WHERE 1=1
  `;
  const params = [];

  if (employee_id) {
    const empId = parseInt(employee_id, 10);
    if (isNaN(empId) || empId <= 0) {
      return res.status(400).json({ error: 'Invalid employee_id parameter' });
    }
    query += ' AND p.employee_id = ?';
    params.push(empId);
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

app.post('/api/payments', requireAdmin, (req, res) => {
  const validation = validatePaymentInput(req.body);
  if (!validation.isValid) {
    return res.status(400).json({ error: 'Validation failed', details: validation.errors });
  }

  const { employee_id, date, amount, type, payment_method, notes } = validation.sanitized;

  // Check worker exists
  const worker = db.prepare('SELECT id FROM employees WHERE id = ?').get(employee_id);
  if (!worker) {
    return res.status(404).json({ error: 'Worker not found' });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO payments (employee_id, date, amount, type, payment_method, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      employee_id,
      date,
      amount,
      type,
      payment_method,
      notes
    );

    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(result.lastInsertRowid);
    res.json({ success: true, message: 'Payment recorded successfully', payment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/payments/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid payment ID' });
  }
  try {
    const existing = db.prepare('SELECT id FROM payments WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    db.prepare('DELETE FROM payments WHERE id = ?').run(id);
    res.json({ success: true, message: 'Payment entry removed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// API: Payroll Reports & Wage Calculations (Protected)
// -------------------------------------------------------------
app.get('/api/reports/payroll', requireAdmin, (req, res) => {
  const { startDate, endDate, employee_id } = req.query;

  if (startDate && !isValidDate(startDate)) {
    return res.status(400).json({ error: 'Invalid startDate parameter. Date must be in YYYY-MM-DD format.' });
  }
  if (endDate && !isValidDate(endDate)) {
    return res.status(400).json({ error: 'Invalid endDate parameter. Date must be in YYYY-MM-DD format.' });
  }

  let empId = null;
  if (employee_id) {
    empId = parseInt(employee_id, 10);
    if (isNaN(empId) || empId <= 0) {
      return res.status(400).json({ error: 'Invalid employee_id parameter' });
    }
  }

  // Default to current month if no dates provided
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

  const start = startDate || defaultStart;
  const end = endDate || defaultEnd;

  try {
    let empQuery = 'SELECT * FROM employees';
    const empParams = [];
    if (empId) {
      empQuery += ' WHERE id = ?';
      empParams.push(empId);
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
    let grandTotalExtraPieces = 0;
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
      let totalExtraPieces = 0;
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

        if (isPieceCategory(a.work_category)) {
          const pieces = (a.extra_pieces !== undefined && a.extra_pieces !== null && a.extra_pieces > 0)
            ? a.extra_pieces
            : ((a.extra_boxes || 0) * 500);
          totalExtraPieces += pieces;
        } else {
          if (a.extra_boxes > 0) {
            totalExtraBoxes += a.extra_boxes;
          }
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
      grandTotalExtraPieces += totalExtraPieces;
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
        totalExtraPieces: Math.round(totalExtraPieces * 100) / 100,
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
        grandTotalExtraPieces: Math.round(grandTotalExtraPieces * 100) / 100,
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

// CSV Export (Day-Wise & Packaging Metrics) (Protected)
app.get('/api/reports/export-csv', requireAdmin, (req, res) => {
  const { startDate, endDate } = req.query;

  if (startDate && !isValidDate(startDate)) {
    return res.status(400).json({ error: 'Invalid startDate parameter. Date must be in YYYY-MM-DD format.' });
  }
  if (endDate && !isValidDate(endDate)) {
    return res.status(400).json({ error: 'Invalid endDate parameter. Date must be in YYYY-MM-DD format.' });
  }

  const now = new Date();
  const start = startDate || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const end = endDate || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

  try {
    const workers = db.prepare("SELECT * FROM employees WHERE status = 'ACTIVE' ORDER BY name ASC").all();
    const rows = [];

    rows.push(['Code', 'Name', 'Worker Type', 'Role', 'Daily Wage', 'Present (Days)', 'Half Days', 'Paid Leave/Tuesdays', 'Effective Paid Days', 'Work Categories', 'Extra Boxes Packed', 'Extra Pieces (Cards/Bangles)', 'Base Wage', 'OT Wage', 'Gross Earnings', 'Advances Paid', 'Net Balance Payable'].join(','));

    for (const w of workers) {
      const attRecords = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date >= ? AND date <= ?').all(w.id, start, end);
      const payRecords = db.prepare('SELECT * FROM payments WHERE employee_id = ? AND date >= ? AND date <= ?').all(w.id, start, end);
      const workerType = w.worker_type || 'WORKER';

      let present = 0, half = 0, paidLeave = 0, absent = 0, totalOt = 0, totalBoxes = 0, totalPieces = 0, basePay = 0, otPay = 0, gross = 0;
      const catMap = {};

      for (const a of attRecords) {
        if (a.status === 'PRESENT') present++;
        else if (a.status === 'HALF_DAY') half++;
        else if (a.status === 'PAID_LEAVE' || a.status === 'PAID_HOLIDAY') paidLeave++;
        else if (a.status === 'ABSENT') absent++;

        if (isPieceCategory(a.work_category)) {
          const pieces = (a.extra_pieces !== undefined && a.extra_pieces !== null && a.extra_pieces > 0)
            ? a.extra_pieces
            : ((a.extra_boxes || 0) * 500);
          totalPieces += pieces;
        } else {
          if (a.extra_boxes > 0) totalBoxes += a.extra_boxes;
        }

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
        totalPieces,
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

// System Diagnostics & Health Check Endpoint (Public)
app.get('/api/health', (req, res) => {
  const isHealthy = checkDatabaseIntegrity();
  let journalMode = 'unknown';
  try {
    const row = db.prepare('PRAGMA journal_mode;').get();
    journalMode = row ? row.journal_mode : 'unknown';
  } catch (e) {}

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    database: {
      integrity: isHealthy ? 'OK' : 'CORRUPTED',
      journalMode: journalMode
    },
    version: '2.0.0'
  });
});

// Database Backup Download (Protected)
app.get('/api/backup', requireAdmin, (req, res) => {
  res.download(DB_PATH, `attendance_backup_${new Date().toISOString().split('T')[0]}.db`);
});

// Unknown API routes return JSON 404
app.use('/api', (req, res, next) => {
  next(new NotFoundError(`API endpoint ${req.method} ${req.originalUrl || req.url} not found`));
});

// Centralized Express Error Handling Middleware
app.use(errorHandler);

// Fallback to SPA for client-side routing
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
const server = app.listen(PORT, '0.0.0.0', async () => {
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

  console.log('🔒 Security: Admin PIN hashed & server-side JWT auth active');
  console.log('============================================================\n');
});

// Graceful Shutdown
function gracefulShutdown(signal) {
  console.log(`\n[${new Date().toISOString()}] Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    console.log('HTTP server closed.');
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      db.close();
      console.log('Database connection cleanly closed.');
    } catch (e) {
      console.error('Error closing database:', e);
    }
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forced shutdown due to timeout.');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

