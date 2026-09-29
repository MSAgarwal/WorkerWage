const express = require('express');
const router = express.Router();
const workerController = require('../controllers/worker.controller');
const { requireWorkerOrAdmin } = require('../middleware/auth.middleware');

/**
 * Worker Portal Routes
 * Read-only passbook and profile access for packaging workers and admins.
 */

// GET /api/worker/passbook?month=YYYY-MM(&employee_id=ID for admin)
router.get('/passbook', requireWorkerOrAdmin, (req, res, next) => workerController.getPassbook(req, res, next));

module.exports = router;
