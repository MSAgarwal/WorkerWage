/**
 * WorkerWage Database Restore Utility (DB-01)
 * Safely restores an atomic database snapshot offline from backups/ or a custom path.
 * 
 * Safety Guarantees:
 * 1. Independent validation: Validates candidate backup integrity & tables BEFORE touching active database.
 * 2. Pre-restore safety copy: Takes an atomic safety snapshot of the active DB before replacement.
 * 3. Fresh connection verification: Validates the newly restored database with an isolated connection.
 * 4. Automatic rollback: If post-restore integrity fails, rolls back to pre-restore safety copy.
 * 5. Connection safety: Does NOT import an already-open database connection.
 * 
 * Usage: node scripts/restore.js [path-to-backup.db] [--force]
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config/env');

const DB_PATH = config.DB_PATH || path.join(__dirname, '..', 'attendance.db');

/**
 * Independently validates a backup candidate file
 */
function validateDatabaseFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }
  const stat = fs.statSync(filePath);
  if (stat.size === 0) {
    throw new Error(`Candidate backup file is empty (0 bytes): ${filePath}`);
  }

  let db = null;
  try {
    db = new DatabaseSync(filePath, { readOnly: true });
    const integrity = db.prepare('PRAGMA integrity_check;').all();
    if (!integrity || integrity.length === 0 || integrity[0].integrity_check !== 'ok') {
      const issue = integrity ? JSON.stringify(integrity) : 'No integrity result';
      throw new Error(`Database integrity check failed: ${issue}`);
    }

    // Verify presence of core required application tables
    const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('employees', 'attendance', 'settings');").all();
    const tableNames = tableRows.map(r => r.name);
    if (!tableNames.includes('employees') || !tableNames.includes('attendance') || !tableNames.includes('settings')) {
      throw new Error(`Candidate database is missing required tables (found: ${tableNames.join(', ') || 'none'})`);
    }

    return true;
  } finally {
    if (db) {
      try { db.close(); } catch (e) {}
    }
  }
}

/**
 * Safely restores target backup file to DB_PATH
 */
function safeRestore(backupFilePath, options = {}) {
  const targetDbPath = options.dbPath || DB_PATH;

  if (!backupFilePath) {
    const backupDir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(backupDir)) {
      throw new Error(`No backups directory found at: ${backupDir}`);
    }
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('attendance_backup_') && f.endsWith('.db'))
      .map(f => ({ name: f, path: path.join(backupDir, f), mtime: fs.statSync(path.join(backupDir, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) {
      throw new Error('No backup files found in backups/ directory.');
    }
    backupFilePath = files[0].path;
  }

  const resolvedPath = path.resolve(backupFilePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Specified backup file does not exist: ${resolvedPath}`);
  }

  // Step 1: Independently validate candidate backup BEFORE modifying active database
  validateDatabaseFile(resolvedPath);

  // Step 2: Create a safety copy of current active database
  let safetyCopyPath = null;
  if (fs.existsSync(targetDbPath)) {
    safetyCopyPath = `${targetDbPath}.pre_restore_${Date.now()}`;
    fs.copyFileSync(targetDbPath, safetyCopyPath);

    // If WAL file exists, copy it alongside for safety
    const activeWal = `${targetDbPath}-wal`;
    if (fs.existsSync(activeWal)) {
      fs.copyFileSync(activeWal, `${safetyCopyPath}-wal`);
    }
  }

  try {
    // Step 3: Remove active WAL and SHM files to prevent sidecar mismatch
    const walPath = `${targetDbPath}-wal`;
    const shmPath = `${targetDbPath}-shm`;
    if (fs.existsSync(walPath)) {
      try { fs.unlinkSync(walPath); } catch (e) {}
    }
    if (fs.existsSync(shmPath)) {
      try { fs.unlinkSync(shmPath); } catch (e) {}
    }

    // Step 4: Overwrite active database file with validated candidate backup
    fs.copyFileSync(resolvedPath, targetDbPath);

    // Step 5: Independently verify restored database using a fresh connection
    validateDatabaseFile(targetDbPath);

    return {
      success: true,
      restoredFrom: resolvedPath,
      targetDb: targetDbPath,
      safetyCopy: safetyCopyPath
    };
  } catch (err) {
    // Step 6: Automatic Rollback on verification or copy failure
    if (safetyCopyPath && fs.existsSync(safetyCopyPath)) {
      try {
        fs.copyFileSync(safetyCopyPath, targetDbPath);
        const savedWal = `${safetyCopyPath}-wal`;
        if (fs.existsSync(savedWal)) {
          fs.copyFileSync(savedWal, `${targetDbPath}-wal`);
        }
      } catch (rollbackErr) {
        throw new Error(`Restoration failed (${err.message}) and automated rollback encountered error: ${rollbackErr.message}`);
      }
    }
    throw new Error(`Restoration aborted: ${err.message}. Original database was preserved.`);
  }
}

function runCliRestore(targetFile) {
  console.log('========================================================');
  console.log(' 🔄 WORKERWAGE DATABASE RESTORATION UTILITY (v6.0)');
  console.log('========================================================\n');

  try {
    console.log('🔍 Step 1: Validating candidate backup independently...');
    const result = safeRestore(targetFile);
    console.log(`✅ Candidate backup validated: ${result.restoredFrom}`);
    if (result.safetyCopy) {
      console.log(`🛡️ Pre-restore safety backup created: ${path.basename(result.safetyCopy)}`);
    }
    console.log(`✅ Active database replaced at: ${result.targetDb}`);
    console.log('✅ Post-restore integrity verification passed: OK\n');
    console.log('========================================================');
    console.log(' 🚀 RESTORATION COMPLETE! You may now safely start the server:');
    console.log('    npm start   OR   npm run pm2:start');
    console.log('========================================================\n');
  } catch (err) {
    console.error(`\n❌ RESTORATION FAILED: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  const targetFile = process.argv.slice(2).find(arg => !arg.startsWith('--'));
  runCliRestore(targetFile);
}

module.exports = {
  safeRestore,
  validateDatabaseFile
};
