const { db, withTransaction } = require('../db');
const { isPieceCategory, calculateWage } = require('../wageCalculator');
const { PIECES_PER_BOX } = require('../config/constants');
const { NotFoundError, ValidationError } = require('../errors');

class AttendanceService {
  /**
   * Get date metadata (Tuesday Weekly Off & Paid Holidays)
   */
  getDateMeta(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const dayOfWeek = d.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    const isTuesday = dayOfWeek === 2;
    const holiday = db.prepare('SELECT * FROM holidays WHERE date = ?').get(dateStr);
    const isPaidHoliday = !!(holiday && holiday.is_paid);
    const isPaidDayOff = isTuesday || isPaidHoliday;

    let dayOffReason = '';
    if (isTuesday) {
      dayOffReason = 'Tuesday Weekly Off (Paid Leave)';
    } else if (isPaidHoliday) {
      dayOffReason = `Paid Holiday: ${holiday.title}`;
    }

    return {
      date: dateStr,
      dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek],
      isTuesday,
      holiday: holiday || null,
      isPaidHoliday,
      isPaidDayOff,
      dayOffReason
    };
  }

  /**
   * Get attendance list for a specific date (merged with all active employees)
   */
  getAttendanceForDate(date) {
    const meta = this.getDateMeta(date);
    const activeWorkers = db.prepare("SELECT * FROM employees WHERE status = 'ACTIVE' ORDER BY name ASC").all();
    const existingAttendance = db.prepare('SELECT * FROM attendance WHERE date = ?').all(date);

    const attMap = {};
    for (const a of existingAttendance) {
      attMap[a.employee_id] = a;
    }

    const records = activeWorkers.map(w => {
      const rec = attMap[w.id];
      const workerType = w.worker_type || 'WORKER';
      const isManager = workerType === 'MANAGER';
      const defaultBoxRate = (w.default_box_rate !== undefined && w.default_box_rate !== null) ? w.default_box_rate : 30.0;

      if (rec) {
        const otDays = rec.overtime_days || 0;
        const isPiece = isPieceCategory(rec.work_category);
        const pieces = (rec.extra_pieces !== undefined && rec.extra_pieces !== null)
          ? rec.extra_pieces
          : (isPiece ? (rec.extra_boxes || 0) * PIECES_PER_BOX : 0);

        return {
          id: rec.id,
          employee_id: w.id,
          employee_code: w.employee_code,
          name: w.name,
          role: w.role,
          worker_type: workerType,
          phone: w.phone,
          date: rec.date,
          status: rec.status,
          is_marked: true,
          daily_wage: rec.daily_wage_snapshot,
          base_pay: rec.base_pay,
          work_category: isManager ? '' : (rec.work_category || ''),
          extra_boxes: isManager ? 0 : (rec.extra_boxes || 0),
          extra_pieces: isManager ? 0 : pieces,
          box_rate: isManager ? 0 : ((rec.box_rate !== undefined && rec.box_rate !== null) ? rec.box_rate : defaultBoxRate),
          overtime_days: otDays,
          overtime_multiplier: rec.overtime_multiplier,
          overtime_pay: rec.overtime_pay,
          is_holiday_work: isManager ? false : (rec.is_holiday_work === 1),
          bonus_allowance: rec.bonus_allowance,
          deduction: rec.deduction,
          total_pay: rec.total_pay,
          notes: rec.notes || ''
        };
      } else {
        // Unmarked entry: Check if date is Tuesday (Weekly Off) or Paid Holiday
        const workerDefaultOt = (w.default_ot_multiplier !== undefined && w.default_ot_multiplier !== null) ? w.default_ot_multiplier : 0.0;
        if (meta.isPaidDayOff) {
          // Every Tuesday or Paid Holiday defaults to Paid Leave (full day wage)!
          const defaultCalc = calculateWage(w.daily_wage, 'PAID_LEAVE', 0, workerDefaultOt, false, 0, 0, 0, defaultBoxRate, workerType);
          return {
            id: null,
            employee_id: w.id,
            employee_code: w.employee_code,
            name: w.name,
            role: w.role,
            worker_type: workerType,
            phone: w.phone,
            date: date,
            status: 'PAID_LEAVE',
            is_marked: false,
            daily_wage: w.daily_wage,
            base_pay: defaultCalc.basePay,
            work_category: '',
            extra_boxes: 0,
            extra_pieces: 0,
            box_rate: isManager ? 0 : defaultBoxRate,
            overtime_days: 0,
            overtime_multiplier: workerDefaultOt,
            overtime_pay: 0,
            is_holiday_work: false,
            bonus_allowance: 0,
            deduction: 0,
            total_pay: defaultCalc.totalPay,
            notes: meta.dayOffReason
          };
        } else {
          // Regular day
          return {
            id: null,
            employee_id: w.id,
            employee_code: w.employee_code,
            name: w.name,
            role: w.role,
            worker_type: workerType,
            phone: w.phone,
            date: date,
            status: 'NOT_MARKED',
            is_marked: false,
            daily_wage: w.daily_wage,
            base_pay: 0,
            work_category: '',
            extra_boxes: 0,
            extra_pieces: 0,
            box_rate: isManager ? 0 : defaultBoxRate,
            overtime_days: 0,
            overtime_multiplier: workerDefaultOt,
            overtime_pay: 0,
            is_holiday_work: false,
            bonus_allowance: 0,
            deduction: 0,
            total_pay: 0,
            notes: ''
          };
        }
      }
    });

    // Auto-save Tuesday / Paid Holiday defaults to DB if any workers are unmarked on this paid day off
    if (meta.isPaidDayOff && records.some(r => !r.is_marked)) {
      try {
        const unmarkedToSave = records.filter(r => !r.is_marked).map(r => ({
          employee_id: r.employee_id,
          status: 'PAID_LEAVE',
          work_category: '',
          extra_boxes: 0,
          extra_pieces: 0,
          box_rate: r.box_rate,
          overtime_days: 0,
          overtime_multiplier: r.overtime_multiplier,
          is_holiday_work: 0,
          notes: meta.dayOffReason
        }));
        if (unmarkedToSave.length > 0) {
          this.batchSaveAttendance(date, unmarkedToSave);
          // Reload from DB so ids and snapshots are fully persistent
          return this.getAttendanceForDate(date);
        }
      } catch (e) {
        // Fallback to in-memory preview if background auto-save encounters transient issue
      }
    }

    // Summary calculations for the date
    let totalPresent = 0;
    let totalHalfDay = 0;
    let totalPaidLeave = 0;
    let totalAbsent = 0;
    let totalUnmarked = 0;
    let totalOtDays = 0;
    let totalExtraBoxes = 0;
    let totalExtraPieces = 0;
    let totalHolidayWorkers = 0;
    let totalWagesToday = 0;

    for (const item of records) {
      if (item.status === 'PRESENT') totalPresent++;
      else if (item.status === 'HALF_DAY') totalHalfDay++;
      else if (item.status === 'PAID_LEAVE' || item.status === 'PAID_HOLIDAY') totalPaidLeave++;
      else if (item.status === 'ABSENT') totalAbsent++;
      else totalUnmarked++;

      if (item.is_holiday_work) totalHolidayWorkers++;
      totalOtDays += (item.overtime_days || 0);
      if (isPieceCategory(item.work_category)) {
        totalExtraPieces += (item.extra_pieces || 0);
      } else {
        totalExtraBoxes += (item.extra_boxes || 0);
      }
      totalWagesToday += (item.total_pay || 0);
    }

    return {
      date,
      meta,
      workersCount: activeWorkers.length,
      summary: {
        totalPresent,
        totalHalfDay,
        totalPaidLeave,
        totalAbsent,
        totalUnmarked,
        totalOtDays: Math.round(totalOtDays * 100) / 100,
        totalExtraBoxes: Math.round(totalExtraBoxes * 100) / 100,
        totalExtraPieces: Math.round(totalExtraPieces * 100) / 100,
        totalHolidayWorkers,
        totalWagesToday: Math.round(totalWagesToday * 100) / 100
      },
      records
    };
  }

  /**
   * Helper to normalize input, evaluate wage calculations, and prepare SQL upsert values
   */
  _prepareAttendanceData(worker, date, inputData, dateMeta) {
    const isPaidDayOff = !!dateMeta.isPaidDayOff;
    const status = inputData.status || (isPaidDayOff ? 'PAID_LEAVE' : 'PRESENT');
    const isClientHolidayWork = inputData.is_holiday_work === true || inputData.is_holiday_work === 1 || inputData.is_holiday_work === '1';
    const hasBoxes = parseFloat(inputData.extra_boxes || 0) > 0;
    const hasPieces = parseFloat(inputData.extra_pieces || 0) > 0;
    const workerType = worker.worker_type || 'WORKER';
    const isManager = workerType === 'MANAGER';
    // Server authoritatively determines holiday work:
    // Only valid for non-managers on actual paid days off (Tuesday or registered paid holiday) when worker attended (not ABSENT)
    const holidayWork = (!isManager && isPaidDayOff && status !== 'ABSENT' && (status === 'PRESENT' || status === 'HALF_DAY' || isClientHolidayWork || hasBoxes || hasPieces)) ? 1 : 0;
    const effectiveCategory = isManager ? '' : (inputData.work_category ? String(inputData.work_category).trim() : '');
    const isPiece = isPieceCategory(effectiveCategory);

    let parsedExtraPieces = 0;
    let parsedExtraBoxes = 0;

    if (isManager || isPiece) {
      parsedExtraPieces = 0;
      parsedExtraBoxes = 0;
    } else {
      parsedExtraBoxes = Math.max(0, parseFloat(inputData.extra_boxes || 0));
      parsedExtraPieces = 0;
    }

    const effectiveBoxRate = isManager ? 0.0 : ((!isNaN(parseFloat(inputData.box_rate)) && parseFloat(inputData.box_rate) >= 0)
      ? parseFloat(inputData.box_rate)
      : (worker.default_box_rate !== undefined && worker.default_box_rate !== null ? worker.default_box_rate : 30.0));

    const otDays = parseFloat(inputData.overtime_days || 0);
    const otMult = (inputData.overtime_multiplier !== undefined && inputData.overtime_multiplier !== null && !isNaN(parseFloat(inputData.overtime_multiplier)))
      ? parseFloat(inputData.overtime_multiplier)
      : (worker.default_ot_multiplier !== undefined && worker.default_ot_multiplier !== null ? worker.default_ot_multiplier : 0.0);

    const calc = calculateWage(
      worker.daily_wage,
      status,
      otDays,
      otMult,
      holidayWork,
      inputData.bonus_allowance || 0,
      inputData.deduction || 0,
      parsedExtraBoxes,
      effectiveBoxRate,
      workerType,
      effectiveCategory,
      parsedExtraPieces,
      isPaidDayOff
    );

    return {
      calc,
      holidayWork,
      effectiveCategory,
      notes: inputData.notes || ''
    };
  }

  /**
   * Save or update attendance for a single worker
   */
  saveAttendance(inputData) {
    const worker = db.prepare('SELECT * FROM employees WHERE id = ?').get(inputData.employee_id);
    if (!worker) {
      throw new NotFoundError('Worker not found');
    }

    const dateMeta = this.getDateMeta(inputData.date);
    const { calc, holidayWork, effectiveCategory, notes } = this._prepareAttendanceData(worker, inputData.date, inputData, dateMeta);

    const upsertStmt = db.prepare(`
      INSERT INTO attendance (
        employee_id, date, status, daily_wage_snapshot,
        base_pay, work_category, extra_boxes, extra_pieces, box_rate,
        overtime_days, overtime_multiplier, overtime_pay,
        is_holiday_work, bonus_allowance, deduction, total_pay, notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(employee_id, date) DO UPDATE SET
        status = excluded.status,
        daily_wage_snapshot = excluded.daily_wage_snapshot,
        base_pay = excluded.base_pay,
        work_category = excluded.work_category,
        extra_boxes = excluded.extra_boxes,
        extra_pieces = excluded.extra_pieces,
        box_rate = excluded.box_rate,
        overtime_days = excluded.overtime_days,
        overtime_multiplier = excluded.overtime_multiplier,
        overtime_pay = excluded.overtime_pay,
        is_holiday_work = excluded.is_holiday_work,
        bonus_allowance = excluded.bonus_allowance,
        deduction = excluded.deduction,
        total_pay = excluded.total_pay,
        notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP
    `);

    upsertStmt.run(
      inputData.employee_id,
      inputData.date,
      inputData.status,
      calc.dailyWage,
      calc.basePay,
      effectiveCategory,
      calc.extraBoxes,
      calc.extraPieces,
      calc.boxRate,
      calc.overtimeDays,
      calc.overtimeMultiplier,
      calc.overtimePay,
      holidayWork,
      calc.bonusAllowance,
      calc.deduction,
      calc.totalPay,
      notes
    );

    const saved = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(inputData.employee_id, inputData.date);
    return { record: saved, calculation: calc };
  }

  /**
   * Batch save attendance in an atomic database transaction
   */
  batchSaveAttendance(date, records) {
    if (!records || records.length === 0) {
      return 0;
    }

    // Validate that all employee IDs exist before beginning transaction
    const empIds = records.map(r => r.employee_id);
    const placeholders = empIds.map(() => '?').join(',');
    const existingWorkers = db.prepare(`SELECT * FROM employees WHERE id IN (${placeholders})`).all(...empIds);
    const existingMap = new Map();
    for (const w of existingWorkers) {
      existingMap.set(w.id, w);
    }

    for (const r of records) {
      if (!existingMap.has(r.employee_id)) {
        throw new ValidationError(`Worker with ID ${r.employee_id} does not exist. Batch operation rejected.`);
      }
    }

    const upsertStmt = db.prepare(`
      INSERT INTO attendance (
        employee_id, date, status, daily_wage_snapshot,
        base_pay, work_category, extra_boxes, extra_pieces, box_rate,
        overtime_days, overtime_multiplier, overtime_pay,
        is_holiday_work, bonus_allowance, deduction, total_pay, notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(employee_id, date) DO UPDATE SET
        status = excluded.status,
        daily_wage_snapshot = excluded.daily_wage_snapshot,
        base_pay = excluded.base_pay,
        work_category = excluded.work_category,
        extra_boxes = excluded.extra_boxes,
        extra_pieces = excluded.extra_pieces,
        box_rate = excluded.box_rate,
        overtime_days = excluded.overtime_days,
        overtime_multiplier = excluded.overtime_multiplier,
        overtime_pay = excluded.overtime_pay,
        is_holiday_work = excluded.is_holiday_work,
        bonus_allowance = excluded.bonus_allowance,
        deduction = excluded.deduction,
        total_pay = excluded.total_pay,
        notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP
    `);

    const dateMeta = this.getDateMeta(date);
    let count = 0;

    withTransaction(() => {
      for (const r of records) {
        const worker = existingMap.get(r.employee_id);
        const { calc, holidayWork, effectiveCategory, notes } = this._prepareAttendanceData(worker, date, r, dateMeta);

        upsertStmt.run(
          r.employee_id,
          date,
          r.status || 'PRESENT',
          calc.dailyWage,
          calc.basePay,
          effectiveCategory,
          calc.extraBoxes,
          calc.extraPieces,
          calc.boxRate,
          calc.overtimeDays,
          calc.overtimeMultiplier,
          calc.overtimePay,
          holidayWork,
          calc.bonusAllowance,
          calc.deduction,
          calc.totalPay,
          notes
        );
        count++;
      }
    });

    return count;
  }
}

module.exports = new AttendanceService();
