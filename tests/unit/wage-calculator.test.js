const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { calculateWage, isPieceCategory } = require('../../wageCalculator');

describe('Wage Calculator Unit Tests', () => {
  describe('isPieceCategory helper', () => {
    it('should identify cards of any type as piece category', () => {
      assert.equal(isPieceCategory('card'), true);
      assert.equal(isPieceCategory('Card'), true);
      assert.equal(isPieceCategory('Wedding Card'), true);
      assert.equal(isPieceCategory('Greeting Card 500'), true);
      assert.equal(isPieceCategory('visiting card'), true);
    });

    it('should identify bangles as piece category', () => {
      assert.equal(isPieceCategory('bangle'), true);
      assert.equal(isPieceCategory('Bangles'), true);
      assert.equal(isPieceCategory('Glass Bangle Box'), true);
    });

    it('should identify standard packaging categories as non-piece categories', () => {
      assert.equal(isPieceCategory('Standard Box'), false);
      assert.equal(isPieceCategory('Sweet Box 1kg'), false);
      assert.equal(isPieceCategory('Corrugated Carton'), false);
      assert.equal(isPieceCategory(''), false);
      assert.equal(isPieceCategory(null), false);
      assert.equal(isPieceCategory(undefined), false);
    });
  });

  describe('Base Pay Calculations', () => {
    const dailyWage = 500;

    it('PRESENT gets 100% daily wage', () => {
      const calc = calculateWage(dailyWage, 'PRESENT');
      assert.equal(calc.basePay, 500);
      assert.equal(calc.statusDays, 1.0);
    });

    it('HALF_DAY gets 50% daily wage', () => {
      const calc = calculateWage(dailyWage, 'HALF_DAY');
      assert.equal(calc.basePay, 250);
      assert.equal(calc.statusDays, 0.5);
    });

    it('PAID_LEAVE gets 100% daily wage', () => {
      const calc = calculateWage(dailyWage, 'PAID_LEAVE');
      assert.equal(calc.basePay, 500);
      assert.equal(calc.statusDays, 1.0);
    });

    it('PAID_HOLIDAY gets 100% daily wage', () => {
      const calc = calculateWage(dailyWage, 'PAID_HOLIDAY');
      assert.equal(calc.basePay, 500);
      assert.equal(calc.statusDays, 1.0);
    });

    it('ABSENT gets 0 base pay', () => {
      const calc = calculateWage(dailyWage, 'ABSENT');
      assert.equal(calc.basePay, 0);
      assert.equal(calc.statusDays, 0.0);
    });
  });

  describe('Packaging Workers: Extra Box Overtime', () => {
    const dailyWage = 400;

    it('calculates extra boxes at default rate ₹30/box', () => {
      const calc = calculateWage(dailyWage, 'PRESENT', 0, 0, false, 0, 0, 10, 30, 'WORKER', 'Sweet Box');
      assert.equal(calc.extraBoxes, 10);
      assert.equal(calc.boxRate, 30);
      assert.equal(calc.overtimePay, 300); // 10 * 30
      assert.equal(calc.totalPay, 700);    // 400 base + 300 OT
    });

    it('respects custom box rate when provided', () => {
      const calc = calculateWage(dailyWage, 'PRESENT', 0, 0, false, 0, 0, 8, 45, 'WORKER', 'Heavy Box');
      assert.equal(calc.extraBoxes, 8);
      assert.equal(calc.boxRate, 45);
      assert.equal(calc.overtimePay, 360); // 8 * 45
      assert.equal(calc.totalPay, 760);    // 400 + 360
    });

    it('gives ₹0 overtime on Paid Day Off when worker takes leave', () => {
      const calc = calculateWage(dailyWage, 'PAID_LEAVE', 0, 0, false, 0, 0, 5, 30, 'WORKER', 'Box', 0, true);
      assert.equal(calc.basePay, 400);
      assert.equal(calc.overtimePay, 0);
      assert.equal(calc.totalPay, 400);
    });
  });

  describe('Cards & Bangles Business Rules (Piece Categories)', () => {
    const dailyWage = 450;

    it('disables overtime on normal working days for card categories', () => {
      const calc = calculateWage(
        dailyWage,
        'PRESENT',
        0, 0, false, 0, 0,
        15, 30,
        'WORKER',
        'Wedding Card',
        5000,
        false // Not a paid day off
      );
      assert.equal(calc.overtimePay, 0, 'Normal day card overtime must be ₹0');
      assert.equal(calc.totalPay, 450);
    });

    it('disables overtime on normal working days for bangle categories', () => {
      const calc = calculateWage(
        dailyWage,
        'PRESENT',
        0, 0, false, 0, 0,
        20, 30,
        'WORKER',
        'Glass Bangle',
        10000,
        false
      );
      assert.equal(calc.overtimePay, 0, 'Normal day bangle overtime must be ₹0');
      assert.equal(calc.totalPay, 450);
    });

    it('awards fixed ₹200 overtime for Cards worked on Paid Holiday / Tuesday', () => {
      const calc = calculateWage(
        dailyWage,
        'PRESENT',
        0, 0, true, // isHolidayWork = true
        0, 0, 10, 30,
        'WORKER',
        'Greeting Card',
        0,
        true // isPaidDayOff = true
      );
      assert.equal(calc.basePay, 450);
      assert.equal(calc.overtimePay, 200, 'Worked holiday card overtime must be exactly fixed ₹200');
      assert.equal(calc.totalPay, 650);
    });

    it('awards fixed ₹200 overtime for Bangles worked on Paid Holiday / Tuesday', () => {
      const calc = calculateWage(
        dailyWage,
        'HALF_DAY',
        0, 0, true,
        0, 0, 0, 30,
        'WORKER',
        'Fancy Bangles',
        0,
        true
      );
      assert.equal(calc.basePay, 225);
      assert.equal(calc.overtimePay, 200, 'Worked holiday bangle overtime must be exactly fixed ₹200');
      assert.equal(calc.totalPay, 425);
    });

    it('awards ₹0 overtime for Cards if ABSENT on Paid Holiday', () => {
      const calc = calculateWage(
        dailyWage,
        'ABSENT',
        0, 0, false,
        0, 0, 0, 30,
        'WORKER',
        'Wedding Card',
        0,
        true
      );
      assert.equal(calc.basePay, 0);
      assert.equal(calc.overtimePay, 0);
      assert.equal(calc.totalPay, 0);
    });
  });

  describe('Manager Business Rules', () => {
    const managerDailyWage = 1000;

    it('manager is exempt from box overtime even if extra boxes are provided', () => {
      const calc = calculateWage(
        managerDailyWage,
        'PRESENT',
        0, 0, false, 0, 0,
        50, 30, // 50 boxes passed
        'MANAGER',
        'Sweet Box'
      );
      assert.equal(calc.workCategory, '', 'Manager workCategory must always be empty string');
      assert.equal(calc.extraBoxes, 0, 'Manager extraBoxes must be 0');
      assert.equal(calc.extraPieces, 0, 'Manager extraPieces must be 0');
      assert.equal(calc.boxRate, 0, 'Manager boxRate must be 0');
      assert.equal(calc.overtimePay, 0);
      assert.equal(calc.isHolidayWork, false);
      assert.equal(calc.totalPay, 1000);
    });

    it('manager is exempt from piece categories and does not receive ₹200 holiday bonus on worked holiday', () => {
      const calc = calculateWage(
        managerDailyWage,
        'PRESENT',
        0, 0, true, 0, 0,
        0, 0,
        'MANAGER',
        'Wedding Card', // Piece category passed
        5000,           // 5000 pieces passed
        true            // Paid Day Off (Tuesday / Holiday)
      );
      assert.equal(calc.workCategory, '', 'Manager workCategory must be empty even if category provided');
      assert.equal(calc.extraBoxes, 0);
      assert.equal(calc.extraPieces, 0);
      assert.equal(calc.boxRate, 0);
      assert.equal(calc.isHolidayWork, false, 'Manager isHolidayWork must be false');
      assert.equal(calc.overtimePay, 0, 'Manager must NOT receive ₹200 holiday piece bonus');
      assert.equal(calc.basePay, 1000);
      assert.equal(calc.totalPay, 1000);
    });

    it('manager receives day-based overtime (otDays * dailyWage * multiplier)', () => {
      const calc = calculateWage(
        managerDailyWage,
        'PRESENT',
        1.5, // 1.5 days OT
        1.0, // 1.0x multiplier
        false, 0, 0, 0, 0,
        'MANAGER'
      );
      assert.equal(calc.basePay, 1000);
      assert.equal(calc.overtimeDays, 1.5);
      assert.equal(calc.overtimeMultiplier, 1.0);
      assert.equal(calc.overtimePay, 1500); // 1.5 * 1000 * 1.0
      assert.equal(calc.totalPay, 2500);
    });
  });

  describe('Bonuses & Deductions', () => {
    it('adds bonus and subtracts deduction accurately', () => {
      const calc = calculateWage(500, 'PRESENT', 0, 0, false, 150, 50, 0, 30, 'WORKER');
      assert.equal(calc.basePay, 500);
      assert.equal(calc.bonusAllowance, 150);
      assert.equal(calc.deduction, 50);
      assert.equal(calc.totalPay, 600); // 500 + 150 - 50
    });

    it('totalPay cannot be negative', () => {
      const calc = calculateWage(500, 'PRESENT', 0, 0, false, 0, 1000, 0, 30, 'WORKER');
      assert.equal(calc.totalPay, 0, 'totalPay clamped to minimum 0');
    });
  });
});
