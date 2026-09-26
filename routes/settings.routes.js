const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settings.controller');
const { requireAdmin } = require('../middleware/auth.middleware');

router.get('/', requireAdmin, (req, res, next) => settingsController.getSettings(req, res, next));
router.put('/', requireAdmin, (req, res, next) => settingsController.updateSettings(req, res, next));

module.exports = router;
