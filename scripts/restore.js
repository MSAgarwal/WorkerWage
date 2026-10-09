/**
 * WorkerWage Database Restore Utility
 * Safely restores an atomic database snapshot from backups/ or a custom file path.
 * Usage: node scripts/restore.js <path-to-backup.db>
 */

const fs = require('fs');
const path = require('path');
const { DB_PATH, checkDatabaseIntegrity } = require('../db');

function runRestore(backupFilePath) {
  console.log('========================================================');
  console.log(' 🔄 WORKERWAGE DATABASE RESTORATION UTILITY');
  console.log('========================================================\n');

  if (!backupFilePath) {
    const backupDir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(backupDir)) {
      console.error('❌ No backups directory found at:', backupDir);
      process.exit(1);
    }
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('attendance_backup_') && f.endsWith('.db'))
      .map(f => ({ name: f, path: path.join(backupDir, f), mtime: fs.statSync(path.join(backupDir, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) {
      console.error('❌ No backup files found in backups/ directory.');
      console.log('Usage: node scripts/restore.js <path-to-backup.db>');
      process.exit(1);
    }

    backupFilePath = files[0].path;
    console.log(`ℹ️ No file specified. Automatically selecting most recent snapshot:`);
    console.log(`   ${files[0].name} (${files[0].mtime.toLocaleString()})\n`);
  }

  const resolvedPath = path.resolve(backupFilePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`❌ Specified backup file does not exist: ${resolvedPath}`);
    process.exit(1);
  }

  // 1. Create a pre-restore safety copy of the current live database
  if (fs.existsSync(DB_PATH)) {
    const safetyCopy = `${DB_PATH}.pre_restore_${Date.now()}`;
    console.log(`🛡️ Creating pre-restore safety copy of active database at:`);
    console.log(`   ${path.basename(safetyCopy)}`);
    fs.copyFileSync(DB_PATH, safetyCopy);
  }

  // 2. Remove auxiliary WAL/SHM files to prevent journal mismatch
  const walPath = `${DB_PATH}-wal`;
  const shmPath = `${DB_PATH}-shm`;
  if (fs.existsSync(walPath)) {
    try { fs.unlinkSync(walPath); } catch (e) {}
  }
  if (fs.existsSync(shmPath)) {
    try { fs.unlinkSync(shmPath); } catch (e) {}
  }

  // 3. Overwrite current DB with target backup
  console.log(`📂 Restoring database from: ${resolvedPath}`);
  fs.copyFileSync(resolvedPath, DB_PATH);
  console.log('✅ Database file copied successfully.');

  // 4. Verify integrity of restored database
  console.log('🔍 Verifying restored database integrity...');
  const isHealthy = checkDatabaseIntegrity();
  if (isHealthy) {
    console.log('✅ Database integrity verified: OK (PRAGMA integrity_check passed)\n');
    console.log('========================================================');
    console.log(' 🚀 RESTORATION COMPLETE! You may now start the server:');
    console.log('    npm start   OR   npm run pm2:start');
    console.log('========================================================\n');
  } else {
    console.error('❌ WARNING: Restored database integrity check reported issues!');
    process.exit(1);
  }
}

if (require.main === module) {
  const targetFile = process.argv[2];
  runRestore(targetFile);
}

module.exports = { runRestore };
