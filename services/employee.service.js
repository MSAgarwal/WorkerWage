const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { ConflictError, NotFoundError, ValidationError } = require('../errors');

class EmployeeService {
  /**
   * Helper to strip internal password hashes from returned employee objects
   */
  _sanitizeEmployee(emp) {
    if (!emp) return emp;
    const sanitized = { ...emp };
    sanitized.has_pin = !!sanitized.pin_hash;
    delete sanitized.pin_hash;
    return sanitized;
  }

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
    const rows = db.prepare(query).all(...params);
    return rows.map(r => this._sanitizeEmployee(r));
  }

  /**
   * Get a single employee by ID
   */
  getEmployeeById(id) {
    const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
    return this._sanitizeEmployee(emp);
  }

  /**
   * Create a new employee.
   * Employee code generation and INSERT are wrapped in a transaction to
   * prevent race conditions under concurrent requests (BUG 4 fix).
   */
  createEmployee(data) {
    const { withTransaction } = require('../db');

    const pinToHash = data.pin && String(data.pin).trim() ? String(data.pin).trim() : '12345';
    const pinHash = bcrypt.hashSync(pinToHash, 10);

    let newEmpId;
    try {
      withTransaction(() => {
        let code = data.employee_code;
        if (!code || String(code).trim() === '') {
          // Generate code inside the transaction — atomic with the insert
          const lastRow = db.prepare('SELECT id FROM employees ORDER BY id DESC LIMIT 1').get();
          let candidateId = lastRow ? lastRow.id + 1 : 1;
          code = 'EMP' + String(candidateId).padStart(3, '0');
          while (db.prepare('SELECT id FROM employees WHERE employee_code = ?').get(code)) {
            candidateId++;
            code = 'EMP' + String(candidateId).padStart(3, '0');
          }
        } else {
          code = String(code).trim();
        }

        const existingCode = db.prepare('SELECT id FROM employees WHERE employee_code = ?').get(code);
        if (existingCode) {
          throw new ConflictError(`Worker code "${code}" already exists. Please choose a different code.`);
        }

        const stmt = db.prepare(`
          INSERT INTO employees (employee_code, name, phone, role, worker_type, daily_wage, default_ot_multiplier, default_box_rate, pin_hash, notes, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
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
          pinHash,
          data.notes
        );
        newEmpId = result.lastInsertRowid;
      });
    } catch (error) {
      if (error.message && error.message.includes('UNIQUE constraint failed: employees.employee_code')) {
        throw new ConflictError(`Worker code already exists. Please choose a different code.`);
      }
      throw error;
    }

    return this._sanitizeEmployee(db.prepare('SELECT * FROM employees WHERE id = ?').get(newEmpId));
  }

  /**
   * Update an existing employee
   */
  updateEmployee(id, data) {
    const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
    if (!existing) {
      throw new NotFoundError('Worker not found');
    }

    let code = existing.employee_code;
    if (data.employee_code !== undefined && String(data.employee_code).trim() !== '') {
      code = String(data.employee_code).trim();
      const duplicateCode = db.prepare('SELECT id FROM employees WHERE employee_code = ? AND id != ?').get(code, id);
      if (duplicateCode) {
        throw new ConflictError(`Worker code "${code}" already exists. Please choose a different code.`);
      }
    }

    const stmt = db.prepare(`
      UPDATE employees
      SET employee_code = ?, name = ?, phone = ?, role = ?, worker_type = ?, daily_wage = ?, default_ot_multiplier = ?, default_box_rate = ?, notes = ?, status = ?
      WHERE id = ?
    `);

    stmt.run(
      code,
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

    // If new PIN is provided, hash and update
    if (data.pin && String(data.pin).trim()) {
      const pinHash = bcrypt.hashSync(String(data.pin).trim(), 10);
      db.prepare('UPDATE employees SET pin_hash = ? WHERE id = ?').run(pinHash, id);
    }

    return this._sanitizeEmployee(db.prepare('SELECT * FROM employees WHERE id = ?').get(id));
  }

  /**
   * Delete or deactivate an employee.
   * Hard delete is blocked if the worker has any attendance or payment history
   * to prevent irreversible financial data loss.
   */
  deleteEmployee(id, hardDelete, force = false) {
    const existing = db.prepare('SELECT id, name FROM employees WHERE id = ?').get(id);
    if (!existing) {
      throw new NotFoundError('Worker not found');
    }

    const isForce = force === 'true' || force === true;
    if (hardDelete === 'true' || hardDelete === true) {
      // Safety check: refuse hard delete if financial records exist unless force is specified
      const attCount = db.prepare('SELECT COUNT(*) as cnt FROM attendance WHERE employee_id = ?').get(id);
      const payCount = db.prepare('SELECT COUNT(*) as cnt FROM payments WHERE employee_id = ?').get(id);

      if ((attCount.cnt > 0 || payCount.cnt > 0) && !isForce) {
        throw new ValidationError(
          `Cannot permanently delete worker "${existing.name}" — they have ${attCount.cnt} attendance record(s) and ${payCount.cnt} payment record(s). ` +
          `Deactivate the worker instead to preserve the financial history. ` +
          `To force permanent deletion of all data, specify force=true.`
        );
      }

      db.prepare('DELETE FROM employees WHERE id = ?').run(id);
      return { hardDeleted: true, message: `Worker "${existing.name}" deleted permanently` };
    } else {
      db.prepare("UPDATE employees SET status = 'INACTIVE' WHERE id = ?").run(id);
      return { hardDeleted: false, message: `Worker "${existing.name}" deactivated successfully. All history is preserved.` };
    }
  }
}

module.exports = new EmployeeService();
