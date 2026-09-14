// Calendar-date helpers. All leave maths works on plain `YYYY-MM-DD` strings
// interpreted as UTC midnight, so results never shift with the host timezone.
// "Today" is the one exception: it must be the *local* calendar date, because
// an admin in Dhaka (UTC+6) recording a leave at 05:00 means today, not the
// UTC yesterday that `new Date().toISOString()` would give.

export type ISODate = string;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export function isValidDateString(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

export function isValidMonthString(value: unknown): value is string {
  return typeof value === 'string' && MONTH_RE.test(value);
}

export function parseISODate(value: ISODate): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatISODate(date: Date): ISODate {
  return date.toISOString().slice(0, 10);
}

export function addDays(value: ISODate, days: number): ISODate {
  const d = parseISODate(value);
  d.setUTCDate(d.getUTCDate() + days);
  return formatISODate(d);
}

/** Inclusive number of calendar days from start to end (1 when equal). */
export function spanDays(start: ISODate, end: ISODate): number {
  return Math.floor((parseISODate(end).getTime() - parseISODate(start).getTime()) / DAY_MS) + 1;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** First and last calendar day of a `YYYY-MM` month. */
export function monthBounds(month: string): { start: ISODate; end: ISODate } {
  const [year, m] = month.split('-').map(Number);
  return {
    start: `${month}-01`,
    end: `${month}-${String(daysInMonth(year, m)).padStart(2, '0')}`,
  };
}

export function weekdayOf(value: ISODate): Weekday {
  return WEEKDAYS[parseISODate(value).getUTCDay()];
}

/** Yields every date from start to end inclusive. */
export function* eachDay(start: ISODate, end: ISODate): Generator<ISODate> {
  const current = parseISODate(start);
  const last = parseISODate(end).getTime();
  while (current.getTime() <= last) {
    yield formatISODate(current);
    current.setUTCDate(current.getUTCDate() + 1);
  }
}

export function rangesOverlap(aStart: ISODate, aEnd: ISODate, bStart: ISODate, bEnd: ISODate): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}

/** The local calendar date on this machine, as YYYY-MM-DD. */
export function todayLocal(now: Date = new Date()): ISODate {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function currentMonthLocal(now: Date = new Date()): string {
  return todayLocal(now).slice(0, 7);
}

/** "12 Oct 2026" — unambiguous across locales, used in UI and print. */
export function formatDisplayDate(value: ISODate): string {
  if (!isValidDateString(value)) return value;
  return parseISODate(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function formatDisplayRange(start: ISODate, end: ISODate): string {
  return start === end ? formatDisplayDate(start) : `${formatDisplayDate(start)} – ${formatDisplayDate(end)}`;
}
