import { describe, expect, it } from 'vitest';
import { csvCell, parseCsv, toCsv } from './csv';

describe('parseCsv', () => {
  it('handles quotes, embedded commas, escaped quotes and CRLF', () => {
    const text = '﻿ID,Name\r\nEMP-1,"Hasan, Zihad"\r\nEMP-2,"Says ""hi"""\r\n';
    expect(parseCsv(text)).toEqual([
      ['ID', 'Name'],
      ['EMP-1', 'Hasan, Zihad'],
      ['EMP-2', 'Says "hi"'],
    ]);
  });

  it('keeps newlines inside quoted fields and drops blank lines', () => {
    expect(parseCsv('a,"line1\nline2"\n\n b , c ')).toEqual([
      ['a', 'line1\nline2'],
      ['b', 'c'],
    ]);
  });
});

describe('csvCell', () => {
  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-2+3')).toBe(`"'-2+3"`);
  });

  it('round-trips through parseCsv', () => {
    const rows = [['Name', 'Reason'], ['Rahim', 'Fever, cough']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
