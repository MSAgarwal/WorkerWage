const attendanceService = require('../services/attendance.service');
const { isValidDate, validateAttendanceInput, validateBatchAttendanceInput } = require('../validators');

function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

class AttendanceController {
  /**
   * GET /api/attendance
   * Get attendance records and daily summary for a date
   */
  getAttendance(req, res, next) {
    try {
      const date = req.query.date || getLocalDateString();
      if (!isValidDate(date)) {
        return res.status(400).json({ error: 'Invalid date parameter. Date must be in YYYY-MM-DD format.' });
      }

      const result = attendanceService.getAttendanceForDate(date);
      res.json({
        success: true,
        ...result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/attendance
   * Save or update attendance for a single worker
   */
  saveAttendance(req, res, next) {
    try {
      const validation = validateAttendanceInput(req.body);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          error: validation.errors.join('; '),
          details: validation.errors
        });
      }

      const { record, calculation } = attendanceService.saveAttendance(validation.sanitized);
      res.json({
        success: true,
        message: 'Attendance recorded',
        record,
        calculation
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/attendance/batch
   * Batch save attendance in an atomic database transaction
   */
  batchSaveAttendance(req, res, next) {
    try {
      const validation = validateBatchAttendanceInput(req.body);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          error: validation.errors.join('; '),
          details: validation.errors
        });
      }

      const count = attendanceService.batchSaveAttendance(
        validation.sanitized.date,
        validation.sanitized.records
      );

      res.json({
        success: true,
        message: `Successfully updated attendance for ${count} workers`
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AttendanceController();
