const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { NotFoundError, ValidationError, UnauthorizedError } = require('../errors');
const payrollService = require('./payroll.service');

class WorkerService {
  /**
   * Get read-only monthly passbook data for a specific worker
   * @param {number} workerId
   * @param {string} monthStr YYYY-MM
   */
  getWorkerPassbook(workerId, monthStr) {
    const worker = db.prepare('SELECT id, employee_code, name, role, worker_type, phone, daily_wage, default_box_rate, status, notes FROM employees WHERE id = ?').get(workerId);
    if (!worker) {
      throw new NotFoundError('Worker not found');
    }

    // Default to current month YYYY-MM if omitted or invalid
    let year, month;
    if (monthStr && /^\d{4}-\d{2}$/.test(monthStr)) {
      const parts = monthStr.split('-');
      year = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10);
    } else {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth() + 1;
    }

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // Use pure payroll service to get 100% mathematically consistent summary
    const payrollReport = payrollService.generatePayrollReport({
      startDate,
      endDate,
      employee_id: worker.id
    });

    const workerSummary = payrollReport.workers && payrollReport.workers[0] ? payrollReport.workers[0] : null;

    // Detailed day-by-day attendance for the month (descending order for display)
    const attendanceRecords = db.prepare(`
      SELECT date, status, standard_hours, daily_wage_snapshot, base_pay,
             work_category, extra_boxes, extra_pieces, box_rate,
             overtime_days, overtime_multiplier, overtime_pay,
             is_holiday_work, bonus_allowance, deduction, total_pay, notes
      FROM attendance
      WHERE employee_id = ? AND date >= ? AND date <= ?
      ORDER BY date DESC
    `).all(worker.id, startDate, endDate);

    // Payments / Advances taken in this month
    const paymentRecords = db.prepare(`
      SELECT date, amount, type, payment_method, notes
      FROM payments
      WHERE employee_id = ? AND date >= ? AND date <= ? AND deleted_at IS NULL
      ORDER BY date DESC
    `).all(worker.id, startDate, endDate);

    return {
      month: `${year}-${String(month).padStart(2, '0')}`,
      startDate,
      endDate,
      worker: {
        id: worker.id,
        employee_code: worker.employee_code,
        name: worker.name,
        role: worker.role,
        worker_type: worker.worker_type,
        daily_wage: worker.daily_wage,
        phone: worker.phone,
        status: worker.status
      },
      summary: workerSummary ? {
        presentDays: workerSummary.presentDays,
        halfDays: workerSummary.halfDays,
        paidLeaveDays: workerSummary.paidLeaveDays,
        absentDays: workerSummary.absentDays,
        effectiveDays: workerSummary.effectiveDays,
        totalExtraBoxes: workerSummary.totalExtraBoxes,
        totalExtraPieces: workerSummary.totalExtraPieces,
        categoriesSummary: workerSummary.categoriesSummary,
        basePayTotal: workerSummary.basePayTotal,
        otPayTotal: workerSummary.otPayTotal,
        bonusTotal: workerSummary.bonusTotal,
        deductionTotal: workerSummary.deductionTotal,
        grossPayTotal: workerSummary.grossPayTotal,
        totalAdvances: workerSummary.totalAdvances,
        totalSettlements: workerSummary.totalSettlements,
        netPayable: workerSummary.netPayable
      } : null,
      attendance: attendanceRecords,
      payments: paymentRecords
    };
  }

  /**
   * Change worker passbook secret key
   */
  changeWorkerPin(workerId, currentPin, newPin) {
    if (!currentPin || String(currentPin).trim() === '') {
      throw new ValidationError('Current secret key is required');
    }
    const cleanNew = String(newPin || '').trim();
    if (!cleanNew || cleanNew.length < 5) {
      throw new ValidationError('New secret key must be at least 5 digits/characters long');
    }

    const worker = db.prepare('SELECT id, pin_hash FROM employees WHERE id = ?').get(workerId);
    if (!worker) {
      throw new NotFoundError('Worker not found');
    }

    const cleanCurrent = String(currentPin).trim();
    let isCurrentValid = false;
    if (worker.pin_hash) {
      isCurrentValid = bcrypt.compareSync(cleanCurrent, worker.pin_hash);
    } else {
      isCurrentValid = (cleanCurrent === '12345');
    }

    if (!isCurrentValid) {
      throw new UnauthorizedError('Current secret key is incorrect');
    }

    const hashed = bcrypt.hashSync(cleanNew, 10);
    db.prepare('UPDATE employees SET pin_hash = ? WHERE id = ?').run(hashed, workerId);
    return { success: true, message: 'Passbook secret key updated successfully' };
  }
}

module.exports = new WorkerService();
