const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidDate,
  sanitizeString,
  validateEmployeeInput,
  validateAttendanceInput,
  validateBatchAttendanceInput,
  validatePaymentInput,
  validateHolidayInput,
  validateChangePinInput
} = require('../../validators');

describe('Validators Unit Tests', () => {
  describe('isValidDate', () => {
    it('accepts valid YYYY-MM-DD dates', () => {
      assert.equal(isValidDate('2026-01-01'), true);
      assert.equal(isValidDate('2026-09-26'), true);
      assert.equal(isValidDate('2024-02-29'), true); // Leap year
    });

    it('rejects invalid or non-existent dates', () => {
      assert.equal(isValidDate('2026-02-29'), false); // Non-leap year
      assert.equal(isValidDate('2026-02-31'), false);
      assert.equal(isValidDate('2026-13-01'), false);
      assert.equal(isValidDate('2026-00-10'), false);
      assert.equal(isValidDate('2026-04-31'), false); // April has 30 days
      assert.equal(isValidDate('not-a-date'), false);
      assert.equal(isValidDate(''), false);
      assert.equal(isValidDate(null), false);
      assert.equal(isValidDate(undefined), false);
      assert.equal(isValidDate(12345), false);
    });
  });

  describe('sanitizeString', () => {
    it('trims leading and trailing whitespace', () => {
      assert.equal(sanitizeString('   hello world   '), 'hello world');
    });

    it('preserves raw text for database storage without double-escaping entities', () => {
      assert.equal(sanitizeString('<script>alert("xss")</script>'), '<script>alert("xss")</script>');
      assert.equal(sanitizeString('<b>Bold text</b>'), '<b>Bold text</b>');
      assert.equal(sanitizeString("O'Connor & Sons"), "O'Connor & Sons");
    });

    it('strips dangerous unprintable control characters', () => {
      assert.equal(sanitizeString('Hello\x00World\x08!'), 'HelloWorld!');
    });

    it('bounds max length', () => {
      const longStr = 'a'.repeat(300);
      assert.equal(sanitizeString(longStr, 50).length, 50);
    });

    it('handles non-string types safely', () => {
      assert.equal(sanitizeString(null), '');
      assert.equal(sanitizeString(undefined), '');
      assert.equal(sanitizeString(123), '123');
    });
  });

  describe('validateEmployeeInput', () => {
    it('handles null and non-object body safely without 500 error', () => {
      assert.equal(validateEmployeeInput(null).isValid, false);
      assert.equal(validateEmployeeInput(undefined).isValid, false);
      assert.equal(validateEmployeeInput([]).isValid, false);
      assert.equal(validateEmployeeInput('bad string').isValid, false);
    });

    it('validates a correct worker input', () => {
      const res = validateEmployeeInput({
        name: 'Ramesh Kumar',
        phone: '9876543210',
        role: 'Packer',
        worker_type: 'WORKER',
        daily_wage: 450,
        default_box_rate: 30
      });
      assert.equal(res.isValid, true);
      assert.equal(res.errors.length, 0);
      assert.equal(res.sanitized.name, 'Ramesh Kumar');
      assert.equal(res.sanitized.daily_wage, 450);
      assert.equal(res.sanitized.worker_type, 'WORKER');
    });

    it('rejects worker without name', () => {
      const res = validateEmployeeInput({ daily_wage: 400 });
      assert.equal(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('Worker name is required')));
    });

    it('rejects worker with negative daily wage', () => {
      const res = validateEmployeeInput({ name: 'Valid Name', daily_wage: -100 });
      assert.equal(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('non-negative number')));
    });

    it('rejects daily wage exceeding domain limit', () => {
      const res = validateEmployeeInput({ name: 'Valid Name', daily_wage: 5000000 });
      assert.equal(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('non-negative number up to')));
    });

    it('rejects invalid worker_type', () => {
      const res = validateEmployeeInput({ name: 'Valid Name', daily_wage: 400, worker_type: 'CEO' });
      assert.equal(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes("Worker type must be one of")));
    });
  });

  describe('validateAttendanceInput', () => {
    it('handles null or array body safely without 500', () => {
      assert.equal(validateAttendanceInput(null).isValid, false);
      assert.equal(validateAttendanceInput([]).isValid, false);
    });

    it('validates correct attendance payload', () => {
      const res = validateAttendanceInput({
        employee_id: 1,
        date: '2026-10-01',
        status: 'PRESENT',
        extra_boxes: 5,
        box_rate: 30
      });
      assert.equal(res.isValid, true);
      assert.equal(res.sanitized.employee_id, 1);
      assert.equal(res.sanitized.status, 'PRESENT');
      assert.equal(res.sanitized.extra_boxes, 5);
    });

    it('rejects invalid employee_id', () => {
      const res = validateAttendanceInput({ employee_id: 'abc', date: '2026-10-01', status: 'PRESENT' });
      assert.equal(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('valid positive employee_id')));
    });

    it('rejects invalid status', () => {
      const res = validateAttendanceInput({ employee_id: 1, date: '2026-10-01', status: 'UNKNOWN' });
      assert.equal(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('Status must be one of')));
    });

    it('rejects overtime multiplier exceeding MAX_OT_MULTIPLIER (3.0)', () => {
      const res = validateAttendanceInput({
        employee_id: 1,
        date: '2026-10-01',
        status: 'PRESENT',
        overtime_multiplier: 4.5
      });
      assert.equal(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('overtime_multiplier must be between 0.0 and 3.0')));
    });
  });

  describe('validateBatchAttendanceInput', () => {
    it('handles null body safely', () => {
      assert.equal(validateBatchAttendanceInput(null).isValid, false);
      assert.equal(validateBatchAttendanceInput(undefined).isValid, false);
    });

    it('detects duplicate worker IDs within the same batch', () => {
      const res = validateBatchAttendanceInput({
        date: '2026-10-01',
        records: [
          { employee_id: 1, status: 'PRESENT' },
          { employee_id: 1, status: 'HALF_DAY' }
        ]
      });
      assert.equal(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('Duplicate worker ID 1 detected')));
    });
  });

  describe('validatePaymentInput', () => {
    it('handles null body safely', () => {
      assert.equal(validatePaymentInput(null).isValid, false);
    });

    it('validates a correct advance payment', () => {
      const res = validatePaymentInput({
        employee_id: 2,
        date: '2026-10-01',
        amount: 500,
        type: 'ADVANCE',
        payment_method: 'CASH',
        notes: 'Emergency advance'
      });
      assert.equal(res.isValid, true);
      assert.equal(res.sanitized.amount, 500);
      assert.equal(res.sanitized.type, 'ADVANCE');
      assert.equal(res.sanitized.payment_method, 'CASH');
    });

    it('validates a correct BONUS payment', () => {
      const res = validatePaymentInput({
        employee_id: 2,
        date: '2026-10-01',
        amount: 4000,
        type: 'BONUS',
        payment_method: 'CASH',
        notes: 'Festival bonus'
      });
      assert.equal(res.isValid, true);
      assert.equal(res.sanitized.amount, 4000);
      assert.equal(res.sanitized.type, 'BONUS');
      assert.equal(res.sanitized.payment_method, 'CASH');
    });

    it('rejects zero or negative payment amount', () => {
      const res = validatePaymentInput({ employee_id: 2, date: '2026-10-01', amount: 0 });
      assert.equal(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('positive number up to')));
    });

    it('rejects payment amount exceeding domain limit', () => {
      const res = validatePaymentInput({ employee_id: 2, date: '2026-10-01', amount: 999999999 });
      assert.equal(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('positive number up to')));
    });

    it('rejects invalid payment type', () => {
      const res = validatePaymentInput({ employee_id: 2, date: '2026-10-01', amount: 100, type: 'LOAN' });
      assert.equal(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('Payment type must be one of')));
    });
  });

  describe('validateHolidayInput', () => {
    it('handles null body safely', () => {
      assert.equal(validateHolidayInput(null).isValid, false);
    });

    it('validates correct holiday', () => {
      const res = validateHolidayInput({ date: '2026-10-02', name: 'Gandhi Jayanti', is_paid: true });
      assert.equal(res.isValid, true);
      assert.equal(res.sanitized.date, '2026-10-02');
      assert.equal(res.sanitized.title, 'Gandhi Jayanti');
      assert.equal(res.sanitized.is_paid, 1);
    });

    it('rejects empty title/name', () => {
      const res = validateHolidayInput({ date: '2026-10-02', name: '   ' });
      assert.equal(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('Holiday title is required')));
    });
  });

  describe('validateChangePinInput', () => {
    it('handles null body safely', () => {
      assert.equal(validateChangePinInput(null).isValid, false);
    });

    it('validates matching 4-8 digit new pin', () => {
      const res = validateChangePinInput({ currentPin: '1234', newPin: '5678', confirmPin: '5678' });
      assert.equal(res.isValid, true);
      assert.equal(res.sanitized.newPin, '5678');
    });

    it('rejects mismatching confirmPin', () => {
      const res = validateChangePinInput({ currentPin: '1234', newPin: '5678', confirmPin: '9999' });
      assert.equal(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('New PIN and Confirm PIN do not match')));
    });

    it('rejects non-numeric or too short PIN', () => {
      const res = validateChangePinInput({ currentPin: '1234', newPin: 'abc', confirmPin: 'abc' });
      assert.equal(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('New PIN must be between 4 and 8 digits')));
    });
  });
});
