/**
 * Input Validation & Data Sanitization Module
 * Protects against malformed data, null payloads, out-of-range values, and control characters.
 */

const { LIMITS, MAX_OT_MULTIPLIER, PAYMENT_TYPES, PAYMENT_METHODS, WORKER_TYPES, MAX_VALID_YEAR } = require('./config/constants');

/**
 * Helper: Sanitize string for persistent database storage.
 * Strips unprintable control characters, trims whitespace, and enforces length limits.
 * NOTE: HTML entity escaping is intentionally handled at the presentation/rendering layer
 * to avoid double-encoding in API responses and database storage.
 */
function sanitizeString(val, maxLength = 255) {
  if (val === undefined || val === null) return '';
  const str = String(val).trim();
  // Strip control characters (except newline \n and tab \t if needed)
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, maxLength);
}

/**
 * Helper: Validate ISO YYYY-MM-DD date string strictly
 */
function isValidDate(dateStr) {
  if (typeof dateStr !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const parts = dateStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  if (year < 1900 || year > MAX_VALID_YEAR) return false;
  if (month < 1 || month > 12) return false;

  const daysInMonth = new Date(year, month, 0).getDate();
  return day >= 1 && day <= daysInMonth;
}

/**
 * Helper: Validate finite non-negative number within bounds
 */
function isValidNonNegativeNumber(val, max = Number.MAX_SAFE_INTEGER) {
  if (val === undefined || val === null || val === '') return false;
  const num = Number(val);
  return !isNaN(num) && isFinite(num) && num >= 0 && num <= max;
}

/**
 * Helper: Validate positive number within bounds
 */
function isValidPositiveNumber(val, max = Number.MAX_SAFE_INTEGER) {
  if (val === undefined || val === null || val === '') return false;
  const num = Number(val);
  return !isNaN(num) && isFinite(num) && num > 0 && num <= max;
}

// -------------------------------------------------------------
// Validator: Employee (POST /api/employees & PUT /api/employees/:id)
// -------------------------------------------------------------
function validateEmployeeInput(body, isUpdate = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { isValid: false, errors: ['Request body must be a valid JSON object.'], sanitized: {} };
  }

  const errors = [];
  const sanitized = {};

  // Name
  if (!isUpdate || body.name !== undefined) {
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      errors.push('Worker name is required and cannot be empty.');
    } else if (body.name.trim().length > 100) {
      errors.push('Worker name cannot exceed 100 characters.');
    } else {
      sanitized.name = sanitizeString(body.name, 100);
    }
  }

  // Daily Wage
  if (!isUpdate || body.daily_wage !== undefined) {
    if (!isValidNonNegativeNumber(body.daily_wage, LIMITS.MAX_DAILY_WAGE)) {
      errors.push(`Daily wage must be a non-negative number up to ₹${LIMITS.MAX_DAILY_WAGE.toLocaleString()}.`);
    } else {
      sanitized.daily_wage = Math.round(Number(body.daily_wage) * 100) / 100;
    }
  }

  // Worker Type ('WORKER' or 'MANAGER')
  if (body.worker_type !== undefined) {
    const wt = String(body.worker_type).trim().toUpperCase();
    if (!WORKER_TYPES.includes(wt)) {
      errors.push(`Worker type must be one of: ${WORKER_TYPES.join(', ')}.`);
    } else {
      sanitized.worker_type = wt;
    }
  } else if (!isUpdate) {
    sanitized.worker_type = 'WORKER';
  }

  // Phone
  if (body.phone !== undefined) {
    sanitized.phone = sanitizeString(body.phone, 20);
  } else if (!isUpdate) {
    sanitized.phone = '';
  }

  // Role
  if (body.role !== undefined) {
    sanitized.role = sanitizeString(body.role, 100);
  } else if (!isUpdate) {
    sanitized.role = sanitized.worker_type === 'MANAGER' ? 'Manager' : 'Worker';
  }

  // Employee Code
  if (body.employee_code !== undefined) {
    sanitized.employee_code = sanitizeString(body.employee_code, 30);
  }

  // Default Box Rate
  if (body.default_box_rate !== undefined) {
    if (!isValidNonNegativeNumber(body.default_box_rate, LIMITS.MAX_BOX_RATE)) {
      errors.push(`Default box rate must be a non-negative number up to ₹${LIMITS.MAX_BOX_RATE.toLocaleString()}.`);
    } else {
      sanitized.default_box_rate = Math.round(Number(body.default_box_rate) * 100) / 100;
    }
  } else if (!isUpdate) {
    sanitized.default_box_rate = 30.0;
  }

  // Default OT Multiplier (Bounded by MAX_OT_MULTIPLIER)
  if (body.default_ot_multiplier !== undefined) {
    const ot = Number(body.default_ot_multiplier);
    if (isNaN(ot) || !isFinite(ot) || ot < 0 || ot > MAX_OT_MULTIPLIER) {
      errors.push(`Overtime multiplier must be a number between 0.0 and ${MAX_OT_MULTIPLIER.toFixed(1)}.`);
    } else {
      sanitized.default_ot_multiplier = Math.round(ot * 100) / 100;
    }
  } else if (!isUpdate) {
    sanitized.default_ot_multiplier = 0.0;
  }

  // Notes
  if (body.notes !== undefined) {
    sanitized.notes = sanitizeString(body.notes, 500);
  } else if (!isUpdate) {
    sanitized.notes = '';
  }

  // Department (Multi-unit scaling)
  if (body.department !== undefined) {
    sanitized.department = sanitizeString(body.department, 100);
  } else if (!isUpdate) {
    sanitized.department = '';
  }

  // Branch (Multi-unit scaling)
  if (body.branch !== undefined) {
    sanitized.branch = sanitizeString(body.branch, 100);
  } else if (!isUpdate) {
    sanitized.branch = '';
  }

  // Status (ACTIVE / INACTIVE)
  if (body.status !== undefined) {
    const st = String(body.status).trim().toUpperCase();
    if (st !== 'ACTIVE' && st !== 'INACTIVE') {
      errors.push("Status must be either 'ACTIVE' or 'INACTIVE'.");
    } else {
      sanitized.status = st;
    }
  } else if (!isUpdate) {
    sanitized.status = 'ACTIVE';
  }

  // Passbook Key / PIN (minimum 5 digits/characters)
  if (body.pin !== undefined && body.pin !== null && String(body.pin).trim() !== '') {
    const pinStr = String(body.pin).trim();
    if (pinStr.length < 5) {
      errors.push('Worker password / PIN must be at least 5 digits/characters long.');
    } else if (pinStr.length > 32) {
      errors.push('Worker password / PIN cannot exceed 32 characters.');
    } else {
      sanitized.pin = pinStr;
    }
  } else if (!isUpdate) {
    sanitized.pin = '12345';
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized
  };
}

