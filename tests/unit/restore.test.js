const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { safeRestore, validateDatabaseFile } = require('../../scripts/restore');

describe('Database Safe Restoration Unit Tests (DB-01)', () => {
  const tmpDir = path.join(__dirname, '..', 'tmp_restore_test');
  const liveDbPath = path.join(tmpDir, 'test_live.db');
  const validBackupPath = path.join(tmpDir, 'test_valid_backup.db');
  const corruptBackupPath = path.join(tmpDir, 'test_corrupt_backup.db');

  function setupTestDbs() {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    // 1. Create a simulated live database
    const liveDb = new DatabaseSync(liveDbPath);
    liveDb.exec(`
      CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE attendance (id INTEGER PRIMARY KEY, date TEXT);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO employees (name) VALUES ('Original Live Worker');
    `);
    liveDb.close();

    // 2. Create a valid backup database with different data
    const validDb = new DatabaseSync(validBackupPath);
    validDb.exec(`
      CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE attendance (id INTEGER PRIMARY KEY, date TEXT);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO employees (name) VALUES ('Restored Backup Worker');
    `);
    validDb.close();

    // 3. Create a corrupt/invalid database file
    fs.writeFileSync(corruptBackupPath, 'NOT_A_VALID_SQLITE_FILE_CONTENT_XYZ_12345');
  }

  function cleanupTestDbs() {
    if (fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (e) {}
    }
  }

  it('rejects unavailable or non-existent backup file without touching live db', () => {
    setupTestDbs();
    try {
      assert.throws(() => {
        safeRestore(path.join(tmpDir, 'non_existent_backup.db'), { dbPath: liveDbPath });
      }, /does not exist/);

      // Verify live DB was NOT touched
      const liveDb = new DatabaseSync(liveDbPath, { readOnly: true });
      const worker = liveDb.prepare("SELECT name FROM employees WHERE name = 'Original Live Worker'").get();
      liveDb.close();
      assert.ok(worker, 'Original live database must remain completely intact');
    } finally {
      cleanupTestDbs();
    }
  });

  it('rejects corrupt backup candidate and leaves original database completely intact', () => {
    setupTestDbs();
    try {
      assert.throws(() => {
        safeRestore(corruptBackupPath, { dbPath: liveDbPath });
      });

      // Verify original live DB content was preserved
      const liveDb = new DatabaseSync(liveDbPath, { readOnly: true });
      const worker = liveDb.prepare("SELECT name FROM employees WHERE name = 'Original Live Worker'").get();
      liveDb.close();
      assert.ok(worker, 'Original live database must be preserved on corrupt candidate failure');
    } finally {
      cleanupTestDbs();
    }
  });

  it('successfully restores a validated backup and replaces active database', () => {
    setupTestDbs();
    try {
      const result = safeRestore(validBackupPath, { dbPath: liveDbPath });
      assert.equal(result.success, true);
      assert.ok(result.safetyCopy, 'Pre-restore safety copy must be created');

      // Verify restored content in live DB
      const liveDb = new DatabaseSync(liveDbPath, { readOnly: true });
      const worker = liveDb.prepare("SELECT name FROM employees WHERE name = 'Restored Backup Worker'").get();
      liveDb.close();
      assert.ok(worker, 'Restored database must contain backup records');
    } finally {
      cleanupTestDbs();
    }
  });
});
