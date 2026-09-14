import { describe, expect, it } from 'vitest';
import { hasOverlapConflict } from './overlap';
import { carryForward, lateDeduction, remainingDays } from './balance';
import { isValidDateString, isValidMonthString, monthBounds, todayLocal } from './dates';

describe('hasOverlapConflict', () => {
  const existing = [
    { id: 1, start_date: '2026-10-05', end_date: '2026-10-07', actual_days: 3 },
    { id: 2, start_date: '2026-10-10', end_date: '2026-10-10', actual_days: 0.5 },
  ];

  it('detects a full-day clash', () => {
    expect(hasOverlapConflict('2026-10-07', '2026-10-08', false, existing)).toBe(true);
  });

  it('allows a second half day but not a full day on a half-day date', () => {
    expect(hasOverlapConflict('2026-10-10', '2026-10-10', true, existing)).toBe(false);
    expect(hasOverlapConflict('2026-10-10', '2026-10-10', false, existing)).toBe(true);
  });

  it('ignores the record being edited', () => {
    expect(hasOverlapConflict('2026-10-05', '2026-10-06', false, existing, 1)).toBe(false);
  });

  it('passes when ranges only touch', () => {
    expect(hasOverlapConflict('2026-10-08', '2026-10-09', false, existing)).toBe(false);
  });
});

describe('balances', () => {
  it('includes carry-forward and encashment in the remaining balance', () => {
    expect(remainingDays({ allocated_days: 15, carried_forward: 5, used_days: 4, encashed_days: 2 })).toBe(14);
    expect(remainingDays({ allocated_days: 10, used_days: 3 })).toBe(7);
  });

  it('deducts one CL per full threshold of lates', () => {
    expect(lateDeduction(2, 3)).toBe(0);
    expect(lateDeduction(7, 3)).toBe(2);
    expect(lateDeduction(5, 0)).toBe(5); // threshold is clamped to 1
    expect(lateDeduction(-1, 3)).toBe(0);
  });

  it('caps carry-forward and never goes negative', () => {
    expect(carryForward(22, 15)).toBe(15);
    expect(carryForward(4.5, 15)).toBe(4.5);
    expect(carryForward(-3, 15)).toBe(0);
  });
});

describe('dates', () => {
  it('validates calendar dates and months', () => {
    expect(isValidDateString('2028-02-29')).toBe(true);
    expect(isValidDateString('2026-02-29')).toBe(false);
    expect(isValidMonthString('2026-13')).toBe(false);
    expect(isValidMonthString('2026-09')).toBe(true);
  });

  it('computes month bounds', () => {
    expect(monthBounds('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });

  it('uses the local calendar date, not UTC', () => {
    // 05:00 local on 1 Oct must be 1 Oct regardless of the UTC offset.
    expect(todayLocal(new Date(2026, 9, 1, 5, 0))).toBe('2026-10-01');
  });
});
