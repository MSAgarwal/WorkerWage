const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'attendance.db');
const db = new DatabaseSync(DB_PATH);

// Optimize database for reliability, concurrency, and durability
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA busy_timeout = 5000;');

// Initialize Tables
function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_code TEXT UNIQUE,
      name TEXT NOT NULL,
      phone TEXT,
      role TEXT,
      worker_type TEXT NOT NULL DEFAULT 'WORKER',
      daily_wage REAL NOT NULL DEFAULT 0.0,
      standard_hours REAL DEFAULT 8.0,
      default_ot_multiplier REAL NOT NULL DEFAULT 0.0,
      default_box_rate REAL NOT NULL DEFAULT 30.0,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PRESENT',
      standard_hours REAL DEFAULT 8.0,
      daily_wage_snapshot REAL NOT NULL DEFAULT 0.0,
      base_pay REAL NOT NULL DEFAULT 0.0,
      work_category TEXT DEFAULT '',
      extra_boxes REAL NOT NULL DEFAULT 0.0,
      extra_pieces REAL NOT NULL DEFAULT 0.0,
      box_rate REAL NOT NULL DEFAULT 30.0,
      overtime_hours REAL DEFAULT 0.0,
      overtime_days REAL NOT NULL DEFAULT 0.0,
      overtime_multiplier REAL NOT NULL DEFAULT 0.0,
      overtime_pay REAL NOT NULL DEFAULT 0.0,
      is_holiday_work INTEGER NOT NULL DEFAULT 0,
      bonus_allowance REAL NOT NULL DEFAULT 0.0,
      deduction REAL NOT NULL DEFAULT 0.0,
      total_pay REAL NOT NULL DEFAULT 0.0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
      UNIQUE(employee_id, date)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL DEFAULT 'ADVANCE',
      payment_method TEXT DEFAULT 'CASH',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      is_paid INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
    CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON attendance(employee_id, date);
    CREATE INDEX IF NOT EXISTS idx_payments_emp ON payments(employee_id);
    CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);
    CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);
  `);

  // Create schema_migrations table for idempotent versioned schema tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT UNIQUE NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const migrations = [
    {
      version: '20260901_add_overtime_days',
      up: () => {
        try { db.exec('ALTER TABLE attendance ADD COLUMN overtime_days REAL NOT NULL DEFAULT 0.0;'); } catch (e) {}
      }
    },
    {
      version: '20260902_add_is_holiday_work',
      up: () => {
        try { db.exec('ALTER TABLE attendance ADD COLUMN is_holiday_work INTEGER NOT NULL DEFAULT 0;'); } catch (e) {}
      }
    },
    {
      version: '20260903_add_worker_type',
      up: () => {
        try { db.exec("ALTER TABLE employees ADD COLUMN worker_type TEXT NOT NULL DEFAULT 'WORKER';"); } catch (e) {}
      }
    },
    {
      version: '20260904_add_default_box_rate',
      up: () => {
        try { db.exec('ALTER TABLE employees ADD COLUMN default_box_rate REAL NOT NULL DEFAULT 30.0;'); } catch (e) {}
      }
    },
    {
      version: '20260905_add_work_category',
      up: () => {
        try { db.exec("ALTER TABLE attendance ADD COLUMN work_category TEXT DEFAULT '';"); } catch (e) {}
      }
    },
    {
      version: '20260906_add_extra_boxes',
      up: () => {
        try { db.exec('ALTER TABLE attendance ADD COLUMN extra_boxes REAL NOT NULL DEFAULT 0.0;'); } catch (e) {}
      }
    },
    {
      version: '20260907_add_box_rate',
      up: () => {
        try { db.exec('ALTER TABLE attendance ADD COLUMN box_rate REAL NOT NULL DEFAULT 30.0;'); } catch (e) {}
      }
    },
    {
      version: '20260908_add_extra_pieces',
      up: () => {
        try { db.exec('ALTER TABLE attendance ADD COLUMN extra_pieces REAL NOT NULL DEFAULT 0.0;'); } catch (e) {}
      }
    }
  ];

  const checkMigStmt = db.prepare('SELECT version FROM schema_migrations WHERE version = ?');
  const insertMigStmt = db.prepare('INSERT INTO schema_migrations (version) VALUES (?)');

  for (const m of migrations) {
    if (!checkMigStmt.get(m.version)) {
      m.up();
      insertMigStmt.run(m.version);
    }
  }

  // Initialize Default Settings if not present
  const defaultWorkCategories = [
    'Sp 100',
    'Sp 80',
    'Sp 80 kishanganj',
    'Pd 80',
    'Pd 100',
    'S 50',
    'Pd 40',
    'Pd 50',
    'P 100',
    'p 95',
    'P card',
    'Sp card',
    'pd orange card',
    'pd pink card',
    'pd big card',
    'sp big card',
    'bangles(special)'
  ];

  const defaultSettings = [
    { key: 'business_name', value: 'Daily Wage Attendance & Payroll' },
    { key: 'currency_symbol', value: '₹' },
    { key: 'default_ot_multiplier', value: '0.0' },
    { key: 'default_box_rate', value: '30.0' },
    { key: 'work_categories', value: JSON.stringify(defaultWorkCategories) },
    { key: 'weekly_paid_off_day', value: 'Tuesday' },
    { key: 'site_location', value: 'Main Work Site' }
  ];

  const checkSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const insertSettingStmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');

  for (const s of defaultSettings) {
    if (!checkSettingStmt.get(s.key)) {
      insertSettingStmt.run(s.key, s.value);
    }
  }

  // Handle Admin PIN migration to bcrypt hash
  const existingPinRow = checkSettingStmt.get('admin_pin');
  if (existingPinRow) {
    const val = existingPinRow.value;
    if (!val.startsWith('$2a$') && !val.startsWith('$2b$')) {
      const hashed = bcrypt.hashSync(val, 10);
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(hashed, 'admin_pin');
      console.log('🔒 Migrated existing admin PIN to bcrypt hash.');
    }
  } else {
    const defaultPin = process.env.DEFAULT_ADMIN_PIN || '1234';
    const hashed = bcrypt.hashSync(defaultPin, 10);
    insertSettingStmt.run('admin_pin', hashed);
  }

  // Handle persistent JWT Secret
  const existingSecretRow = checkSettingStmt.get('jwt_secret');
  if (!existingSecretRow) {
    const secret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
    insertSettingStmt.run('jwt_secret', secret);
  }

  // Seed sample holidays if table is empty
  const countHol = db.prepare('SELECT COUNT(*) as count FROM holidays').get();
  if (countHol && countHol.count === 0) {
    const seedHoliday = db.prepare('INSERT OR IGNORE INTO holidays (date, title, is_paid) VALUES (?, ?, ?)');
    seedHoliday.run('2026-10-02', 'Gandhi Jayanti', 1);
    seedHoliday.run('2026-11-08', 'Diwali', 1);
    seedHoliday.run('2026-12-25', 'Christmas', 1);
    seedHoliday.run('2026-01-26', 'Republic Day', 1);
    seedHoliday.run('2026-08-15', 'Independence Day', 1);
  }

  // Seed sample workers if table is empty
  const countEmp = db.prepare('SELECT COUNT(*) as count FROM employees').get();
  if (countEmp && countEmp.count === 0) {
    const seedEmp = db.prepare(`
      INSERT INTO employees (employee_code, name, phone, role, daily_wage, default_ot_multiplier, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    seedEmp.run('EMP001', 'Ramesh Kumar', '9876543210', 'Head Mason', 750.0, 0.0, 'Experienced brick layer');
    seedEmp.run('EMP002', 'Suresh Singh', '9876543211', 'Carpenter', 700.0, 0.0, 'Formwork and finishing');
    seedEmp.run('EMP003', 'Rajesh Sharma', '9876543212', 'Welder / Fabricator', 800.0, 0.0, 'Heavy metal works');
    seedEmp.run('EMP004', 'Amit Patel', '9876543213', 'General Helper', 500.0, 0.0, 'Loading and site support');
    seedEmp.run('EMP005', 'Vikram Yadav', '9876543214', 'Electrician', 750.0, 0.0, 'Wiring and power setup');

    console.log('🌱 Seeded 5 sample daily wage workers for initial setup.');
  }
}

