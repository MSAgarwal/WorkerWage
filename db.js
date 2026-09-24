const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'attendance.db');
const db = new DatabaseSync(DB_PATH);

// Optimize database for reliability and speed
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

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
      daily_wage REAL NOT NULL DEFAULT 0.0,
      standard_hours REAL DEFAULT 8.0,
      default_ot_multiplier REAL NOT NULL DEFAULT 0.0,
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

  // Migrate attendance table for day-wise overtime and holiday work if upgrading
  try {
    db.exec('ALTER TABLE attendance ADD COLUMN overtime_days REAL NOT NULL DEFAULT 0.0;');
  } catch (e) {}
  try {
    db.exec('ALTER TABLE attendance ADD COLUMN is_holiday_work INTEGER NOT NULL DEFAULT 0;');
  } catch (e) {}

  // Initialize Default Settings if not present
  const defaultSettings = [
    { key: 'admin_pin', value: '1234' },
    { key: 'business_name', value: 'Daily Wage Attendance & Payroll' },
    { key: 'currency_symbol', value: '₹' },
    { key: 'default_ot_multiplier', value: '0.0' },
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

module.exports = {
  db,
  DB_PATH
};
