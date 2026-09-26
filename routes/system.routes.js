const express = require('express');
const router = express.Router();
const systemController = require('../controllers/system.controller');
const { requireAdmin } = require('../middleware/auth.middleware');

router.get('/server-info', (req, res, next) => systemController.getServerInfo(req, res, next));
router.get('/health', (req, res, next) => systemController.getHealth(req, res, next));
router.get('/backup', requireAdmin, (req, res, next) => systemController.downloadBackup(req, res, next));

module.exports = router;
