const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendance.controller');
const { requireAdmin } = require('../middleware/auth.middleware');

router.get('/', requireAdmin, (req, res, next) => attendanceController.getAttendance(req, res, next));
router.post('/', requireAdmin, (req, res, next) => attendanceController.saveAttendance(req, res, next));
router.post('/batch', requireAdmin, (req, res, next) => attendanceController.batchSaveAttendance(req, res, next));

module.exports = router;
