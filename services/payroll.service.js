const { db } = require('../db');
const { isPieceCategory } = require('../wageCalculator');
const { PIECES_PER_BOX } = require('../config/constants');

class PayrollService {
  /**
   * Helper to resolve default start and end dates (current month in local time)
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
   * Helper to retrieve dynamic settings
   */
  _getDynamicSettings() {
    try {
      const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('pieces_per_box', 'piece_keywords')").all();
      const map = {};
      for (const r of rows) map[r.key] = r.value;
      return {
        piecesPerBox: (!isNaN(parseInt(map.pieces_per_box, 10)) && parseInt(map.pieces_per_box, 10) > 0) ? parseInt(map.pieces_per_box, 10) : PIECES_PER_BOX,
        pieceKeywords: (map.piece_keywords || 'card, bangle').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      };
    } catch (e) {
      return { piecesPerBox: PIECES_PER_BOX, pieceKeywords: ['card', 'bangle'] };
    }
  }

  /**
   * Pure worker payroll calculation engine.
   * Shared by both JSON report generation and CSV export to ensure 100% financial consistency.
   */
  calculateWorkerPayroll(worker, attRecords, payRecords) {
    const workerType = worker.worker_type || 'WORKER';
    const dyn = this._getDynamicSettings();

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

    const isManager = workerType === 'MANAGER';

    for (const a of attRecords) {
      if (a.status === 'PRESENT') presentDays++;
      else if (a.status === 'HALF_DAY') halfDays++;
      else if (a.status === 'PAID_LEAVE' || a.status === 'PAID_HOLIDAY') paidLeaveDays++;
      else if (a.status === 'ABSENT') absentDays++;

      if (!isManager && a.is_holiday_work) holidayWorkDays++;

      if (!isManager) {
        if (isPieceCategory(a.work_category, dyn.pieceKeywords)) {
          const pieces = (a.extra_pieces !== undefined && a.extra_pieces !== null && a.extra_pieces > 0)
            ? a.extra_pieces
            : ((a.extra_boxes || 0) * dyn.piecesPerBox);
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
    const categoriesSummary = isManager 
      ? '-' 
      : (Object.keys(categoriesMap).sort().map(c => `${c} (${categoriesMap[c]}d)`).join(', ') || '-');

    let totalAdvances = 0;
    let totalSettlements = 0;
    let totalBonuses = 0;
    for (const p of payRecords) {
      if (p.type === 'ADVANCE') {
        totalAdvances += p.amount;
      } else if (p.type === 'PAYOUT' || p.type === 'SETTLEMENT') {
        totalSettlements += p.amount;
      } else if (p.type === 'BONUS') {
        bonusTotal += p.amount;
        grossPayTotal += p.amount;
        totalBonuses += p.amount;
      }
    }

    // Net payable formula: Gross Earnings minus Advances, previous Settlements, and paid Bonuses
    const netPayable = Math.max(0, grossPayTotal - totalAdvances - totalSettlements - totalBonuses);

    return {
      employee_id: worker.id,
      employee_code: worker.employee_code,
      name: worker.name,
      role: worker.role,
      worker_type: workerType,
      phone: worker.phone,
      daily_wage: worker.daily_wage,
      presentDays,
      halfDays,
      paidLeaveDays,
      absentDays,
      holidayWorkDays: isManager ? 0 : holidayWorkDays,
      effectiveDays: Math.round((presentDays + (halfDays * 0.5) + paidLeaveDays) * 100) / 100,
      totalOtDays: Math.round(totalOtDays * 100) / 100,
      totalExtraBoxes: isManager ? 0 : Math.round(totalExtraBoxes * 100) / 100,
      totalExtraPieces: isManager ? 0 : Math.round(totalExtraPieces * 100) / 100,
      categoriesMap: isManager ? {} : categoriesMap,
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
      totalBonuses: Math.round(totalBonuses * 100) / 100,
      netPayable: Math.round(netPayable * 100) / 100,
      attendanceRecords: attRecords,
      paymentRecords: payRecords
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

    // Batch query optimization: Fetch all attendance & payments in a single query
    // and group by worker ID in memory, eliminating the O(2N) database roundtrips.
    const attMap = new Map();
    const payMap = new Map();

    if (employee_id) {
      const attRows = db.prepare(`
        SELECT * FROM attendance
        WHERE employee_id = ? AND date >= ? AND date <= ?
        ORDER BY date ASC
      `).all(employee_id, start, end);
      attMap.set(Number(employee_id), attRows);

      const payRows = db.prepare(`
        SELECT * FROM payments
        WHERE employee_id = ? AND date >= ? AND date <= ? AND deleted_at IS NULL
        ORDER BY date ASC
      `).all(employee_id, start, end);
      payMap.set(Number(employee_id), payRows);
    } else {
      const allAttRows = db.prepare(`
        SELECT * FROM attendance
        WHERE date >= ? AND date <= ?
        ORDER BY date ASC
      `).all(start, end);
      for (const r of allAttRows) {
        if (!attMap.has(r.employee_id)) attMap.set(r.employee_id, []);
        attMap.get(r.employee_id).push(r);
      }

      const allPayRows = db.prepare(`
        SELECT * FROM payments
        WHERE date >= ? AND date <= ? AND deleted_at IS NULL
        ORDER BY date ASC
      `).all(start, end);
      for (const r of allPayRows) {
        if (!payMap.has(r.employee_id)) payMap.set(r.employee_id, []);
        payMap.get(r.employee_id).push(r);
      }
    }

    const report = [];
    let grandBasePay = 0;
    let grandOtDays = 0;
    let grandOtPay = 0;
    let grandTotalExtraBoxes = 0;
    let grandTotalExtraPieces = 0;
    let grandBonus = 0;
    let grandGrossPay = 0;
    let grandAdvances = 0;
    let grandSettlements = 0;
    let grandNetPayable = 0;

    for (const w of workers) {
      const attRecords = attMap.get(w.id) || [];
      const payRecords = payMap.get(w.id) || [];

      const workerSummary = this.calculateWorkerPayroll(w, attRecords, payRecords);

      grandBasePay += workerSummary.basePayTotal;
      grandOtDays += workerSummary.totalOtDays;
      grandTotalExtraBoxes += workerSummary.totalExtraBoxes;
      grandTotalExtraPieces += workerSummary.totalExtraPieces;
      grandOtPay += workerSummary.otPayTotal;
      grandBonus += workerSummary.bonusTotal;
      grandGrossPay += workerSummary.grossPayTotal;
      grandAdvances += workerSummary.totalAdvances;
      grandSettlements += workerSummary.totalSettlements;
      grandNetPayable += workerSummary.netPayable;

      report.push(workerSummary);
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
        grandBonus: Math.round(grandBonus * 100) / 100,
        grandGrossPay: Math.round(grandGrossPay * 100) / 100,
        grandAdvances: Math.round(grandAdvances * 100) / 100,
        grandSettlements: Math.round(grandSettlements * 100) / 100,
        grandNetPayable: Math.round(grandNetPayable * 100) / 100
      },
      workers: report
    };
  }

  /**
   * Helper: Escape CSV field to prevent formula injection (=, +, -, @) and format quotes
   */
  _escapeCsvField(val) {
    if (val === undefined || val === null) return '""';
    let str = String(val);
    // Prevent CSV formula injection in spreadsheet viewers
    if (/^[=+\-@\t\r]/.test(str)) {
      str = "'" + str;
    }
    return `"${str.replace(/"/g, '""')}"`;
  }

  /**
   * Generate CSV content for payroll export using the exact same calculation engine
   */
  generateCsvReport({ startDate, endDate }) {
    const reportData = this.generatePayrollReport({ startDate, endDate });
    const rows = [];

    // Header Row
    rows.push([
      'Code', 'Name', 'Worker Type', 'Role', 'Daily Wage',
      'Present (Days)', 'Half Days', 'Paid Leave/Tuesdays', 'Effective Paid Days',
      'Work Categories', 'Extra Boxes Packed', 'Extra Pieces (Cards/Bangles)',
      'Base Wage', 'OT Wage', 'Bonus / Rewards', 'Gross Earnings', 'Advances Paid', 'Settlements Paid', 'Net Balance Payable'
    ].join(','));

    for (const w of reportData.workers) {
      rows.push([
        this._escapeCsvField(w.employee_code),
        this._escapeCsvField(w.name),
        this._escapeCsvField(w.worker_type === 'MANAGER' ? 'Manager' : 'Packaging Worker'),
        this._escapeCsvField(w.role || ''),
        w.daily_wage.toFixed(2),
        w.presentDays,
        w.halfDays,
        w.paidLeaveDays,
        w.effectiveDays.toFixed(1),
        this._escapeCsvField(w.categoriesSummary || '-'),
        w.totalExtraBoxes,
        w.totalExtraPieces,
        w.basePayTotal.toFixed(2),
        w.otPayTotal.toFixed(2),
        w.bonusTotal.toFixed(2),
        w.grossPayTotal.toFixed(2),
        w.totalAdvances.toFixed(2),
        w.totalSettlements.toFixed(2),
        w.netPayable.toFixed(2)
      ].join(','));
    }

    const csvContent = rows.join('\r\n');
    const filename = `attendance_payroll_${reportData.startDate}_to_${reportData.endDate}.csv`;

    return {
      filename,
      content: csvContent
    };
  }
}

module.exports = new PayrollService();
