const { db } = require('../db');
const { sanitizeString } = require('../validators');

class SettingsService {
  /**
   * Get all public/application settings (excluding secret admin keys)
   */
  getSettings() {
    const rows = db.prepare("SELECT key, value FROM settings WHERE key NOT IN ('admin_pin', 'jwt_secret')").all();
    const settings = {};
    for (const r of rows) {
      settings[r.key] = r.value;
    }
    // Parse work_categories JSON array if present
    if (settings.work_categories) {
      try {
        settings.work_categories_list = JSON.parse(settings.work_categories);
      } catch (e) {
        settings.work_categories_list = [];
      }
    }
    return settings;
  }

  /**
   * Update application settings
   */
  updateSettings(data) {
    const allowedKeys = ['business_name', 'currency_symbol', 'default_ot_multiplier', 'default_box_rate', 'work_categories', 'site_location'];
    const updateStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');

    for (const key of allowedKeys) {
      if (data[key] !== undefined) {
        let val = data[key];
        if (key === 'work_categories') {
          if (Array.isArray(val)) {
            val = JSON.stringify(val.map(c => sanitizeString(c, 50)).filter(c => c.length > 0));
          } else if (typeof val === 'string') {
            try {
              const parsed = JSON.parse(val);
              if (Array.isArray(parsed)) {
                val = JSON.stringify(parsed.map(c => sanitizeString(c, 50)).filter(c => c.length > 0));
              }
            } catch (e) {}
          }
        } else if (key === 'business_name' || key === 'site_location') {
          val = sanitizeString(val, 100);
        } else if (key === 'currency_symbol') {
          val = sanitizeString(val, 5);
        } else if (key === 'default_ot_multiplier') {
          const num = parseFloat(val);
          val = (!isNaN(num) && num >= 0 && num <= 5.0) ? num.toFixed(2) : '0.00';
        } else if (key === 'default_box_rate') {
          const num = parseFloat(val);
          val = (!isNaN(num) && num >= 0) ? num.toFixed(2) : '30.00';
        }
        updateStmt.run(key, String(val));
      }
    }

    return { success: true, message: 'Settings saved successfully' };
  }
}

module.exports = new SettingsService();
