const express = require('express');
const router = express.Router();
const payrollController = require('../controllers/payroll.controller');
const { requireAdmin } = require('../middleware/auth.middleware');

router.get('/payroll', requireAdmin, (req, res, next) => payrollController.getPayrollReport(req, res, next));
router.get('/export-csv', requireAdmin, (req, res, next) => payrollController.exportCsv(req, res, next));

module.exports = router;
