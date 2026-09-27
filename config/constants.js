/**
 * Shared Application & Domain Constants for WorkerWage
 */

module.exports = {
  // Overtime & Wage Domain Constants
  DEFAULT_BOX_RATE: 30.0,
  DEFAULT_OT_MULTIPLIER: 0.0,
  MAX_OT_MULTIPLIER: 3.0,
  HOLIDAY_PIECE_OVERTIME_BONUS: 200.0,

  // Financial & Numeric Domain Upper Bounds for Input Validation
  LIMITS: {
    MIN_DAILY_WAGE: 0,
    MAX_DAILY_WAGE: 1000000, // Up to 10 Lakh / day
    MIN_BOX_RATE: 0,
    MAX_BOX_RATE: 100000,
    MIN_EXTRA_BOXES: 0,
    MAX_EXTRA_BOXES: 10000,
    MIN_EXTRA_PIECES: 0,
    MAX_EXTRA_PIECES: 100000,
    MIN_OT_DAYS: 0,
    MAX_OT_DAYS: 31,
    MIN_PAYMENT_AMOUNT: 0.01,
    MAX_PAYMENT_AMOUNT: 10000000, // Up to 1 Crore
    MIN_ALLOWANCE_DEDUCTION: 0,
    MAX_ALLOWANCE_DEDUCTION: 10000000
  },

  // Payment Types
  PAYMENT_TYPES: ['ADVANCE', 'PAYOUT', 'SETTLEMENT'],
  PAYMENT_METHODS: ['CASH', 'UPI', 'BANK_TRANSFER'],

  // Worker Types
  WORKER_TYPES: ['WORKER', 'MANAGER'],

  // Default Categories
  DEFAULT_CATEGORIES: [
    'Sp 100', 'Sp 80', 'Sp 80 kishanganj', 'Pd 80', 'Pd 100', 'S 50', 'Pd 40', 'Pd 50',
    'P 100', 'p 95', 'P card', 'Sp card', 'pd orange card', 'pd pink card', 'pd big card',
    'sp big card', 'bangles(special)'
  ]
};
