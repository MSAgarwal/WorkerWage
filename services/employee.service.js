const { db } = require('../db');
const { ConflictError, NotFoundError } = require('../errors');

class EmployeeService {
  /**
   * Get all employees, optionally filtered by status
   */
  getEmployees(status) {
    let query = 'SELECT * FROM employees';
    const params = [];

    if (status && status !== 'ALL') {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY status ASC, name ASC';
    return db.prepare(query).all(...params);
  }

  /**
   * Get a single employee by ID
   */
  getEmployeeById(id) {
    return db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  }

  /**
   * Create a new employee
   */
  createEmployee(data) {
    let code = data.employee_code;
    if (!code || code.trim() === '') {
      let candidateId = 1;
      const lastRow = db.prepare('SELECT id FROM employees ORDER BY id DESC LIMIT 1').get();
      if (lastRow) candidateId = lastRow.id + 1;
      code = 'EMP' + String(candidateId).padStart(3, '0');
      // Retry in case of concurrent sequence
      while (db.prepare('SELECT id FROM employees WHERE employee_code = ?').get(code)) {
        candidateId++;
        code = 'EMP' + String(candidateId).padStart(3, '0');
      }
    }

    const existingCode = db.prepare('SELECT id FROM employees WHERE employee_code = ?').get(code);
    if (existingCode) {
      throw new ConflictError(`Worker code "${code}" already exists. Please choose a different code.`);
    }

    try {
      const stmt = db.prepare(`
        INSERT INTO employees (employee_code, name, phone, role, worker_type, daily_wage, default_ot_multiplier, default_box_rate, notes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
      `);

      const result = stmt.run(
        code,
        data.name,
        data.phone,
        data.role,
        data.worker_type,
        data.daily_wage,
        data.default_ot_multiplier,
        data.default_box_rate,
        data.notes
      );

      return db.prepare('SELECT * FROM employees WHERE id = ?').get(result.lastInsertRowid);
    } catch (error) {
      if (error.message && error.message.includes('UNIQUE constraint failed: employees.employee_code')) {
        throw new ConflictError(`Worker code "${code}" already exists. Please choose a different code.`);
      }
      throw error;
    }
  }

  /**
   * Update an existing employee
   */
  updateEmployee(id, data) {
    const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
    if (!existing) {
      throw new NotFoundError('Worker not found');
    }

    const stmt = db.prepare(`
      UPDATE employees
      SET name = ?, phone = ?, role = ?, worker_type = ?, daily_wage = ?, default_ot_multiplier = ?, default_box_rate = ?, notes = ?, status = ?
      WHERE id = ?
    `);

    stmt.run(
      data.name !== undefined ? data.name : existing.name,
      data.phone !== undefined ? data.phone : existing.phone,
      data.role !== undefined ? data.role : existing.role,
      data.worker_type !== undefined ? data.worker_type : existing.worker_type,
      data.daily_wage !== undefined ? data.daily_wage : existing.daily_wage,
      data.default_ot_multiplier !== undefined ? data.default_ot_multiplier : existing.default_ot_multiplier,
      data.default_box_rate !== undefined ? data.default_box_rate : existing.default_box_rate,
      data.notes !== undefined ? data.notes : existing.notes,
      data.status !== undefined ? data.status : existing.status,
      id
    );

    return db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  }

  /**
   * Delete or deactivate an employee
   */
  deleteEmployee(id, hardDelete) {
    const existing = db.prepare('SELECT id FROM employees WHERE id = ?').get(id);
    if (!existing) {
      throw new NotFoundError('Worker not found');
    }

    if (hardDelete === 'true' || hardDelete === true) {
      db.prepare('DELETE FROM employees WHERE id = ?').run(id);
      return { hardDeleted: true, message: 'Worker deleted permanently' };
    } else {
      db.prepare("UPDATE employees SET status = 'INACTIVE' WHERE id = ?").run(id);
      return { hardDeleted: false, message: 'Worker deactivated successfully' };
    }
  }
}

module.exports = new EmployeeService();
