const authService = require('../services/auth.service');
const { validateChangePinInput } = require('../validators');

class AuthController {
  /**
   * POST /api/auth/verify
   * Verify admin PIN and issue JWT
   */
  async verify(req, res, next) {
    try {
      const { pin } = req.body;
      const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

      const result = authService.verifyPin(pin, clientIp);
      if (!result.success) {
        return res.status(result.statusCode || 401).json({ error: result.error });
      }

      res.cookie('admin_token', result.token, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });

      return res.json({
        success: true,
        token: result.token,
        message: result.message
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/worker-login
   * Authenticate worker via Employee Code or Phone
   */
  async workerLogin(req, res, next) {
    try {
      const { identifier } = req.body;
      const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

      const result = authService.verifyWorkerLogin(identifier, clientIp);
      if (!result.success) {
        return res.status(result.statusCode || 401).json({ error: result.error });
      }

      res.cookie('worker_token', result.token, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
      });

      return res.json({
        success: true,
        token: result.token,
        worker: result.worker,
        message: result.message
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/auth/check
   * Check if current session/token is valid
   */
  check(req, res) {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }
    if (!token && req.cookies) {
      if (req.cookies.admin_token) token = req.cookies.admin_token;
      else if (req.cookies.worker_token) token = req.cookies.worker_token;
    }

    const status = authService.checkToken(token);
    if (status.authenticated && token) {
      status.token = token;
      status.role = status.user?.role || 'admin';
    }
    return res.json(status);
  }

  /**
   * POST /api/auth/logout
   * Clear both admin and worker authentication cookies
   */
  logout(req, res) {
    res.clearCookie('admin_token');
    res.clearCookie('worker_token');
    return res.json({ success: true, message: 'Logged out successfully' });
  }

  /**
   * POST /api/auth/change-pin
   * Update admin PIN
   */
  changePin(req, res, next) {
    try {
      const validation = validateChangePinInput(req.body);
      if (!validation.isValid) {
        return res.status(400).json({ error: 'Validation failed', details: validation.errors });
      }

      const { currentPin, newPin } = validation.sanitized;
      const result = authService.changePin(currentPin, newPin);

      if (!result.success) {
        return res.status(result.statusCode || 400).json({ error: result.error });
      }

      return res.json(result);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AuthController();
