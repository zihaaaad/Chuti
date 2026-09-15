import yazl from 'yazl';

// Minimal .xlsx (Office Open XML SpreadsheetML) writer.
//
// Produces the smallest standard package Excel, LibreOffice and Google Sheets
// open: content types, relationships, workbook, styles and one worksheet per
// sheet. Text is written as inline strings (t="inlineStr"), never as formulas,
// so a cell starting with "=" is shown literally — no spreadsheet formula
// injection, unlike CSV.

export type CellValue = string | number | null | undefined;

export interface SheetColumn {
  header: string;
  width?: number;
  /** 'number' right-aligns and keeps numeric values numeric; 'text' forces text. */
  type?: 'text' | 'number';
}

export interface Sheet {
  name: string;
  /** Optional lines shown above the table (e.g. organisation, report title, filters). */
  title?: string[];
  columns: SheetColumn[];
  rows: CellValue[][];
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// Characters XML 1.0 forbids (control chars except tab, LF, CR).
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

export function escapeXml(value: string): string {
  return value
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 0 → A, 25 → Z, 26 → AA */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Sheet names: max 31 chars, none of : \ / ? * [ ], unique. */
function safeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let candidate = base;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${i++})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  base = candidate;
  return base;
}

// Style indices (see styles.xml below): 0 default, 1 bold header, 2 number, 3 title.
function cellXml(ref: string, value: CellValue, style: number, type?: 'text' | 'number'): string {
  if (value === null || value === undefined || value === '') return '';
  const s = style ? ` s="${style}"` : '';
  if (typeof value === 'number' && type !== 'text' && Number.isFinite(value)) {
    return `<c r="${ref}"${s}><v>${value}</v></c>`;
  }
  const text = escapeXml(String(value));
  const space = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}"${s} t="inlineStr"><is><t${space}>${text}</t></is></c>`;
}

function worksheetXml(sheet: Sheet): string {
  const titleLines = sheet.title ?? [];
  const headerRow = titleLines.length ? titleLines.length + 2 : 1;
  const rows: string[] = [];

  titleLines.forEach((line, i) => {
    rows.push(`<row r="${i + 1}">${cellXml(`A${i + 1}`, line, i === 0 ? 3 : 0)}</row>`);
  });

  rows.push(
    `<row r="${headerRow}">${sheet.columns.map((c, i) => cellXml(`${columnLetter(i)}${headerRow}`, c.header, 1, 'text')).join('')}</row>`,
  );
  sheet.rows.forEach((row, r) => {
    const rowNumber = headerRow + 1 + r;
    const cells = sheet.columns
      .map((c, i) => cellXml(`${columnLetter(i)}${rowNumber}`, row[i], c.type === 'number' ? 2 : 0, c.type))
      .join('');
    rows.push(`<row r="${rowNumber}">${cells}</row>`);
  });

  const lastCol = columnLetter(Math.max(0, sheet.columns.length - 1));
  const lastRow = headerRow + sheet.rows.length;
  const cols = sheet.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 16}" customWidth="1"/>`).join('');

  return (
    XML_HEADER +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${rows.join('')}</sheetData>` +
    (sheet.rows.length ? `<autoFilter ref="A${headerRow}:${lastCol}${lastRow}"/>` : '') +
    '</worksheet>'
  );
}

const STYLES_XML =
  XML_HEADER +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6F1EA"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right"/></xf>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/** Builds the workbook and resolves to the .xlsx bytes. */
export function buildXlsx(sheets: Sheet[]): Promise<Buffer> {
  if (sheets.length === 0) throw new Error('A workbook needs at least one sheet.');
  const used = new Set<string>();
  const names = sheets.map((s) => safeSheetName(s.name, used));

  const zip = new yazl.ZipFile();
  const add = (path: string, content: string) => zip.addBuffer(Buffer.from(content, 'utf8'), path);

  add(
    '[Content_Types].xml',
    XML_HEADER +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '</Types>',
  );
  add(
    '_rels/.rels',
    XML_HEADER +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
  );
  add(
    'xl/workbook.xml',
    XML_HEADER +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets>${names.map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
      '</workbook>',
  );
  add(
    'xl/_rels/workbook.xml.rels',
    XML_HEADER +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>',
  );
  add('xl/styles.xml', STYLES_XML);
  sheets.forEach((sheet, i) => add(`xl/worksheets/sheet${i + 1}.xml`, worksheetXml(sheet)));
  zip.end();

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
  });
}
