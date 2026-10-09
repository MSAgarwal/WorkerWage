const employeeService = require('../services/employee.service');
const { validateEmployeeInput } = require('../validators');

class EmployeeController {
  /**
   * GET /api/employees
   * List all employees, with optional status, department, branch, and search filters
   */
  getEmployees(req, res, next) {
    try {
      const { status, department, branch, search, limit, offset } = req.query;
      const employees = employeeService.getEmployees(status, { department, branch, search, limit, offset });
      res.json({ success: true, employees });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/employees/departments
   * List distinct worker departments
   */
  getDepartments(req, res, next) {
    try {
      const departments = employeeService.getDepartments();
      res.json({ success: true, departments });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/employees/branches
   * List distinct worker branches
   */
  getBranches(req, res, next) {
    try {
      const branches = employeeService.getBranches();
      res.json({ success: true, branches });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/employees/export-csv
   * Export all workers as a CSV file
   */
  exportCsv(req, res, next) {
    try {
      const csv = employeeService.exportEmployeesCsv();
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="workers.csv"');
      res.send(csv);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/employees/bulk-import
   * Bulk import workers from array
   */
  bulkImport(req, res, next) {
    try {
      const { employees } = req.body;
      if (!Array.isArray(employees)) {
        return res.status(400).json({ success: false, error: 'Expected an array of worker records in body.employees' });
      }
      const result = employeeService.bulkImportEmployees(employees);
      res.json({
        success: true,
        message: `Imported ${result.created} new workers, updated ${result.updated} existing workers.`,
        ...result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/employees
   * Add a new employee
   */
  createEmployee(req, res, next) {
    try {
      const validation = validateEmployeeInput(req.body, false);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          error: validation.errors.join('; '),
          details: validation.errors
        });
      }

      const newWorker = employeeService.createEmployee(validation.sanitized);
      res.status(201).json({
        success: true,
        message: 'Worker added successfully',
        employee: newWorker
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/employees/:id
   * Update employee details
   */
  updateEmployee(req, res, next) {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid worker ID' });
      }

      const validation = validateEmployeeInput(req.body, true);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          error: validation.errors.join('; '),
          details: validation.errors
        });
      }

      const updated = employeeService.updateEmployee(id, validation.sanitized);
      res.json({
        success: true,
        message: 'Worker details updated',
        employee: updated
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/employees/:id
   * Deactivate or permanently delete an employee
   */
  deleteEmployee(req, res, next) {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid worker ID' });
      }

      const { hardDelete, force } = req.query;
      const result = employeeService.deleteEmployee(id, hardDelete, force);
      res.json({
        success: true,
        message: result.message
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new EmployeeController();
