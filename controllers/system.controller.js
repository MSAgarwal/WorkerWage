const systemService = require('../services/system.service');

class SystemController {
  /**
   * GET /api/server-info
   * Get server network information and QR code
   */
  async getServerInfo(req, res, next) {
    try {
      const port = parseInt(process.env.PORT, 10) || 5000;
      const info = await systemService.getServerInfo(port);
      res.json({
        success: true,
        ...info
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/health
   * Database integrity and system health check
   */
  getHealth(req, res, next) {
    try {
      const health = systemService.getHealth();
      const statusCode = health.isHealthy ? 200 : 503;
      res.status(statusCode).json(health);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/backup
   * Download live SQLite database snapshot
   */
  downloadBackup(req, res, next) {
    try {
      const { filePath, filename } = systemService.getBackupInfo();
      res.download(filePath, filename);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new SystemController();
