const payrollService = require('../services/payroll.service');
const { isValidDate } = require('../validators');

class PayrollController {
  /**
   * GET /api/reports/payroll
   * Generate comprehensive payroll calculations report
   */
  getPayrollReport(req, res, next) {
    try {
      const { startDate, endDate, employee_id, department, branch } = req.query;

      if (startDate && !isValidDate(startDate)) {
        return res.status(400).json({ error: 'Invalid startDate parameter. Date must be in YYYY-MM-DD format.' });
      }
      if (endDate && !isValidDate(endDate)) {
        return res.status(400).json({ error: 'Invalid endDate parameter. Date must be in YYYY-MM-DD format.' });
      }

      let empId = null;
      if (employee_id) {
        empId = parseInt(employee_id, 10);
        if (isNaN(empId) || empId <= 0) {
          return res.status(400).json({ error: 'Invalid employee_id parameter' });
        }
      }

      const report = payrollService.generatePayrollReport({
        startDate,
        endDate,
        employee_id: empId,
        department,
        branch
      });

      res.json({
        success: true,
        ...report
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/reports/export-csv
   * Export payroll and attendance report as downloadable CSV
   */
  exportCsv(req, res, next) {
    try {
      const { startDate, endDate, employee_id, department, branch } = req.query;

      if (startDate && !isValidDate(startDate)) {
        return res.status(400).json({ error: 'Invalid startDate parameter. Date must be in YYYY-MM-DD format.' });
      }
      if (endDate && !isValidDate(endDate)) {
        return res.status(400).json({ error: 'Invalid endDate parameter. Date must be in YYYY-MM-DD format.' });
      }

      let empId = null;
      if (employee_id) {
        empId = parseInt(employee_id, 10);
        if (isNaN(empId) || empId <= 0) {
          return res.status(400).json({ error: 'Invalid employee_id parameter' });
        }
      }

      const { filename, content } = payrollService.generateCsvReport({
        startDate,
        endDate,
        employee_id: empId,
        department,
        branch
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(content);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new PayrollController();
