const { db } = require('../db');
const { isPieceCategory } = require('../wageCalculator');

class PayrollService {
  /**
   * Helper to resolve default start and end dates (current month)
   */
  _resolveDateRange(startDate, endDate) {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const formatDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return {
      start: startDate || formatDate(firstDay),
      end: endDate || formatDate(lastDay)
    };
  }

  /**
   * Generate comprehensive payroll report for date range and optional worker filter
   */
  generatePayrollReport({ startDate, endDate, employee_id }) {
    const { start, end } = this._resolveDateRange(startDate, endDate);

    let empQuery = 'SELECT * FROM employees';
    const empParams = [];
    if (employee_id) {
      empQuery += ' WHERE id = ?';
      empParams.push(employee_id);
    } else {
      empQuery += ' WHERE status = ? ORDER BY name ASC';
      empParams.push('ACTIVE');
    }

    const workers = db.prepare(empQuery).all(...empParams);

    const attendanceStmt = db.prepare(`
      SELECT * FROM attendance
      WHERE employee_id = ? AND date >= ? AND date <= ?
      ORDER BY date ASC
    `);

    const paymentsStmt = db.prepare(`
      SELECT * FROM payments
      WHERE employee_id = ? AND date >= ? AND date <= ?
      ORDER BY date ASC
    `);

    const report = [];
    let grandBasePay = 0;
    let grandOtDays = 0;
    let grandOtPay = 0;
    let grandTotalExtraBoxes = 0;
    let grandTotalExtraPieces = 0;
    let grandGrossPay = 0;
    let grandAdvances = 0;
    let grandNetPayable = 0;

    for (const w of workers) {
      const attRecords = attendanceStmt.all(w.id, start, end);
      const payRecords = paymentsStmt.all(w.id, start, end);
      const workerType = w.worker_type || 'WORKER';

      let presentDays = 0;
      let halfDays = 0;
      let paidLeaveDays = 0;
      let absentDays = 0;
      let totalOtDays = 0;
      let totalExtraBoxes = 0;
      let totalExtraPieces = 0;
      let holidayWorkDays = 0;
      const otMultiplierMap = {};
      const categoriesMap = {};
      let basePayTotal = 0;
      let otPayTotal = 0;
      let bonusTotal = 0;
      let deductionTotal = 0;
      let grossPayTotal = 0;

      for (const a of attRecords) {
        if (a.status === 'PRESENT') presentDays++;
        else if (a.status === 'HALF_DAY') halfDays++;
        else if (a.status === 'PAID_LEAVE' || a.status === 'PAID_HOLIDAY') paidLeaveDays++;
        else if (a.status === 'ABSENT') absentDays++;

        if (a.is_holiday_work) holidayWorkDays++;

        if (isPieceCategory(a.work_category)) {
          const pieces = (a.extra_pieces !== undefined && a.extra_pieces !== null && a.extra_pieces > 0)
            ? a.extra_pieces
            : ((a.extra_boxes || 0) * 500);
          totalExtraPieces += pieces;
        } else {
          if (a.extra_boxes > 0) {
            totalExtraBoxes += a.extra_boxes;
          }
        }

        if (a.work_category && a.work_category.trim()) {
          const cat = a.work_category.trim();
          categoriesMap[cat] = (categoriesMap[cat] || 0) + 1;
        }

        const otDays = a.overtime_days || 0;
        if (otDays > 0) {
          totalOtDays += otDays;
          const multKey = Number(a.overtime_multiplier !== undefined && a.overtime_multiplier !== null ? a.overtime_multiplier : 0.0).toFixed(2);
          otMultiplierMap[multKey] = (otMultiplierMap[multKey] || 0) + otDays;
        }

        basePayTotal += a.base_pay;
        otPayTotal += a.overtime_pay;
        bonusTotal += a.bonus_allowance;
        deductionTotal += a.deduction;
        grossPayTotal += a.total_pay;
      }

      // Format OT summary string, e.g. "1.5x (2.0d), 2x (1.0d)"
      const otSummaryParts = Object.keys(otMultiplierMap).sort((a,b) => parseFloat(a) - parseFloat(b)).map(m => {
        const cleanM = parseFloat(m).toString();
        return `${cleanM}x (${otMultiplierMap[m].toFixed(2)}d)`;
      });
      const otSummaryText = otSummaryParts.join(', ');

      // Format Work Categories summary string, e.g. "Sp 100 (5d), Pd 80 (3d)"
      const categoriesSummary = Object.keys(categoriesMap).sort().map(c => `${c} (${categoriesMap[c]}d)`).join(', ');

      let totalAdvances = 0;
      let totalSettlements = 0;
      for (const p of payRecords) {
        if (p.type === 'ADVANCE') {
          totalAdvances += p.amount;
        } else if (p.type === 'PAYOUT' || p.type === 'SETTLEMENT') {
          totalSettlements += p.amount;
        }
      }

      const netPayable = Math.max(0, grossPayTotal - totalAdvances - totalSettlements);

      grandBasePay += basePayTotal;
      grandOtDays += totalOtDays;
      grandTotalExtraBoxes += totalExtraBoxes;
      grandTotalExtraPieces += totalExtraPieces;
      grandOtPay += otPayTotal;
      grandGrossPay += grossPayTotal;
      grandAdvances += totalAdvances;
      grandNetPayable += netPayable;

      report.push({
        employee_id: w.id,
        employee_code: w.employee_code,
        name: w.name,
        role: w.role,
        worker_type: workerType,
        phone: w.phone,
        daily_wage: w.daily_wage,
        presentDays,
        halfDays,
        paidLeaveDays,
        absentDays,
        holidayWorkDays,
        effectiveDays: Math.round((presentDays + (halfDays * 0.5) + paidLeaveDays) * 100) / 100,
        totalOtDays: Math.round(totalOtDays * 100) / 100,
        totalExtraBoxes: Math.round(totalExtraBoxes * 100) / 100,
        totalExtraPieces: Math.round(totalExtraPieces * 100) / 100,
        categoriesMap,
        categoriesSummary,
        otMultiplierMap,
        otSummaryText,
        basePayTotal: Math.round(basePayTotal * 100) / 100,
        otPayTotal: Math.round(otPayTotal * 100) / 100,
        bonusTotal: Math.round(bonusTotal * 100) / 100,
        deductionTotal: Math.round(deductionTotal * 100) / 100,
        grossPayTotal: Math.round(grossPayTotal * 100) / 100,
        totalAdvances: Math.round(totalAdvances * 100) / 100,
        totalSettlements: Math.round(totalSettlements * 100) / 100,
        netPayable: Math.round(netPayable * 100) / 100,
        attendanceRecords: attRecords,
        paymentRecords: payRecords
      });
    }

    return {
      startDate: start,
      endDate: end,
      grandTotals: {
        totalWorkers: workers.length,
        grandBasePay: Math.round(grandBasePay * 100) / 100,
        grandOtDays: Math.round(grandOtDays * 100) / 100,
        grandTotalExtraBoxes: Math.round(grandTotalExtraBoxes * 100) / 100,
        grandTotalExtraPieces: Math.round(grandTotalExtraPieces * 100) / 100,
        grandOtPay: Math.round(grandOtPay * 100) / 100,
        grandGrossPay: Math.round(grandGrossPay * 100) / 100,
        grandAdvances: Math.round(grandAdvances * 100) / 100,
        grandNetPayable: Math.round(grandNetPayable * 100) / 100
      },
      workers: report
    };
  }

