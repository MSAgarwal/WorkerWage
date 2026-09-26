const holidayService = require('../services/holiday.service');
const { validateHolidayInput } = require('../validators');

class HolidayController {
  /**
   * GET /api/holidays
   * List all configured holidays
   */
  getHolidays(req, res, next) {
    try {
      const holidays = holidayService.getHolidays();
      res.json({ success: true, holidays });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/holidays
   * Add or update holiday
   */
  createHoliday(req, res, next) {
    try {
      const validation = validateHolidayInput(req.body);
      if (!validation.isValid) {
        return res.status(400).json({ error: 'Validation failed', details: validation.errors });
      }

      const holiday = holidayService.saveHoliday(validation.sanitized);
      res.json({
        success: true,
        message: 'Holiday saved successfully',
        holiday
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/holidays/:id
   * Remove a holiday by ID
   */
  deleteHoliday(req, res, next) {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid holiday ID' });
      }

      holidayService.deleteHoliday(id);
      res.json({ success: true, message: 'Holiday removed successfully' });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new HolidayController();
