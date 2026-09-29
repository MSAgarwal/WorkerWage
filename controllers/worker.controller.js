const workerService = require('../services/worker.service');

class WorkerController {
  /**
   * GET /api/worker/passbook
   * Return read-only passbook summary and attendance history for worker
   */
  async getPassbook(req, res, next) {
    try {
      // Security: If user is logged in as a worker, they CANNOT request another worker's ID.
      let workerId;
      if (req.user && req.user.role === 'worker') {
        workerId = req.user.employee_id;
      } else if (req.user && req.user.role === 'admin') {
        workerId = parseInt(req.query.employee_id, 10) || req.user.employee_id;
      } else {
        return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
      }

      if (!workerId || isNaN(workerId)) {
        return res.status(400).json({ error: 'Valid employee ID is required' });
      }

      const month = req.query.month;
      const data = workerService.getWorkerPassbook(workerId, month);

      return res.json({
        success: true,
        ...data
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/worker/change-key
   * Allow logged-in worker to change their own passbook secret key
   */
  async changeKey(req, res, next) {
    try {
      if (!req.user || req.user.role !== 'worker') {
        return res.status(403).json({ error: 'Worker authentication required', code: 'FORBIDDEN' });
      }

      const { currentPin, newPin } = req.body;
      const result = workerService.changeWorkerPin(req.user.employee_id, currentPin, newPin);

      return res.json(result);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new WorkerController();
