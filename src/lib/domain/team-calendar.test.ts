import { describe, expect, it } from 'vitest';
import { calendarDays, dailyAbsence, placeLeaves, type CalendarLeave } from './team-calendar';
import type { LeavePolicy } from './leave-days';

const holidays = [{ title: 'Independence Day', start_date: '2026-03-26', end_date: '2026-03-26' }];
const policy: LeavePolicy = { sandwichRule: false, weekendDays: ['friday', 'saturday'], holidays };
const days = calendarDays('2026-03', ['friday', 'saturday'], holidays);

const leave = (over: Partial<CalendarLeave>): CalendarLeave => ({
  id: 1, employee_id: 7, leave_type: 'Casual', start_date: '2026-03-02', end_date: '2026-03-02', actual_days: 1, ...over,
});

describe('calendarDays', () => {
  it('lists every day of the month with weekends and holidays marked', () => {
    expect(days).toHaveLength(31);
    expect(days[5]).toMatchObject({ date: '2026-03-06', weekday: 'friday', off: 'weekend' });
    expect(days[25]).toMatchObject({ date: '2026-03-26', off: 'holiday', holiday: 'Independence Day' });
    expect(days[1]).toMatchObject({ day: 2, off: null });
  });
});

describe('placeLeaves', () => {
  it('marks charged days and leaves unchargeable off-days visibly uncharged', () => {
    // Thu 5 Mar to Sun 8 Mar: Fri and Sat are the weekend.
    const rows = placeLeaves(days, [leave({ start_date: '2026-03-05', end_date: '2026-03-08', actual_days: 2 })], policy);
    const row = rows.get(7)!;
    expect(row.slice(4, 8).map((c) => c?.charged)).toEqual([true, false, false, true]);
    expect(row[4]?.start).toBe(true);
    expect(row[7]?.start).toBe(false);
    expect(row[3]).toBeNull();
  });

  it('charges sandwiched off-days when the rule is on', () => {
    const rows = placeLeaves(days, [leave({ start_date: '2026-03-05', end_date: '2026-03-08', actual_days: 4 })], { ...policy, sandwichRule: true });
    expect(rows.get(7)!.slice(4, 8).every((c) => c?.charged)).toBe(true);
  });

  it('clips leave that spans months and labels its first visible day', () => {
    const rows = placeLeaves(days, [leave({ start_date: '2026-02-26', end_date: '2026-03-03', actual_days: 4 })], policy);
    const row = rows.get(7)!;
    expect(row[0]).toMatchObject({ start: true, range: ['2026-02-26', '2026-03-03'] });
    expect(row[3]).toBeNull();
  });

  it('counts daily absence with half days as half', () => {
    const rows = placeLeaves(days, [
      leave({ id: 1, employee_id: 1, start_date: '2026-03-02', end_date: '2026-03-03', actual_days: 2 }),
      leave({ id: 2, employee_id: 2, start_date: '2026-03-02', end_date: '2026-03-02', actual_days: 0.5 }),
    ], policy);
    expect(rows.get(2)![1]).toMatchObject({ half: true, charged: true });
    const totals = dailyAbsence(days, rows.values());
    expect(totals.slice(0, 4)).toEqual([0, 1.5, 1, 0]);
  });
});
