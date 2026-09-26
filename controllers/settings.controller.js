const settingsService = require('../services/settings.service');

class SettingsController {
  /**
   * GET /api/settings
   * Retrieve application settings
   */
  getSettings(req, res, next) {
    try {
      const settings = settingsService.getSettings();
      res.json({ success: true, settings });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/settings
   * Update application settings
   */
  updateSettings(req, res, next) {
    try {
      const result = settingsService.updateSettings(req.body);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new SettingsController();