// -------------------------------------------------------------
// Validator: Attendance Record (Single item)
// -------------------------------------------------------------
const ALLOWED_STATUSES = ['PRESENT', 'HALF_DAY', 'ABSENT', 'PAID_LEAVE', 'PAID_HOLIDAY'];

function validateAttendanceInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { isValid: false, errors: ['Request body must be a valid JSON object.'], sanitized: {} };
  }

  const errors = [];
  const sanitized = {};

  // Employee ID
  const empId = parseInt(body.employee_id, 10);
  if (isNaN(empId) || empId <= 0) {
    errors.push('A valid positive employee_id is required.');
  } else {
    sanitized.employee_id = empId;
  }

  // Date
  if (!isValidDate(body.date)) {
    errors.push('Date must be in valid YYYY-MM-DD format.');
  } else {
    sanitized.date = String(body.date).trim();
  }

  // Status
  const status = String(body.status || '').trim().toUpperCase();
  if (!ALLOWED_STATUSES.includes(status)) {
    errors.push(`Status must be one of: ${ALLOWED_STATUSES.join(', ')}.`);
  } else {
    sanitized.status = status;
  }

  // Work Category
  sanitized.work_category = sanitizeString(body.work_category || '', 50);

  // Extra Boxes
  if (body.extra_boxes !== undefined && body.extra_boxes !== '') {
    if (!isValidNonNegativeNumber(body.extra_boxes, LIMITS.MAX_EXTRA_BOXES)) {
      errors.push(`extra_boxes must be a non-negative number up to ${LIMITS.MAX_EXTRA_BOXES}.`);
    } else {
      sanitized.extra_boxes = Math.round(Number(body.extra_boxes) * 100) / 100;
    }
  } else {
    sanitized.extra_boxes = 0.0;
  }

  // Extra Pieces
  if (body.extra_pieces !== undefined && body.extra_pieces !== '') {
    if (!isValidNonNegativeNumber(body.extra_pieces, LIMITS.MAX_EXTRA_PIECES)) {
      errors.push(`extra_pieces must be a non-negative number up to ${LIMITS.MAX_EXTRA_PIECES}.`);
    } else {
      sanitized.extra_pieces = Math.round(Number(body.extra_pieces) * 100) / 100;
    }
  } else {
    sanitized.extra_pieces = 0.0;
  }

  // Box Rate
  if (body.box_rate !== undefined && body.box_rate !== '') {
    if (!isValidNonNegativeNumber(body.box_rate, LIMITS.MAX_BOX_RATE)) {
      errors.push(`box_rate must be a non-negative number up to ₹${LIMITS.MAX_BOX_RATE.toLocaleString()}.`);
    } else {
      sanitized.box_rate = Math.round(Number(body.box_rate) * 100) / 100;
    }
  } else {
    sanitized.box_rate = 30.0;
  }

  // Overtime Days
  if (body.overtime_days !== undefined && body.overtime_days !== '') {
    if (!isValidNonNegativeNumber(body.overtime_days, LIMITS.MAX_OT_DAYS)) {
      errors.push(`overtime_days must be a non-negative number up to ${LIMITS.MAX_OT_DAYS}.`);
    } else {
      sanitized.overtime_days = Math.round(Number(body.overtime_days) * 100) / 100;
    }
  } else {
    sanitized.overtime_days = 0.0;
  }

  // Overtime Multiplier
  if (body.overtime_multiplier !== undefined && body.overtime_multiplier !== '') {
    const otM = Number(body.overtime_multiplier);
    if (isNaN(otM) || !isFinite(otM) || otM < 0 || otM > MAX_OT_MULTIPLIER) {
      errors.push(`overtime_multiplier must be between 0.0 and ${MAX_OT_MULTIPLIER.toFixed(1)}.`);
    } else {
      sanitized.overtime_multiplier = Math.round(otM * 100) / 100;
    }
  } else {
    sanitized.overtime_multiplier = 0.0;
  }

  // Bonus Allowance
  if (body.bonus_allowance !== undefined && body.bonus_allowance !== '') {
    if (!isValidNonNegativeNumber(body.bonus_allowance, LIMITS.MAX_ALLOWANCE_DEDUCTION)) {
      errors.push(`bonus_allowance must be a non-negative number up to ₹${LIMITS.MAX_ALLOWANCE_DEDUCTION.toLocaleString()}.`);
    } else {
      sanitized.bonus_allowance = Math.round(Number(body.bonus_allowance) * 100) / 100;
    }
  } else {
    sanitized.bonus_allowance = 0.0;
  }

  // Deduction
  if (body.deduction !== undefined && body.deduction !== '') {
    if (!isValidNonNegativeNumber(body.deduction, LIMITS.MAX_ALLOWANCE_DEDUCTION)) {
      errors.push(`deduction must be a non-negative number up to ₹${LIMITS.MAX_ALLOWANCE_DEDUCTION.toLocaleString()}.`);
    } else {
      sanitized.deduction = Math.round(Number(body.deduction) * 100) / 100;
    }
  } else {
    sanitized.deduction = 0.0;
  }

  // Holiday Work flag (sanitized as boolean, but server evaluates date authoritatively)
  sanitized.is_holiday_work = body.is_holiday_work === true || body.is_holiday_work === 1 || body.is_holiday_work === '1';

  // Notes
  sanitized.notes = sanitizeString(body.notes || '', 500);

  return {
    isValid: errors.length === 0,
    errors,
    sanitized
  };
}

