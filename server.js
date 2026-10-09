const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const QRCode = require('qrcode');

const config = require('./config/env');
const { db } = require('./db');
const { NotFoundError, errorHandler } = require('./errors');
const { securityHeaders } = require('./middleware/security.middleware');
const { requestLogger } = require('./middleware/logger.middleware');
const { globalRateLimiter } = require('./middleware/rate-limit.middleware');
const systemService = require('./services/system.service');
const backupScheduler = require('./services/backup-scheduler.service');
const apiRoutes = require('./routes');

const app = express();
const PORT = config.PORT;

// Trust reverse proxy headers (Cloudflare, tunnels, load balancers)
app.set('trust proxy', 1);

// Security Headers
app.use(securityHeaders);

// Core Middleware: CORS for Local, LAN, and Cloudflare Tunnels
const corsOptions = {
  origin: config.ALLOWED_ORIGINS || function(origin, callback) {
    if (!origin) return callback(null, true);
    // Allow loopback, private LAN addresses, and Cloudflare tunnel origins
    if (
      /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(origin) ||
      /^https?:\/\/([a-zA-Z0-9-]+\.)*trycloudflare\.com(:\d+)?$/.test(origin)
    ) {
      return callback(null, true);
    }
    return callback(new Error('Cross-origin request blocked by CORS policy'));
  },
  credentials: true
};
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Structured Request Logging
app.use(requestLogger);

// Global API Rate Limiting (DoS and brute-force mitigation)
app.use('/api', globalRateLimiter);

// Mount Modular API Routes
app.use('/api', apiRoutes);

// Unknown API routes return JSON 404
app.use('/api', (req, res, next) => {
  next(new NotFoundError(`API endpoint ${req.method} ${req.originalUrl || req.url} not found`));
});

// Centralized Express Error Handling Middleware
app.use(errorHandler);

// Fallback to SPA for client-side routing
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
const server = app.listen(PORT, '0.0.0.0', async () => {
  const ip = systemService.getLocalNetworkIp();
  const localUrl = `http://localhost:${PORT}`;
  const networkUrl = `http://${ip}:${PORT}`;

  console.log('\n============================================================');
  console.log('   🚀 EMPLOYEE ATTENDANCE & PAYROLL SERVER RUNNING');
  console.log('============================================================');
  console.log(`💻 LAPTOP ACCESS : ${localUrl}`);
  console.log(`📱 MOBILE ACCESS : ${networkUrl}`);
  console.log('------------------------------------------------------------');
  console.log('👉 To access from mobile:');
  console.log(`   1. Ensure phone and laptop are on same Wi-Fi / Hotspot`);
  console.log(`   2. Open browser on phone and type: ${networkUrl}`);
  console.log(`   3. OR scan the QR code below with your phone camera:`);
  console.log('------------------------------------------------------------\n');

  try {
    const qrString = await QRCode.toString(networkUrl, { type: 'terminal', small: true });
    console.log(qrString);
  } catch (e) {
    console.log('(QR code generation preview omitted in console)');
  }

  console.log('🔒 Security: Admin PIN hashed & server-side JWT auth active');
  console.log('============================================================\n');

  // Start automated background backup scheduler
  backupScheduler.start();
});

// Graceful Shutdown
function gracefulShutdown(signal) {
  console.log(`\n[${new Date().toISOString()}] Received ${signal}. Shutting down gracefully...`);
  backupScheduler.stop();
  server.close(() => {
    console.log('HTTP server closed.');
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      db.close();
      console.log('Database connection cleanly closed.');
    } catch (e) {
      console.error('Error closing database:', e);
    }
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forced shutdown due to timeout.');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = { app, server };