  /**
   * Generate CSV content for payroll export
   */
  generateCsvReport({ startDate, endDate }) {
    const { start, end } = this._resolveDateRange(startDate, endDate);
    const workers = db.prepare("SELECT * FROM employees WHERE status = 'ACTIVE' ORDER BY name ASC").all();
    const rows = [];

    rows.push([
      'Code', 'Name', 'Worker Type', 'Role', 'Daily Wage',
      'Present (Days)', 'Half Days', 'Paid Leave/Tuesdays', 'Effective Paid Days',
      'Work Categories', 'Extra Boxes Packed', 'Extra Pieces (Cards/Bangles)',
      'Base Wage', 'OT Wage', 'Gross Earnings', 'Advances Paid', 'Net Balance Payable'
    ].join(','));

    for (const w of workers) {
      const attRecords = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date >= ? AND date <= ?').all(w.id, start, end);
      const payRecords = db.prepare('SELECT * FROM payments WHERE employee_id = ? AND date >= ? AND date <= ?').all(w.id, start, end);
      const workerType = w.worker_type || 'WORKER';

      let present = 0, half = 0, paidLeave = 0, absent = 0, totalOt = 0, totalBoxes = 0, totalPieces = 0, basePay = 0, otPay = 0, gross = 0;
      const catMap = {};

      for (const a of attRecords) {
        if (a.status === 'PRESENT') present++;
        else if (a.status === 'HALF_DAY') half++;
        else if (a.status === 'PAID_LEAVE' || a.status === 'PAID_HOLIDAY') paidLeave++;
        else if (a.status === 'ABSENT') absent++;

        if (isPieceCategory(a.work_category)) {
          const pieces = (a.extra_pieces !== undefined && a.extra_pieces !== null && a.extra_pieces > 0)
            ? a.extra_pieces
            : ((a.extra_boxes || 0) * 500);
          totalPieces += pieces;
        } else {
          if (a.extra_boxes > 0) totalBoxes += a.extra_boxes;
        }

        if (a.work_category && a.work_category.trim()) {
          const cat = a.work_category.trim();
          catMap[cat] = (catMap[cat] || 0) + 1;
        }

        const otDays = a.overtime_days || 0;
        if (otDays > 0) totalOt += otDays;

        basePay += a.base_pay;
        otPay += a.overtime_pay;
        gross += a.total_pay;
      }

      const catDesc = Object.keys(catMap).map(c => `${c} (${catMap[c]}d)`).join('; ');

      let advances = 0;
      for (const p of payRecords) {
        if (p.type === 'ADVANCE') advances += p.amount;
      }

      const effectivePaidDays = present + (half * 0.5) + paidLeave;
      const net = Math.max(0, gross - advances);

      rows.push([
        `"${w.employee_code}"`,
        `"${w.name}"`,
        `"${workerType === 'MANAGER' ? 'Manager' : 'Packaging Worker'}"`,
        `"${w.role || ''}"`,
        w.daily_wage,
        present,
        half,
        paidLeave,
        effectivePaidDays.toFixed(1),
        `"${catDesc || '-'}"`,
        totalBoxes,
        totalPieces,
        basePay.toFixed(2),
        otPay.toFixed(2),
        gross.toFixed(2),
        advances.toFixed(2),
        net.toFixed(2)
      ].join(','));
    }

    const csvContent = rows.join('\r\n');
    const filename = `attendance_payroll_${start}_to_${end}.csv`;

    return {
      filename,
      content: csvContent
    };
  }
}

module.exports = new PayrollService();
