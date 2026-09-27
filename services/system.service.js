const os = require('os');
const QRCode = require('qrcode');
const { db, DB_PATH, checkDatabaseIntegrity } = require('../db');
const config = require('../config/env');

class SystemService {
  /**
   * Helper: Get primary non-internal IPv4 address for local network access
   */
  getLocalNetworkIp() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
    return 'localhost';
  }

  /**
   * Get server network connection information and QR code for mobile scanning
   */
  async getServerInfo(port) {
    const ip = this.getLocalNetworkIp();
    const networkUrl = `http://${ip}:${port}`;
    const localUrl = `http://localhost:${port}`;
    const qrCodeDataUrl = await QRCode.toDataURL(networkUrl, {
      width: 280,
      margin: 2,
      color: {
        dark: '#1e293b',
        light: '#ffffff'
      }
    });

    return {
      ip,
      port,
      networkUrl,
      localUrl,
      qrCodeDataUrl,
      hostname: os.hostname(),
      platform: os.platform()
    };
  }

  /**
   * Get system health and database integrity diagnostics
   */
  getHealth() {
    const isHealthy = checkDatabaseIntegrity();
    let journalMode = 'unknown';
    try {
      const row = db.prepare('PRAGMA journal_mode;').get();
      journalMode = row ? row.journal_mode : 'unknown';
    } catch (e) {}

    return {
      isHealthy,
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      database: {
        integrity: isHealthy ? 'OK' : 'CORRUPTED',
        journalMode: journalMode
      },
      version: config.APP_VERSION
    };
  }

  /**
   * Get backup file information for download
   */
  getBackupInfo() {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return {
      filePath: DB_PATH,
      filename: `attendance_backup_${today}.db`
    };
  }
}

module.exports = new SystemService();
