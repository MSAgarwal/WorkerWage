const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('./config/env');
const { DEFAULT_CATEGORIES } = require('./config/constants');

const DB_PATH = config.DB_PATH;
const db = new DatabaseSync(DB_PATH);

// Optimize database for reliability, concurrency, and durability
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA cache_size = -64000;'); // 64MB memory page cache
db.exec('PRAGMA temp_store = MEMORY;');  // Fast in-memory temporary tables & sorting
db.exec('PRAGMA mmap_size = 268435456;'); // 256MB direct memory mapping
db.exec('PRAGMA wal_autocheckpoint = 1000;');

/**
 * Check if a specific column exists in a SQLite table
 */
function hasColumn(tableName, columnName) {
  try {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return columns.some(c => c.name === columnName);
  } catch (e) {
    return false;
  }
}

let inTransaction = false;

/**
 * Database Transaction Helper (Atomic execution of multi-statement operations, supports nested reentrancy)
 */
function withTransaction(fn) {
  if (inTransaction) {
    return fn();
  }
  inTransaction = true;
  db.exec('BEGIN TRANSACTION;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch (rbErr) {
      // rollback error if already rolled back
    }
    throw err;
  } finally {
    inTransaction = false;
  }
}

// Initialize Tables & Versioned Schema
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
      pin_hash TEXT,
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
        if (!hasColumn('attendance', 'overtime_days')) {
          db.exec('ALTER TABLE attendance ADD COLUMN overtime_days REAL NOT NULL DEFAULT 0.0;');
        }
      }
    },
    {
      version: '20260902_add_is_holiday_work',
      up: () => {
        if (!hasColumn('attendance', 'is_holiday_work')) {
          db.exec('ALTER TABLE attendance ADD COLUMN is_holiday_work INTEGER NOT NULL DEFAULT 0;');
        }
      }
    },
    {
      version: '20260903_add_worker_type',
      up: () => {
        if (!hasColumn('employees', 'worker_type')) {
          db.exec("ALTER TABLE employees ADD COLUMN worker_type TEXT NOT NULL DEFAULT 'WORKER';");
        }
      }
    },
    {
      version: '20260904_add_default_box_rate',
      up: () => {
        if (!hasColumn('employees', 'default_box_rate')) {
          db.exec('ALTER TABLE employees ADD COLUMN default_box_rate REAL NOT NULL DEFAULT 30.0;');
        }
      }
    },
    {
      version: '20260905_add_work_category',
      up: () => {
        if (!hasColumn('attendance', 'work_category')) {
          db.exec("ALTER TABLE attendance ADD COLUMN work_category TEXT DEFAULT '';");
        }
      }
    },
    {
      version: '20260906_add_extra_boxes',
      up: () => {
        if (!hasColumn('attendance', 'extra_boxes')) {
          db.exec('ALTER TABLE attendance ADD COLUMN extra_boxes REAL NOT NULL DEFAULT 0.0;');
        }
      }
    },
    {
      version: '20260907_add_box_rate',
      up: () => {
        if (!hasColumn('attendance', 'box_rate')) {
          db.exec('ALTER TABLE attendance ADD COLUMN box_rate REAL NOT NULL DEFAULT 30.0;');
        }
      }
    },
    {
      version: '20260908_add_extra_pieces',
      up: () => {
        if (!hasColumn('attendance', 'extra_pieces')) {
          db.exec('ALTER TABLE attendance ADD COLUMN extra_pieces REAL NOT NULL DEFAULT 0.0;');
        }
      }
    },
    {
      version: '20260909_add_worker_pin_hash',
      up: () => {
        if (!hasColumn('employees', 'pin_hash')) {
          db.exec('ALTER TABLE employees ADD COLUMN pin_hash TEXT;');
        }
        const defaultHash = bcrypt.hashSync('12345', 10);
        db.prepare('UPDATE employees SET pin_hash = ? WHERE pin_hash IS NULL').run(defaultHash);
      }
    },
    {
      version: '20261009_payments_soft_delete',
      up: () => {
        if (!hasColumn('payments', 'deleted_at')) {
          db.exec('ALTER TABLE payments ADD COLUMN deleted_at DATETIME DEFAULT NULL;');
        }
        if (!hasColumn('payments', 'deleted_by')) {
          db.exec("ALTER TABLE payments ADD COLUMN deleted_by TEXT DEFAULT NULL;");
        }
      }
    },
    {
      version: '20261010_v5_scalability_indexes_and_departments',
      up: () => {
        if (!hasColumn('employees', 'department')) {
          db.exec("ALTER TABLE employees ADD COLUMN department TEXT DEFAULT '';");
        }
        if (!hasColumn('employees', 'branch')) {
          db.exec("ALTER TABLE employees ADD COLUMN branch TEXT DEFAULT '';");
        }
        db.exec("CREATE INDEX IF NOT EXISTS idx_employees_status_name ON employees(status, name);");
        db.exec("CREATE INDEX IF NOT EXISTS idx_attendance_date_emp ON attendance(date, employee_id);");
      }
    }
  ];

  const checkMigStmt = db.prepare('SELECT version FROM schema_migrations WHERE version = ?');
  const insertMigStmt = db.prepare('INSERT INTO schema_migrations (version) VALUES (?)');

  for (const m of migrations) {
    if (!checkMigStmt.get(m.version)) {
      try {
        withTransaction(() => {
          m.up();
          insertMigStmt.run(m.version);
        });
      } catch (err) {
        console.error(`❌ Migration failed for version ${m.version}:`, err);
        throw new Error(`Database migration failed on ${m.version}: ${err.message}`);
      }
    }
  }

  // Initialize Default Settings if not present
  const defaultSettings = [
    { key: 'business_name', value: 'Daily Wage Attendance & Payroll' },
    { key: 'currency_symbol', value: '₹' },
    { key: 'default_ot_multiplier', value: '0.0' },
    { key: 'default_box_rate', value: '30.0' },
    { key: 'default_daily_wage', value: '500.0' },
    { key: 'work_categories', value: JSON.stringify(DEFAULT_CATEGORIES) },
    { key: 'weekly_paid_off_day', value: 'Tuesday' },
    { key: 'site_location', value: 'Main Work Site' },
    { key: 'holiday_piece_bonus', value: '200.0' },
    { key: 'pieces_per_box', value: '500' },
    { key: 'piece_keywords', value: 'card, bangle' },
    { key: 'standard_hours', value: '8.0' },
    { key: 'theme_preference', value: 'light' }
  ];

  const checkSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const insertSettingStmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');

  for (const s of defaultSettings) {
    if (!checkSettingStmt.get(s.key)) {
      insertSettingStmt.run(s.key, s.value);
    }
  }

  // Admin PIN setup / initialization logic
  const existingPinRow = checkSettingStmt.get('admin_pin');
  if (existingPinRow) {
    const val = existingPinRow.value;
    if (val && !val.startsWith('$2a$') && !val.startsWith('$2b$')) {
      const hashed = bcrypt.hashSync(val, 10);
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(hashed, 'admin_pin');
    }
  } else {
    // If environment specifies DEFAULT_ADMIN_PIN, use it
    if (config.DEFAULT_ADMIN_PIN) {
      const hashed = bcrypt.hashSync(config.DEFAULT_ADMIN_PIN, 10);
      insertSettingStmt.run('admin_pin', hashed);
    } else if (config.IS_TEST) {
      // In test mode, initialize with test PIN
      const hashed = bcrypt.hashSync('test-admin-pin-1234', 10);
      insertSettingStmt.run('admin_pin', hashed);
    }
    // In production without DEFAULT_ADMIN_PIN, admin_pin remains unset until first-run setup
  }

  // Persistent JWT Secret (prefer process.env.JWT_SECRET)
  const existingSecretRow = checkSettingStmt.get('jwt_secret');
  if (!existingSecretRow) {
    const secret = config.JWT_SECRET || crypto.randomBytes(32).toString('hex');
    insertSettingStmt.run('jwt_secret', secret);
  } else if (config.JWT_SECRET && existingSecretRow.value !== config.JWT_SECRET) {
    // Override DB secret if environment variable is explicitly provided
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(config.JWT_SECRET, 'jwt_secret');
  }

  // Seed default holidays if table is empty
  const countHol = db.prepare('SELECT COUNT(*) as count FROM holidays').get();
  if (countHol && countHol.count === 0) {
    const seedHoliday = db.prepare('INSERT OR IGNORE INTO holidays (date, title, is_paid) VALUES (?, ?, ?)');
    seedHoliday.run('2026-10-02', 'Gandhi Jayanti', 1);
    seedHoliday.run('2026-11-08', 'Diwali', 1);
    seedHoliday.run('2026-12-25', 'Christmas', 1);
    seedHoliday.run('2026-01-26', 'Republic Day', 1);
    seedHoliday.run('2026-08-15', 'Independence Day', 1);
  }
}

initDatabase();

// Auth and Crypto Helpers
function getJwtSecret() {
  if (config.JWT_SECRET) return config.JWT_SECRET;
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('jwt_secret');
  if (row && row.value) return row.value;

  // Generate on the fly and persist
  const newSecret = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('jwt_secret', newSecret);
  return newSecret;
}

function rotateJwtSecret() {
  const newSecret = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('jwt_secret', newSecret);
  return newSecret;
}

function isAdminInitialized() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_pin');
  return !!(row && row.value && row.value.trim().length > 0);
}

function verifyAdminPin(enteredPin) {
  if (!enteredPin) return false;
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_pin');
  if (!row || !row.value) return false;
  const storedVal = row.value;

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
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('admin_pin', hashed);
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
  rotateJwtSecret,
  isAdminInitialized,
  verifyAdminPin,
  updateAdminPin
};
