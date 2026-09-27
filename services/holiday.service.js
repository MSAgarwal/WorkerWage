const { db } = require('../db');
const { NotFoundError } = require('../errors');

class HolidayService {
  /**
   * Get all registered holidays sorted by date ascending
   */
  getHolidays() {
    return db.prepare('SELECT * FROM holidays ORDER BY date ASC').all();
  }

  /**
   * Insert or update a holiday
   */
  saveHoliday({ date, title, is_paid }) {
    const stmt = db.prepare(`
      INSERT INTO holidays (date, title, is_paid)
      VALUES (?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET title = excluded.title, is_paid = excluded.is_paid
    `);

    stmt.run(date, title, is_paid);
    return db.prepare('SELECT * FROM holidays WHERE date = ?').get(date);
  }

  /**
   * Delete a holiday by ID (throws NotFoundError if ID does not exist)
   */
  deleteHoliday(id) {
    const result = db.prepare('DELETE FROM holidays WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new NotFoundError('Holiday not found');
    }
    return true;
  }
}

module.exports = new HolidayService();
