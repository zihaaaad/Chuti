import { describe, expect, it } from 'vitest';
import { breakdownLeaveDays, chargedDaysWithin, countLeaveDays, exceedsMaxSpan, type LeavePolicy } from './leave-days';

// 2026-10-01 is a Thursday. Weekend is Friday + Saturday (Bangladesh default).
const base: LeavePolicy = { sandwichRule: false, weekendDays: ['friday', 'saturday'], holidays: [] };
const sandwich: LeavePolicy = { ...base, sandwichRule: true };

describe('countLeaveDays', () => {
  it('counts only working days when the sandwich rule is off', () => {
    // Thu 1 → Sun 4: Thu, Sun are working
    expect(countLeaveDays('2026-10-01', '2026-10-04', false, base)).toBe(2);
  });

  it('charges weekends sandwiched between working days when the rule is on', () => {
    expect(countLeaveDays('2026-10-01', '2026-10-04', false, sandwich)).toBe(4);
  });

  it('does not charge weekends at the edges of a leave under the sandwich rule', () => {
    // Fri 2 → Sun 4: Fri/Sat lead the range, only Sun is a working day
    expect(countLeaveDays('2026-10-02', '2026-10-04', false, sandwich)).toBe(1);
    // Thu 1 → Sat 3: trailing weekend not charged
    expect(countLeaveDays('2026-10-01', '2026-10-03', false, sandwich)).toBe(1);
  });

  it('excludes holidays and sandwiches them like weekends', () => {
    const policy: LeavePolicy = { ...sandwich, holidays: [{ start_date: '2026-10-05', end_date: '2026-10-05' }] };
    // Sun 4 working, Mon 5 holiday, Tue 6 working
    expect(countLeaveDays('2026-10-04', '2026-10-06', false, policy)).toBe(3);
    expect(countLeaveDays('2026-10-04', '2026-10-06', false, { ...policy, sandwichRule: false })).toBe(2);
  });

  it('returns 0.5 for a half day on a working day and 0 on a weekend', () => {
    expect(countLeaveDays('2026-10-01', '2026-10-01', true, base)).toBe(0.5);
    expect(countLeaveDays('2026-10-02', '2026-10-02', true, sandwich)).toBe(0);
  });

  it('returns 0 for reversed, invalid, or oversized ranges', () => {
    expect(countLeaveDays('2026-10-04', '2026-10-01', false, base)).toBe(0);
    expect(countLeaveDays('2026-02-30', '2026-03-01', false, base)).toBe(0);
    expect(exceedsMaxSpan('2026-01-01', '2027-01-02')).toBe(true);
    expect(countLeaveDays('2026-01-01', '2126-01-01', false, base)).toBe(0);
  });

  it('treats an empty weekend list as a seven-day work week', () => {
    expect(countLeaveDays('2026-10-01', '2026-10-07', false, { ...base, weekendDays: [] })).toBe(7);
  });

  it('reports a breakdown the leave form can show', () => {
    const b = breakdownLeaveDays('2026-10-01', '2026-10-04', false, sandwich);
    expect(b).toMatchObject({ calendarDays: 4, workingDays: 2, weekendDays: 2, sandwichedDays: 2, days: 4 });
  });
});

describe('chargedDaysWithin', () => {
  it('returns the full charge when the record sits inside the range', () => {
    expect(chargedDaysWithin({ start_date: '2026-10-01', end_date: '2026-10-04', actual_days: 2 }, '2026-10-01', '2026-10-31', base)).toBe(2);
  });

  it('splits a cross-month leave so both months sum to the recorded days', () => {
    // Wed 2026-09-30 → Sun 2026-10-04 (sandwich off): Sep 30, Oct 1, Oct 4 = 3 days
    const rec = { start_date: '2026-09-30', end_date: '2026-10-04', actual_days: 3 };
    const sep = chargedDaysWithin(rec, '2026-09-01', '2026-09-30', base);
    const oct = chargedDaysWithin(rec, '2026-10-01', '2026-10-31', base);
    expect(sep).toBe(1);
    expect(oct).toBe(2);
    expect(sep + oct).toBe(3);
  });

  it('counts a leave that covers a whole month in that month', () => {
    const rec = { start_date: '2026-01-15', end_date: '2026-03-15', actual_days: 60 };
    expect(chargedDaysWithin(rec, '2026-02-01', '2026-02-28', { ...base, weekendDays: [] })).toBe(28);
  });

  it('returns 0 when there is no overlap', () => {
    expect(chargedDaysWithin({ start_date: '2026-10-01', end_date: '2026-10-02', actual_days: 1 }, '2026-11-01', '2026-11-30', base)).toBe(0);
  });
});