// -------------------------------------------------------------
// Validator: Batch Attendance (POST /api/attendance/batch)
// -------------------------------------------------------------
function validateBatchAttendanceInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { isValid: false, errors: ['Request body must be a valid JSON object.'], sanitized: {} };
  }

  const errors = [];
  const sanitized = {};

  // Date
  if (!isValidDate(body.date)) {
    errors.push('Date must be in valid YYYY-MM-DD format.');
  } else {
    sanitized.date = String(body.date).trim();
  }

  // Records array
  if (!Array.isArray(body.records)) {
    errors.push('records must be an array of worker attendance entries.');
  } else if (body.records.length === 0) {
    errors.push('records array cannot be empty.');
  } else if (body.records.length > 500) {
    errors.push('records array cannot exceed 500 entries per batch.');
  } else {
    sanitized.records = [];
    const seenEmpIds = new Set();

    body.records.forEach((rec, idx) => {
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
        errors.push(`Record #${idx + 1} must be an object.`);
        return;
      }

      const empId = parseInt(rec.employee_id, 10);
      if (empId && seenEmpIds.has(empId)) {
        errors.push(`Duplicate worker ID ${empId} detected in batch.`);
      } else if (empId) {
        seenEmpIds.add(empId);
      }

      const recValidation = validateAttendanceInput({ ...rec, date: sanitized.date || body.date });
      if (!recValidation.isValid) {
        errors.push(`Record #${idx + 1}: ${recValidation.errors.join(', ')}`);
      } else {
        sanitized.records.push(recValidation.sanitized);
      }
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized
  };
}

