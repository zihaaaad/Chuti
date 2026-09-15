import { eachDay, monthBounds, rangesOverlap, weekdayOf, type ISODate, type Weekday } from './dates';
import { perDayCharges, type LeavePolicy } from './leave-days';

// Month grid for the team leave calendar: one row per employee, one column per day.

export interface CalendarHoliday {
  title: string;
  start_date: ISODate;
  end_date: ISODate;
}

export interface CalendarDay {
  date: ISODate;
  day: number;
  weekday: Weekday;
  /** Why nobody works that day, if nobody does. A holiday wins over a weekend. */
  off: 'weekend' | 'holiday' | null;
  holiday?: string;
}

export interface CalendarLeave {
  id: number;
  employee_id: number;
  leave_type: string;
  start_date: ISODate;
  end_date: ISODate;
  actual_days: number;
}

export interface CalendarCell {
  recordId: number;
  type: string;
  /** Half-day leave. */
  half: boolean;
  /** False for a weekend or holiday inside the leave that was not charged. */
  charged: boolean;
  /** First day of this leave shown in the month (where the label goes). */
  start: boolean;
  /** The leave's full range, for tooltips. */
  range: [ISODate, ISODate];
}

export function calendarDays(month: string, weekendDays: readonly string[], holidays: readonly CalendarHoliday[]): CalendarDay[] {
  const { start, end } = monthBounds(month);
  const weekend = new Set(weekendDays.map((d) => d.toLowerCase().trim()));
  return [...eachDay(start, end)].map((date) => {
    const weekday = weekdayOf(date);
    const holiday = holidays.find((h) => date >= h.start_date && date <= h.end_date);
    return {
      date,
      day: Number(date.slice(8, 10)),
      weekday,
      off: holiday ? 'holiday' : weekend.has(weekday) ? 'weekend' : null,
      ...(holiday ? { holiday: holiday.title } : {}),
    };
  });
}

/**
 * Lays each employee's leave onto the month's days. Returns one array per
 * employee with a cell (or null) for every day in `days`.
 */
export function placeLeaves(days: readonly CalendarDay[], leaves: readonly CalendarLeave[], policy: LeavePolicy): Map<number, (CalendarCell | null)[]> {
  const rows = new Map<number, (CalendarCell | null)[]>();
  if (days.length === 0) return rows;
  const first = days[0].date;
  const last = days[days.length - 1].date;
  const index = new Map(days.map((d, i) => [d.date, i]));

  const sorted = [...leaves].sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : a.id - b.id));
  for (const leave of sorted) {
    if (!rangesOverlap(leave.start_date, leave.end_date, first, last)) continue;
    let row = rows.get(leave.employee_id);
    if (!row) {
      row = days.map(() => null);
      rows.set(leave.employee_id, row);
    }
    const half = leave.actual_days === 0.5 && leave.start_date === leave.end_date;
    let placedStart = false;
    for (const { date, charge } of perDayCharges(leave.start_date, leave.end_date, policy)) {
      const i = index.get(date);
      if (i === undefined || row[i]) continue; // outside the month, or already taken by an earlier record
      row[i] = {
        recordId: leave.id,
        type: leave.leave_type,
        half,
        // A half day on an off-day still shows as charged: it was recorded that way.
        charged: charge > 0 || half,
        start: !placedStart,
        range: [leave.start_date, leave.end_date],
      };
      placedStart = true;
    }
  }
  return rows;
}

/** People on charged leave each day (a half day counts as half). */
export function dailyAbsence(days: readonly CalendarDay[], rows: Iterable<(CalendarCell | null)[]>): number[] {
  const totals = days.map(() => 0);
  for (const row of rows) {
    row.forEach((cell, i) => {
      if (cell?.charged) totals[i] += cell.half ? 0.5 : 1;
    });
  }
  return totals;
}
