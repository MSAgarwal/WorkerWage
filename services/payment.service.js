const { db } = require('../db');
const { NotFoundError, ValidationError } = require('../errors');

class PaymentService {
  /**
   * Get payments with optional employee and date range filtering.
   * Soft-deleted payments (deleted_at IS NOT NULL) are excluded from all results.
   */
  getPayments({ employee_id, startDate, endDate }) {
    let query = `
      SELECT p.*, e.name as employee_name, e.employee_code, e.role
      FROM payments p
      JOIN employees e ON p.employee_id = e.id
      WHERE p.deleted_at IS NULL
    `;
    const params = [];

    if (employee_id) {
      query += ' AND p.employee_id = ?';
      params.push(employee_id);
    }
    if (startDate) {
      query += ' AND p.date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND p.date <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY p.date DESC, p.id DESC';
    return db.prepare(query).all(...params);
  }

  /**
   * Create a new payment record (Advance, Payout, Settlement, or Bonus).
   * Verifies employee exists and is ACTIVE before recording payment.
   */
  createPayment({ employee_id, date, amount, type, payment_method, notes }) {
    const worker = db.prepare("SELECT id, name, status FROM employees WHERE id = ?").get(employee_id);
    if (!worker) {
      throw new NotFoundError(`No worker found with ID ${employee_id}. Please check the worker list and try again.`);
    }
    if (worker.status !== 'ACTIVE') {
      throw new ValidationError(`Worker "${worker.name}" is inactive and cannot receive payments. Reactivate the worker first.`);
    }

    const stmt = db.prepare(`
      INSERT INTO payments (employee_id, date, amount, type, payment_method, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      employee_id,
      date,
      amount,
      type,
      payment_method,
      notes || ''
    );

    return db.prepare('SELECT * FROM payments WHERE id = ?').get(result.lastInsertRowid);
  }

  /**
   * Soft-delete a payment record by ID.
   * The record is flagged with deleted_at timestamp rather than erased,
   * preserving the financial audit trail. Only ADMIN role can delete.
   */
  deletePayment(id) {
    const existing = db.prepare('SELECT id, deleted_at, employee_id, amount, type, date FROM payments WHERE id = ?').get(id);
    if (!existing) {
      throw new NotFoundError(`Payment record #${id} does not exist.`);
    }
    if (existing.deleted_at) {
      throw new ValidationError(`Payment record #${id} has already been deleted. It no longer appears in any reports.`);
    }

    db.prepare('UPDATE payments SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    return true;
  }
}

module.exports = new PaymentService();