// -------------------------------------------------------------
// Validator: Payments (POST /api/payments)
// -------------------------------------------------------------
function validatePaymentInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { isValid: false, errors: ['Request body must be a valid JSON object.'], sanitized: {} };
  }

  const errors = [];
  const sanitized = {};

  // Employee ID
  const empId = parseInt(body.employee_id, 10);
  if (isNaN(empId) || empId <= 0) {
    errors.push('A valid positive employee_id is required.');
  } else {
    sanitized.employee_id = empId;
  }

  // Date
  if (!isValidDate(body.date)) {
    errors.push('Date must be in valid YYYY-MM-DD format.');
  } else {
    sanitized.date = String(body.date).trim();
  }

  // Amount
  if (!isValidPositiveNumber(body.amount, LIMITS.MAX_PAYMENT_AMOUNT)) {
    errors.push(`Amount must be a valid positive number up to ₹${LIMITS.MAX_PAYMENT_AMOUNT.toLocaleString()}.`);
  } else {
    sanitized.amount = Math.round(Number(body.amount) * 100) / 100;
  }

  // Payment Type
  const type = String(body.type || 'ADVANCE').trim().toUpperCase();
  if (!PAYMENT_TYPES.includes(type)) {
    errors.push(`Payment type must be one of: ${PAYMENT_TYPES.join(', ')}.`);
  } else {
    sanitized.type = type;
  }

  // Payment Method
  const method = String(body.payment_method || 'CASH').trim().toUpperCase();
  if (!PAYMENT_METHODS.includes(method)) {
    errors.push(`Payment method must be one of: ${PAYMENT_METHODS.join(', ')}.`);
  } else {
    sanitized.payment_method = method;
  }

  // Notes
  sanitized.notes = sanitizeString(body.notes || '', 500);

  return {
    isValid: errors.length === 0,
    errors,
    sanitized
  };
}

// -------------------------------------------------------------
// Validator: Holiday (POST /api/holidays)
// -------------------------------------------------------------
function validateHolidayInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { isValid: false, errors: ['Request body must be a valid JSON object.'], sanitized: {} };
  }

  const errors = [];
  const sanitized = {};

  if (!isValidDate(body.date)) {
    errors.push('Date must be in valid YYYY-MM-DD format.');
  } else {
    sanitized.date = String(body.date).trim();
  }

  const rawTitle = body.title || body.name;
  if (!rawTitle || typeof rawTitle !== 'string' || rawTitle.trim().length === 0) {
    errors.push('Holiday title is required.');
  } else if (rawTitle.trim().length > 100) {
    errors.push('Holiday title cannot exceed 100 characters.');
  } else {
    sanitized.title = sanitizeString(rawTitle, 100);
  }

  sanitized.is_paid = body.is_paid === false || body.is_paid === 0 || body.is_paid === '0' ? 0 : 1;

  return {
    isValid: errors.length === 0,
    errors,
    sanitized
  };
}

// -------------------------------------------------------------
// Validator: Change PIN (POST /api/auth/change-pin)
// -------------------------------------------------------------
function validateChangePinInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { isValid: false, errors: ['Request body must be a valid JSON object.'], sanitized: {} };
  }

  const errors = [];
  const sanitized = {};

  if (!body.currentPin || typeof body.currentPin !== 'string') {
    errors.push('Current PIN is required.');
  } else {
    sanitized.currentPin = body.currentPin.trim();
  }

  if (!body.newPin || typeof body.newPin !== 'string') {
    errors.push('New PIN is required.');
  } else {
    const trimmed = body.newPin.trim();
    if (!/^\d{4,8}$/.test(trimmed)) {
      errors.push('New PIN must be between 4 and 8 digits (numeric only).');
    } else {
      sanitized.newPin = trimmed;
    }
  }

  if (body.confirmPin !== undefined && String(body.confirmPin).trim() !== String(body.newPin).trim()) {
    errors.push('New PIN and Confirm PIN do not match.');
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized
  };
}

module.exports = {
  isValidDate,
  sanitizeString,
  validateEmployeeInput,
  validateAttendanceInput,
  validateBatchAttendanceInput,
  validatePaymentInput,
  validateHolidayInput,
  validateChangePinInput
};
