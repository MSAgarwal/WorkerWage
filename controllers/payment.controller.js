const paymentService = require('../services/payment.service');
const { isValidDate, validatePaymentInput } = require('../validators');

class PaymentController {
  /**
   * GET /api/payments
   * List payments with optional employee or date filters
   */
  getPayments(req, res, next) {
    try {
      const { employee_id, startDate, endDate } = req.query;

      if (startDate && !isValidDate(startDate)) {
        return res.status(400).json({ error: 'Invalid startDate parameter. Date must be in YYYY-MM-DD format.' });
      }
      if (endDate && !isValidDate(endDate)) {
        return res.status(400).json({ error: 'Invalid endDate parameter. Date must be in YYYY-MM-DD format.' });
      }

      let empId = null;
      if (employee_id) {
        empId = parseInt(employee_id, 10);
        if (isNaN(empId) || empId <= 0) {
          return res.status(400).json({ error: 'Invalid employee_id parameter' });
        }
      }

      const payments = paymentService.getPayments({
        employee_id: empId,
        startDate,
        endDate
      });

      res.json({ success: true, payments });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/payments
   * Record a new advance or payout
   */
  createPayment(req, res, next) {
    try {
      const validation = validatePaymentInput(req.body);
      if (!validation.isValid) {
        return res.status(400).json({ error: validation.errors.join(', '), details: validation.errors });
      }

      const payment = paymentService.createPayment(validation.sanitized);
      res.json({
        success: true,
        message: 'Payment recorded successfully',
        payment
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/payments/:id
   * Remove a payment entry by ID
   */
  deletePayment(req, res, next) {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid payment ID' });
      }

      paymentService.deletePayment(id);
      res.json({ success: true, message: 'Payment entry removed' });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new PaymentController();
