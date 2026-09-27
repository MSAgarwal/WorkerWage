const path = require('path');
const dotenv = require('dotenv');

// Explicitly load .env file from project root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const packageJson = require('../package.json');

const config = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 5000,
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'attendance.db'),
  JWT_SECRET: process.env.JWT_SECRET || null,
  DEFAULT_ADMIN_PIN: process.env.DEFAULT_ADMIN_PIN || null,
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : null,
  APP_VERSION: packageJson.version,
  IS_TEST: process.env.NODE_ENV === 'test'
};

module.exports = config;
