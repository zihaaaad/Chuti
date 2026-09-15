import { describe, expect, it } from 'vitest';
import { normaliseDate, parseHolidayCsv } from './holidays-csv';

describe('normaliseDate', () => {
  it('accepts ISO and day-first formats and rejects impossible dates', () => {
    expect(normaliseDate('2026-03-26')).toBe('2026-03-26');
    expect(normaliseDate('26/03/2026')).toBe('2026-03-26');
    expect(normaliseDate('1-5-2026')).toBe('2026-05-01');
    expect(normaliseDate('21.02.2026')).toBe('2026-02-21');
    expect(normaliseDate('31/02/2026')).toBeNull();
    expect(normaliseDate('March 26')).toBeNull();
  });
});

describe('parseHolidayCsv', () => {
  const existing = [{ title: 'Victory Day', start_date: '2026-12-16', end_date: '2026-12-16' }];

  it('reads a file with a header, marks duplicates and explains invalid rows', () => {
    const csv = [
      'Title,StartDate,EndDate',
      'International Mother Language Day,21/02/2026,',
      'Eid-ul-Fitr,2026-03-20,2026-03-23',
      'victory day,2026-12-16,2026-12-16',
      ',2026-05-01,',
      'Bad Range,2026-06-10,2026-06-01',
      'Not a date,sometime,',
      'Eid-ul-Fitr,2026-03-20,2026-03-23',
    ].join('\n');
    const rows = parseHolidayCsv(csv, existing);
    expect(rows.map((r) => [r.line, r.status])).toEqual([
      [2, 'new'],
      [3, 'new'],
      [4, 'duplicate'],
      [5, 'invalid'],
      [6, 'invalid'],
      [7, 'invalid'],
      [8, 'duplicate'],
    ]);
    expect(rows[0]).toMatchObject({ start_date: '2026-02-21', end_date: '2026-02-21' });
    expect(rows[4].problem).toMatch(/before the start/);
    expect(rows[5].problem).toMatch(/not a date/);
  });

  it('works without a header and rejects very long spans', () => {
    const rows = parseHolidayCsv('Summer break,2026-05-01,2026-08-01', []);
    expect(rows[0]).toMatchObject({ line: 1, status: 'invalid' });
    expect(rows[0].problem).toMatch(/at most 60 days/);
  });
});
