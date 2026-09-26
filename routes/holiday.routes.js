const express = require('express');
const router = express.Router();
const holidayController = require('../controllers/holiday.controller');
const { requireAdmin } = require('../middleware/auth.middleware');

router.get('/', requireAdmin, (req, res, next) => holidayController.getHolidays(req, res, next));
router.post('/', requireAdmin, (req, res, next) => holidayController.createHoliday(req, res, next));
router.delete('/:id', requireAdmin, (req, res, next) => holidayController.deleteHoliday(req, res, next));

module.exports = router;
