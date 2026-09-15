import { parseCsv } from './csv';
import { isValidDateString, spanDays } from './dates';

// Parses a holiday list file: Title, StartDate, EndDate (optional).
// Accepts ISO dates (2026-03-26) and the day-first formats common in
// Bangladesh (26/03/2026, 26-03-2026, 26.03.2026). Pure: no database access.

export const MAX_HOLIDAY_SPAN_DAYS = 60;

export type HolidayRowStatus = 'new' | 'duplicate' | 'invalid';

export interface ParsedHolidayRow {
  line: number;
  title: string;
  start_date: string;
  end_date: string;
  status: HolidayRowStatus;
  problem?: string;
}

/** Converts a typed date to YYYY-MM-DD, or null if it isn't a real date. */
export function normaliseDate(raw: string): string | null {
  const value = raw.trim();
  if (isValidDateString(value)) return value;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isValidDateString(iso) ? iso : null;
}

export function parseHolidayCsv(text: string, existing: { title: string; start_date: string; end_date: string }[]): ParsedHolidayRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  // Skip a header row if the second column doesn't look like a date.
  const first = rows[0];
  const hasHeader = first.length >= 2 && !normaliseDate(first[1] ?? '');
  const body = hasHeader ? rows.slice(1) : rows;
  const offset = hasHeader ? 2 : 1;

  const key = (title: string, start: string, end: string) => `${title.toLowerCase()}|${start}|${end}`;
  const seen = new Set(existing.map((h) => key(h.title, h.start_date, h.end_date)));

  return body.map((cols, i) => {
    const line = i + offset;
    const title = (cols[0] ?? '').trim();
    const start = normaliseDate(cols[1] ?? '');
    const end = (cols[2] ?? '').trim() ? normaliseDate(cols[2]) : start;
    const row: ParsedHolidayRow = { line, title, start_date: start ?? (cols[1] ?? ''), end_date: end ?? (cols[2] ?? ''), status: 'new' };

    if (!title) return { ...row, status: 'invalid', problem: 'The holiday name is missing.' };
    if (title.length > 100) return { ...row, status: 'invalid', problem: 'The holiday name is longer than 100 characters.' };
    if (!start) return { ...row, status: 'invalid', problem: `“${cols[1] ?? ''}” is not a date. Use 2026-03-26 or 26/03/2026.` };
    if (!end) return { ...row, status: 'invalid', problem: `“${cols[2]}” is not a date. Use 2026-03-26 or 26/03/2026.` };
    if (end < start) return { ...row, status: 'invalid', problem: 'The end date is before the start date.' };
    if (spanDays(start, end) > MAX_HOLIDAY_SPAN_DAYS) return { ...row, status: 'invalid', problem: `A holiday can span at most ${MAX_HOLIDAY_SPAN_DAYS} days.` };

    const k = key(title, start, end);
    if (seen.has(k)) return { ...row, status: 'duplicate', problem: 'Already in the holiday list.' };
    seen.add(k);
    return row;
  });
}
