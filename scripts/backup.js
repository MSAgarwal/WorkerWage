/**
 * Production SQLite Database Backup Utility for WorkerWage
 * Creates atomic snapshots into backups/ directory and retains latest 30 backups.
 */

const fs = require('fs');
const path = require('path');
const { db, DB_PATH, checkDatabaseIntegrity } = require('../db');

function runBackup() {
  console.log('========================================================');
  console.log(' 💾 RUNNING WORKERWAGE PRODUCTION DATABASE BACKUP');
  console.log('========================================================\n');

  // 1. Verify Database Integrity First
  console.log('🔍 Checking database integrity...');
  const isHealthy = checkDatabaseIntegrity();
  if (!isHealthy) {
    console.error('❌ Database integrity check failed! Aborting backup to prevent copying corrupted data.');
    process.exit(1);
  }
  console.log('✅ Database integrity verified: OK');

  // 2. Prepare Backup Directory
  const backupDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // 3. Flush WAL to main database file
  console.log('📦 Flushing WAL checkpoints...');
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (err) {
    console.warn('Warning on WAL checkpoint:', err.message);
  }

  // 4. Generate timestamped backup file
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `attendance_backup_${dateStr}.db`);

  console.log(`📂 Creating atomic backup at: ${backupPath}`);
  try {
    // VACUUM INTO creates a clean, optimized copy of the database
    db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}';`);
    console.log('✅ Backup created successfully!');
  } catch (err) {
    // Fallback: Copy file directly
    console.warn('VACUUM INTO failed, falling back to direct copy:', err.message);
    fs.copyFileSync(DB_PATH, backupPath);
    console.log('✅ File copy backup completed!');
  }

  // 5. Prune backups older than 30 days
  const files = fs.readdirSync(backupDir)
    .filter(f => f.startsWith('attendance_backup_') && f.endsWith('.db'))
    .map(f => ({ name: f, path: path.join(backupDir, f), mtime: fs.statSync(path.join(backupDir, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);

  const MAX_BACKUPS = 30;
  if (files.length > MAX_BACKUPS) {
    console.log(`\n🧹 Pruning old backups (keeping latest ${MAX_BACKUPS})...`);
    for (let i = MAX_BACKUPS; i < files.length; i++) {
      fs.unlinkSync(files[i].path);
      console.log(`  Removed: ${files[i].name}`);
    }
  }

  console.log('\n========================================================');
  console.log(` Backup completed. Total backups retained: ${Math.min(files.length, MAX_BACKUPS)}`);
  console.log('========================================================\n');
}

if (require.main === module) {
  runBackup();
}

module.exports = { runBackup };
