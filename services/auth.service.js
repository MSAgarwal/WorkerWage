const jwt = require('jsonwebtoken');
const { db, getJwtSecret, verifyAdminPin, updateAdminPin } = require('../db');
const { recordAuthFailure, recordAuthSuccess } = require('../middleware/auth.middleware');

/**
 * Service handling authentication operations
 */
class AuthService {
  /**
   * Verify admin PIN and issue JWT token
   */
  verifyPin(pin, clientIp) {
    if (!pin) {
      return { success: false, statusCode: 400, error: 'PIN is required' };
    }

    const isValid = verifyAdminPin(pin);
    if (!isValid) {
      recordAuthFailure(clientIp);
      return { success: false, statusCode: 401, error: 'Incorrect Admin PIN. Please try again.' };
    }

    recordAuthSuccess(clientIp);

    const token = jwt.sign(
      { role: 'admin' },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    return {
      success: true,
      token,
      message: 'Admin verified successfully'
    };
  }

  /**
   * Verify worker login via Employee Code or Phone number
   */
  verifyWorkerLogin(identifier, clientIp) {
    if (!identifier || String(identifier).trim() === '') {
      return { success: false, statusCode: 400, error: 'Worker Code or Phone Number is required' };
    }

    const clean = String(identifier).trim();
    // Search active worker by employee_code (case-insensitive) or phone number
    const worker = db.prepare(`
      SELECT id, employee_code, name, role, worker_type, phone, daily_wage, default_box_rate, status
      FROM employees
      WHERE (LOWER(employee_code) = LOWER(?) OR phone = ?) AND status = 'ACTIVE'
    `).get(clean, clean);

    if (!worker) {
      recordAuthFailure(clientIp);
      return { success: false, statusCode: 404, error: 'Active worker not found. Please verify your Worker Code (e.g. EMP001) or phone number.' };
    }

    recordAuthSuccess(clientIp);

    const token = jwt.sign(
      {
        role: 'worker',
        employee_id: worker.id,
        employee_code: worker.employee_code,
        name: worker.name
      },
      getJwtSecret(),
      { expiresIn: '30d' }
    );

    return {
      success: true,
      token,
      worker: {
        id: worker.id,
        employee_code: worker.employee_code,
        name: worker.name,
        role: worker.role,
        worker_type: worker.worker_type,
        daily_wage: worker.daily_wage,
        phone: worker.phone
      },
      message: `Welcome, ${worker.name}!`
    };
  }

  /**
   * Check if a given JWT token is valid
   */
  checkToken(token) {
    if (!token) {
      return { authenticated: false };
    }

    try {
      const decoded = jwt.verify(token, getJwtSecret());
      return { authenticated: true, user: decoded };
    } catch (err) {
      return { authenticated: false };
    }
  }

  /**
   * Update admin PIN after verifying current PIN
   */
  changePin(currentPin, newPin) {
    if (!verifyAdminPin(currentPin)) {
      return { success: false, statusCode: 401, error: 'Current PIN does not match' };
    }

    updateAdminPin(newPin);
    return { success: true, message: 'Admin PIN updated successfully' };
  }
}

module.exports = new AuthService();