initDatabase();

// Auth and Crypto Helpers
function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('jwt_secret');
  return row ? row.value : 'workerwage_secure_fallback_secret_key';
}

function verifyAdminPin(enteredPin) {
  if (!enteredPin) return false;
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_pin');
  if (!row) return false;
  const storedVal = row.value;

  // Auto-migrate if found as plaintext
  if (!storedVal.startsWith('$2a$') && !storedVal.startsWith('$2b$')) {
    const isMatch = String(enteredPin).trim() === String(storedVal).trim();
    if (isMatch) {
      const hashed = bcrypt.hashSync(String(enteredPin).trim(), 10);
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(hashed, 'admin_pin');
    }
    return isMatch;
  }
  return bcrypt.compareSync(String(enteredPin).trim(), storedVal);
}

function updateAdminPin(newPin) {
  const hashed = bcrypt.hashSync(String(newPin).trim(), 10);
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(hashed, 'admin_pin');
}

// Database Transaction Helper (Atomic execution of multi-statement operations)
function withTransaction(fn) {
  db.exec('BEGIN TRANSACTION;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

// Database Health & Integrity Check
function checkDatabaseIntegrity() {
  try {
    const row = db.prepare('PRAGMA integrity_check;').get();
    return row ? (row.integrity_check === 'ok') : true;
  } catch (e) {
    console.error('Integrity check error:', e);
    return false;
  }
}

module.exports = {
  db,
  DB_PATH,
  withTransaction,
  checkDatabaseIntegrity,
  getJwtSecret,
  verifyAdminPin,
  updateAdminPin
};
