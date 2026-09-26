const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const { requireAdmin } = require('../middleware/auth.middleware');

router.get('/', requireAdmin, (req, res, next) => paymentController.getPayments(req, res, next));
router.post('/', requireAdmin, (req, res, next) => paymentController.createPayment(req, res, next));
router.delete('/:id', requireAdmin, (req, res, next) => paymentController.deletePayment(req, res, next));

module.exports = router;
