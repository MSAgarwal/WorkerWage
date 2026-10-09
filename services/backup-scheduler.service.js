const fs = require('fs');
const path = require('path');
const config = require('../config/env');
const { db, DB_PATH, checkDatabaseIntegrity } = require('../db');

class BackupSchedulerService {
  constructor() {
    this.timer = null;
    this.backupDir = path.join(__dirname, '..', 'backups');
    this.maxBackups = 30;
  }

  /**
   * Creates an atomic SQLite snapshot into backups/ folder and prunes old backups
   */
  createBackupSnapshot() {
    try {
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
      }

      // Check database integrity first
      const isHealthy = checkDatabaseIntegrity();
      if (!isHealthy) {
        console.error('[BackupScheduler] Database integrity check failed. Skipping scheduled backup.');
        return null;
      }

      // Checkpoint WAL to ensure all transactions are synced
      try {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      } catch (err) {
        console.warn('[BackupScheduler] WAL checkpoint warning:', err.message);
      }

      const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(this.backupDir, `attendance_backup_${dateStr}.db`);

      try {
        db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}';`);
      } catch (err) {
        fs.copyFileSync(DB_PATH, backupPath);
      }

      // Prune old backups, keeping latest 30 snapshots
      const files = fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('attendance_backup_') && f.endsWith('.db'))
        .map(f => ({ name: f, path: path.join(this.backupDir, f), mtime: fs.statSync(path.join(this.backupDir, f)).mtime }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > this.maxBackups) {
        for (let i = this.maxBackups; i < files.length; i++) {
          try {
            fs.unlinkSync(files[i].path);
          } catch (e) {
            // Ignore file lock errors during pruning
          }
        }
      }

      console.log(`[BackupScheduler] Automated backup created: ${path.basename(backupPath)}`);
      return backupPath;
    } catch (err) {
      console.error('[BackupScheduler] Error running automated backup:', err.message);
      return null;
    }
  }

  /**
   * Start periodic backup timer based on config.AUTO_BACKUP_INTERVAL_HOURS
   */
  start() {
    if (!config.AUTO_BACKUP_ENABLED) {
      return;
    }

    const intervalMs = config.AUTO_BACKUP_INTERVAL_HOURS * 60 * 60 * 1000;
    console.log(`🕒 Automated database backup scheduler active (every ${config.AUTO_BACKUP_INTERVAL_HOURS} hours)`);

    this.timer = setInterval(() => {
      this.createBackupSnapshot();
    }, intervalMs);

    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  /**
   * Stop scheduled backup timer
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

module.exports = new BackupSchedulerService();
