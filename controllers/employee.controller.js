const employeeService = require('../services/employee.service');
const { validateEmployeeInput } = require('../validators');

class EmployeeController {
  /**
   * GET /api/employees
   * List all employees, with optional status filter
   */
  getEmployees(req, res, next) {
    try {
      const { status } = req.query;
      const employees = employeeService.getEmployees(status);
      res.json({ success: true, employees });
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

      const { hardDelete } = req.query;
      const result = employeeService.deleteEmployee(id, hardDelete);
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
