const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const settingsRoutes = require('./settings.routes');
const employeeRoutes = require('./employee.routes');
const holidayRoutes = require('./holiday.routes');
const attendanceRoutes = require('./attendance.routes');
const paymentRoutes = require('./payment.routes');
const payrollRoutes = require('./payroll.routes');
const workerRoutes = require('./worker.routes');
const systemRoutes = require('./system.routes');

// System and health diagnostics routes
router.use('/', systemRoutes);

// Feature domain routes
router.use('/auth', authRoutes);
router.use('/settings', settingsRoutes);
router.use('/employees', employeeRoutes);
router.use('/holidays', holidayRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/payments', paymentRoutes);
router.use('/reports', payrollRoutes);
router.use('/worker', workerRoutes);

module.exports = router;
