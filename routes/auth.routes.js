const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { checkAuthRateLimit, requireAdmin } = require('../middleware/auth.middleware');

router.post('/verify', checkAuthRateLimit, (req, res, next) => authController.verify(req, res, next));
router.get('/check', (req, res, next) => authController.check(req, res, next));
router.post('/logout', (req, res, next) => authController.logout(req, res, next));
router.post('/change-pin', requireAdmin, (req, res, next) => authController.changePin(req, res, next));

module.exports = router;
