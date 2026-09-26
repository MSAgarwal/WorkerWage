const jwt = require('jsonwebtoken');
const { getJwtSecret, verifyAdminPin, updateAdminPin } = require('../db');
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
