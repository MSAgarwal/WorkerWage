const { db } = require('../db');
const { sanitizeString } = require('../validators');

class SettingsService {
  /**
   * Get all public/application settings (excluding secret admin keys)
   */
  getSettings() {
    const rows = db.prepare("SELECT key, value FROM settings WHERE key NOT IN ('admin_pin', 'jwt_secret')").all();
    const settings = {
      weekly_paid_off_day: 'Tuesday',
      default_daily_wage: '500.00',
      default_box_rate: '30.00',
      default_ot_multiplier: '0.00',
      holiday_piece_bonus: '200.00',
      pieces_per_box: '500',
      piece_keywords: 'card, bangle',
      standard_hours: '8.0',
      theme_preference: 'light',
      currency_symbol: '₹',
      business_name: 'Daily Wage Attendance & Payroll',
      site_location: 'Main Work Site'
    };

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
    } else {
      settings.work_categories_list = [];
    }

    // Parse piece keywords list
    if (settings.piece_keywords) {
      settings.piece_keywords_list = settings.piece_keywords
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    } else {
      settings.piece_keywords_list = ['card', 'bangle'];
    }

    // Convert numeric settings to numbers for typed access
    if (settings.holiday_piece_bonus !== undefined) {
      settings.holiday_piece_bonus = parseFloat(settings.holiday_piece_bonus);
    }
    if (settings.default_daily_wage !== undefined) {
      settings.default_daily_wage = parseFloat(settings.default_daily_wage);
    }
    if (settings.default_box_rate !== undefined) {
      settings.default_box_rate = parseFloat(settings.default_box_rate);
    }
    if (settings.default_ot_multiplier !== undefined) {
      settings.default_ot_multiplier = parseFloat(settings.default_ot_multiplier);
    }
    if (settings.pieces_per_box !== undefined) {
      settings.pieces_per_box = parseInt(settings.pieces_per_box, 10);
    }
    if (settings.standard_hours !== undefined) {
      settings.standard_hours = parseFloat(settings.standard_hours);
    }

    return settings;
  }

  /**
   * Update application settings
   */
  updateSettings(data) {
    if (!data || typeof data !== 'object') {
      return { success: false, message: 'Invalid settings payload' };
    }

    const allowedKeys = [
      'business_name',
      'currency_symbol',
      'site_location',
      'weekly_paid_off_day',
      'default_daily_wage',
      'default_box_rate',
      'default_ot_multiplier',
      'holiday_piece_bonus',
      'pieces_per_box',
      'piece_keywords',
      'standard_hours',
      'theme_preference',
      'work_categories'
    ];

    const validDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'None'];
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
          val = sanitizeString(val, 10);
        } else if (key === 'weekly_paid_off_day') {
          const match = validDays.find(d => d.toLowerCase() === String(val).trim().toLowerCase());
          val = match || 'Tuesday';
        } else if (key === 'default_daily_wage') {
          const num = parseFloat(val);
          val = (!isNaN(num) && num >= 0 && num <= 1000000) ? num.toFixed(2) : '500.00';
        } else if (key === 'default_box_rate') {
          const num = parseFloat(val);
          val = (!isNaN(num) && num >= 0 && num <= 100000) ? num.toFixed(2) : '30.00';
        } else if (key === 'default_ot_multiplier') {
          const num = parseFloat(val);
          val = (!isNaN(num) && num >= 0 && num <= 5.0) ? num.toFixed(2) : '0.00';
        } else if (key === 'holiday_piece_bonus') {
          const num = parseFloat(val);
          val = (!isNaN(num) && num >= 0 && num <= 100000) ? num.toFixed(2) : '200.00';
        } else if (key === 'pieces_per_box') {
          const num = parseInt(val, 10);
          val = (!isNaN(num) && num >= 1 && num <= 100000) ? String(num) : '500';
        } else if (key === 'piece_keywords') {
          if (Array.isArray(val)) {
            val = val.map(k => sanitizeString(k, 30).toLowerCase()).filter(Boolean).join(', ');
          } else {
            val = sanitizeString(val, 255);
          }
        } else if (key === 'standard_hours') {
          const num = parseFloat(val);
          val = (!isNaN(num) && num >= 1.0 && num <= 24.0) ? num.toFixed(1) : '8.0';
        } else if (key === 'theme_preference') {
          const clean = String(val).trim().toLowerCase();
          val = ['light', 'dark', 'contrast'].includes(clean) ? clean : 'light';
        }

        updateStmt.run(key, String(val));
      }
    }

    return { success: true, message: 'Settings saved successfully' };
  }
}

module.exports = new SettingsService();
