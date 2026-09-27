const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const attendanceService = require('../../services/attendance.service');
const settingsService = require('../../services/settings.service');
const systemService = require('../../services/system.service');
const authService = require('../../services/auth.service');

describe('Services Unit Tests', () => {
  describe('AttendanceService.getDateMeta', () => {
    it('accurately identifies Tuesday as a paid weekly off', () => {
      // 2026-10-06 is a Tuesday
      const meta = attendanceService.getDateMeta('2026-10-06');
      assert.equal(meta.isTuesday, true);
      assert.equal(meta.isPaidDayOff, true);
      assert.equal(meta.dayOfWeek, 'Tuesday');
      assert.ok(meta.dayOffReason.includes('Tuesday Weekly Off'));
    });

    it('identifies non-Tuesday regular working days as not day off (unless holiday)', () => {
      // 2026-10-07 is a Wednesday
      const meta = attendanceService.getDateMeta('2026-10-07');
      assert.equal(meta.isTuesday, false);
      assert.equal(meta.dayOfWeek, 'Wednesday');
    });
  });

  describe('SettingsService.getSettings', () => {
    it('retrieves settings and excludes sensitive admin credentials', () => {
      const settings = settingsService.getSettings();
      assert.ok(settings);
      assert.equal(settings.admin_pin, undefined, 'Must not expose admin_pin in public settings');
      assert.equal(settings.jwt_secret, undefined, 'Must not expose jwt_secret in public settings');
    });

    it('parses work_categories_list if work_categories exists', () => {
      const settings = settingsService.getSettings();
      if (settings.work_categories) {
        assert.ok(Array.isArray(settings.work_categories_list));
      }
    });
  });

  describe('SystemService', () => {
    it('getHealth returns database status and integrity metrics', () => {
      const health = systemService.getHealth();
      assert.ok(health);
      assert.equal(typeof health.isHealthy, 'boolean');
      assert.equal(health.version, '3.0.0');
      assert.ok(health.database);
    });

    it('getLocalNetworkIp returns valid host IP or localhost', () => {
      const ip = systemService.getLocalNetworkIp();
      assert.ok(typeof ip === 'string');
      assert.ok(ip.length > 0);
    });

    it('getBackupInfo returns path and timestamped db filename', () => {
      const info = systemService.getBackupInfo();
      assert.ok(info.filePath.endsWith('.db'));
      assert.ok(info.filename.startsWith('attendance_backup_'));
      assert.ok(info.filename.endsWith('.db'));
    });
  });

  describe('AuthService token validation', () => {
    it('returns unauthenticated for empty or null token', () => {
      const resNull = authService.checkToken(null);
      assert.equal(resNull.authenticated, false);

      const resEmpty = authService.checkToken('');
      assert.equal(resEmpty.authenticated, false);
    });

    it('returns unauthenticated for malformed token', () => {
      const resBad = authService.checkToken('invalid.token.signature');
      assert.equal(resBad.authenticated, false);
    });
  });
});
