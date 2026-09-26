/**
 * Pure wage calculation engine for WorkerWage
 * Supports packaging worker box overtime, piece category (cards/bangles) rules,
 * manager exemptions, and paid day off calculations.
 */

/**
 * Determine if work category is piece-based (cards of any type, bangles)
 * @param {string} category 
 * @returns {boolean}
 */
function isPieceCategory(category) {
  if (!category) return false;
  const lower = String(category).toLowerCase();
  return lower.includes('card') || lower.includes('bangle');
}

/**
 * Calculate worker wages for a day
 * 
 * Business Rules:
 * 1. Base Pay:
 *    - PRESENT: 1.0 * dailyWage
 *    - HALF_DAY: 0.5 * dailyWage
 *    - PAID_LEAVE / PAID_HOLIDAY: 1.0 * dailyWage (Tuesday weekly off or declared paid holiday)
 *    - ABSENT: 0
 * 2. Managers:
 *    - Exempt from packaging categories & box/piece overtime
 *    - Can receive day-based overtime (otDays * dailyWage * otMultiplier)
 * 3. Packaging Workers:
 *    - Piece categories (Cards & Bangles):
 *      - Normal days: Overtime disabled (₹0)
 *      - Worked Paid Holidays / Tuesdays (status != ABSENT): Fixed ₹200 overtime
 *    - Box categories (General packing):
 *      - Extra boxes * boxRate (default ₹30/box)
 *      - If Paid Day Off and worker did NOT work (PAID_LEAVE/ABSENT), overtime is ₹0
 * 4. Net Pay:
 *    - Math.max(0, basePay + overtimePay + bonus - deduction)
 */
function calculateWage(
  dailyWage,
  status,
  otDays = 0,
  otMultiplier = 0.0,
  isHolidayWork = false,
  bonus = 0,
  deduction = 0,
  extraBoxes = 0,
  boxRate = 30.0,
  workerType = 'WORKER',
  workCategory = '',
  extraPieces = 0,
  isPaidDayOff = false
) {
  dailyWage = Number(dailyWage) || 0;
  bonus = Number(bonus) || 0;
  deduction = Number(deduction) || 0;

  let basePay = 0;
  let statusDays = 0;

  if (status === 'PRESENT') {
    statusDays = 1.0;
    basePay = dailyWage;
  } else if (status === 'HALF_DAY') {
    statusDays = 0.5;
    basePay = dailyWage * 0.5;
  } else if (status === 'PAID_LEAVE' || status === 'PAID_HOLIDAY') {
    statusDays = 1.0;
    basePay = dailyWage; // Paid day off gives full daily wage!
  } else {
    // ABSENT
    statusDays = 0.0;
    basePay = 0.0;
  }

  let overtimePay = 0;
  let parsedBoxes = 0;
  let parsedPieces = 0;
  let parsedBoxRate = 30.0;
  let parsedOtDays = 0;
  let parsedOtMultiplier = 0.0;

  // Determine if this is holiday work on a paid holiday / Tuesday
  const isHoliday = !!isHolidayWork || (isPaidDayOff && (status === 'PRESENT' || status === 'HALF_DAY'));

  if (workerType === 'MANAGER') {
    // Manager: Exempt from packaging work categories & box/piece overtime
    parsedOtDays = Number(otDays) || 0;
    if (otMultiplier === undefined || otMultiplier === null || isNaN(Number(otMultiplier))) {
      parsedOtMultiplier = 0.0;
    } else {
      parsedOtMultiplier = Math.max(0, Math.min(3.0, Math.round(Number(otMultiplier) * 100) / 100));
    }
    overtimePay = parsedOtDays * dailyWage * parsedOtMultiplier;
    parsedBoxes = 0;
    parsedPieces = 0;
    parsedBoxRate = 0.0;
  } else {
    // Packaging Worker:
    const isPiece = isPieceCategory(workCategory);

    if (isPiece) {
      // Cards & Bangles: Fixed ₹200 on worked holidays/Tuesdays; ₹0 on normal days
      if (isHoliday && status !== 'ABSENT') {
        overtimePay = 200.0;
      } else {
        overtimePay = 0.0;
      }
      parsedPieces = 0;
      parsedBoxes = 0;
      parsedBoxRate = 0.0;
    } else {
      // Standard categories: extra boxes * boxRate
      if (isPaidDayOff && !isHolidayWork) {
        parsedBoxes = 0;
        overtimePay = 0.0;
      } else {
        parsedBoxRate = (boxRate !== undefined && boxRate !== null && !isNaN(parseFloat(boxRate)))
          ? Math.max(0, parseFloat(boxRate))
          : 30.0;
        parsedBoxes = Math.max(0, parseFloat(extraBoxes) || 0);
        overtimePay = parsedBoxes * parsedBoxRate;
      }
      parsedPieces = 0;
    }

    parsedOtDays = 0;
    parsedOtMultiplier = 0.0;
  }

  const totalPay = Math.max(0, basePay + overtimePay + bonus - deduction);

  return {
    dailyWage,
    statusDays,
    workerType: workerType || 'WORKER',
    workCategory: workCategory || '',
    basePay: Math.round(basePay * 100) / 100,
    extraBoxes: Math.round(parsedBoxes * 100) / 100,
    extraPieces: Math.round(parsedPieces * 100) / 100,
    boxRate: Math.round(parsedBoxRate * 100) / 100,
    overtimeDays: Math.round(parsedOtDays * 100) / 100,
    overtimeMultiplier: parsedOtMultiplier,
    overtimePay: Math.round(overtimePay * 100) / 100,
    isHolidayWork: isHoliday && status !== 'ABSENT',
    bonusAllowance: bonus,
    deduction: deduction,
    totalPay: Math.round(totalPay * 100) / 100
  };
}

module.exports = {
  isPieceCategory,
  calculateWage
};
