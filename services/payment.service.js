const { db } = require('../db');
const { NotFoundError } = require('../errors');

class PaymentService {
  /**
   * Get payments with optional employee and date range filtering
   */
  getPayments({ employee_id, startDate, endDate }) {
    let query = `
      SELECT p.*, e.name as employee_name, e.employee_code, e.role
      FROM payments p
      JOIN employees e ON p.employee_id = e.id
      WHERE 1=1
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
   * Create a new payment record (Advance or Payout)
   */
  createPayment({ employee_id, date, amount, type, payment_method, notes }) {
    const worker = db.prepare('SELECT id FROM employees WHERE id = ?').get(employee_id);
    if (!worker) {
      throw new NotFoundError('Worker not found');
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
      notes
    );

    return db.prepare('SELECT * FROM payments WHERE id = ?').get(result.lastInsertRowid);
  }

  /**
   * Delete a payment record by ID
   */
  deletePayment(id) {
    const existing = db.prepare('SELECT id FROM payments WHERE id = ?').get(id);
    if (!existing) {
      throw new NotFoundError('Payment not found');
    }

    db.prepare('DELETE FROM payments WHERE id = ?').run(id);
    return true;
  }
}

module.exports = new PaymentService();
