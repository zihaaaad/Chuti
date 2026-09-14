import { toCsv } from './domain/csv';

/**
 * Saves rows as a CSV file. Uses a Blob (data: URIs break on large files) and
 * a UTF-8 BOM so Excel shows Bangla names correctly.
 */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const blob = new Blob([String.fromCharCode(0xfeff), toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
