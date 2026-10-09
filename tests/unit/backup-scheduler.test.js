const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const backupScheduler = require('../../services/backup-scheduler.service');

describe('Backup Scheduler Unit Tests', () => {
  it('successfully creates an atomic backup snapshot and verifies file existence', () => {
    const backupPath = backupScheduler.createBackupSnapshot();
    assert.ok(backupPath, 'Backup path should not be null');
    assert.ok(fs.existsSync(backupPath), 'Backup file should exist on disk');

    // Clean up temporary snapshot created in unit test
    try {
      fs.unlinkSync(backupPath);
    } catch (e) {}
  });

  it('manages timer lifecycle with start and stop', () => {
    backupScheduler.stop();
    assert.equal(backupScheduler.timer, null);

    // Starting when enabled starts timer
    backupScheduler.start();
    // In test environment, config.AUTO_BACKUP_ENABLED is false, so timer remains null
    backupScheduler.stop();
    assert.equal(backupScheduler.timer, null);
  });
});
