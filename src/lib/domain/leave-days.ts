import { eachDay, isValidDateString, rangesOverlap, spanDays, weekdayOf, type ISODate, type Weekday } from './dates';

export interface Holiday {
  start_date: ISODate;
  end_date: ISODate;
}

export interface LeavePolicy {
  /** When on, weekends/holidays *between* two working leave days also count. */
  sandwichRule: boolean;
  weekendDays: readonly Weekday[] | readonly string[];
  holidays: readonly Holiday[];
}

/** Longest range a single leave record may cover. Protects the day-by-day loops. */
export const MAX_LEAVE_SPAN_DAYS = 366;

export interface DayBreakdown {
  /** Days charged against the balance. */
  days: number;
  calendarDays: number;
  workingDays: number;
  weekendDays: number;
  holidayDays: number;
  /** Off-days charged because the sandwich rule applied. */
  sandwichedDays: number;
}

function isHoliday(date: ISODate, holidays: readonly Holiday[]): boolean {
  return holidays.some((h) => date >= h.start_date && date <= h.end_date);
}

export function exceedsMaxSpan(start: ISODate, end: ISODate): boolean {
  return spanDays(start, end) > MAX_LEAVE_SPAN_DAYS;
}

/**
 * Days charged for a leave from `start` to `end` under `policy`.
 *
 * Weekends and holidays are never charged on their own. With the sandwich
 * rule on, an off-day is charged only when it falls strictly between two
 * working days of the same leave — a Thursday-to-Sunday leave with a
 * Friday/Saturday weekend charges Thu + Fri + Sat + Sun, but a leave that
 * merely starts or ends on a weekend does not charge those edge days.
 */
export function breakdownLeaveDays(start: ISODate, end: ISODate, isHalfDay: boolean, policy: LeavePolicy): DayBreakdown {
  const empty: DayBreakdown = { days: 0, calendarDays: 0, workingDays: 0, weekendDays: 0, holidayDays: 0, sandwichedDays: 0 };
  if (!isValidDateString(start) || !isValidDateString(end) || start > end || exceedsMaxSpan(start, end)) {
    return empty;
  }

  const weekend = new Set(policy.weekendDays.map((d) => d.toLowerCase().trim()));
  const kinds: ('work' | 'weekend' | 'holiday')[] = [];
  for (const date of eachDay(start, end)) {
    // A holiday on a weekend day is reported as a holiday.
    if (isHoliday(date, policy.holidays)) kinds.push('holiday');
    else if (weekend.has(weekdayOf(date))) kinds.push('weekend');
    else kinds.push('work');
  }

  const result: DayBreakdown = { ...empty, calendarDays: kinds.length };
  for (const k of kinds) {
    if (k === 'work') result.workingDays++;
    else if (k === 'weekend') result.weekendDays++;
    else result.holidayDays++;
  }

  if (policy.sandwichRule && result.workingDays > 0) {
    const first = kinds.indexOf('work');
    const last = kinds.lastIndexOf('work');
    for (let i = first + 1; i < last; i++) {
      if (kinds[i] !== 'work') result.sandwichedDays++;
    }
  }

  const charged = result.workingDays + result.sandwichedDays;
  result.days = isHalfDay ? (result.workingDays > 0 ? 0.5 : 0) : charged;
  return result;
}

export function countLeaveDays(start: ISODate, end: ISODate, isHalfDay: boolean, policy: LeavePolicy): number {
  return breakdownLeaveDays(start, end, isHalfDay, policy).days;
}

export interface ChargedLeave {
  start_date: ISODate;
  end_date: ISODate;
  actual_days: number;
}

/**
 * Portion of a recorded leave that falls inside [rangeStart, rangeEnd] —
 * used to split a 30 Jan–3 Feb leave between January and February payroll.
 *
 * The share is computed with the current policy and then scaled so the parts
 * of one record always sum to the `actual_days` that was charged when it was
 * recorded (settings or holidays may have changed since).
 */
export function chargedDaysWithin(record: ChargedLeave, rangeStart: ISODate, rangeEnd: ISODate, policy: LeavePolicy): number {
  if (!rangesOverlap(record.start_date, record.end_date, rangeStart, rangeEnd)) return 0;
  if (record.start_date >= rangeStart && record.end_date <= rangeEnd) return record.actual_days;
  if (record.actual_days === 0.5) {
    return record.start_date >= rangeStart && record.start_date <= rangeEnd ? 0.5 : 0;
  }

  const clipStart = record.start_date > rangeStart ? record.start_date : rangeStart;
  const clipEnd = record.end_date < rangeEnd ? record.end_date : rangeEnd;

  // Evaluate the sandwich rule on the whole record, then attribute each charged day.
  const whole = perDayCharges(record.start_date, record.end_date, policy);
  const total = whole.reduce((sum, d) => sum + d.charge, 0);
  const inside = whole.filter((d) => d.date >= clipStart && d.date <= clipEnd).reduce((sum, d) => sum + d.charge, 0);

  if (total === 0) {
    // Nothing chargeable under today's policy: fall back to calendar share.
    return roundToHalf((record.actual_days * spanDays(clipStart, clipEnd)) / spanDays(record.start_date, record.end_date));
  }
  return roundToHalf((record.actual_days * inside) / total);
}

function perDayCharges(start: ISODate, end: ISODate, policy: LeavePolicy): { date: ISODate; charge: number }[] {
  const weekend = new Set(policy.weekendDays.map((d) => d.toLowerCase().trim()));
  const days = [...eachDay(start, end)].map((date) => ({
    date,
    work: !isHoliday(date, policy.holidays) && !weekend.has(weekdayOf(date)),
  }));
  const first = days.findIndex((d) => d.work);
  const last = days.map((d) => d.work).lastIndexOf(true);
  return days.map((d, i) => ({
    date: d.date,
    charge: d.work || (policy.sandwichRule && first !== -1 && i > first && i < last) ? 1 : 0,
  }));
}

function roundToHalf(n: number): number {
  return Math.round(n * 2) / 2;
}
