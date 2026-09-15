import { describe, expect, it } from 'vitest';
import yauzl from 'yauzl';
import { buildXlsx, columnLetter, escapeXml } from './xlsx';

async function unzip(buffer: Buffer): Promise<Record<string, string>> {
  const zip = await yauzl.fromBufferPromise(buffer, { lazyEntries: true });
  const files: Record<string, string> = {};
  await new Promise<void>((resolve, reject) => {
    zip.on('error', reject);
    zip.on('end', resolve);
    zip.on('entry', async (entry: yauzl.Entry) => {
      const stream = await zip.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        files[entry.fileName] = Buffer.concat(chunks).toString('utf8');
        zip.readEntry();
      });
    });
    zip.readEntry();
  });
  return files;
}

/** Tag balance check: every opened element is closed in order (catches malformed XML). */
function assertWellFormed(xml: string) {
  const stack: string[] = [];
  for (const m of xml.replace(/<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([A-Za-z:]+)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = m;
    if (selfClosing) continue;
    if (closing) expect(stack.pop()).toBe(name);
    else stack.push(name);
  }
  expect(stack).toEqual([]);
}

describe('xlsx writer', () => {
  it('builds a standard package with well-formed parts', async () => {
    const buffer = await buildXlsx([
      { name: 'Payroll', title: ['Green School', 'Payroll summary · September 2026'], columns: [{ header: 'Name', width: 24 }, { header: 'LWP', type: 'number' }], rows: [['Rahim', 2], ['Karim', 0]] },
      { name: 'Payroll', columns: [{ header: 'X' }], rows: [] },
    ]);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const files = await unzip(buffer);
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
    ]);
    for (const xml of Object.values(files)) assertWellFormed(xml);
    expect(files['xl/workbook.xml']).toContain('name="Payroll (2)"');
    const sheet = files['xl/worksheets/sheet1.xml'];
    expect(sheet).toContain('<c r="A4" s="1" t="inlineStr"><is><t>Name</t></is></c>');
    expect(sheet).toContain('<c r="B5" s="2"><v>2</v></c>');
    expect(sheet).toContain('<autoFilter ref="A4:B6"/>');
  });

  it('writes formulas and markup as literal text and strips invalid characters', async () => {
    const files = await unzip(await buildXlsx([{ name: 'X', columns: [{ header: 'Reason' }], rows: [['=HYPERLINK("http://evil")'], ['<b>&"quote"</b>']] }]));
    const sheet = files['xl/worksheets/sheet1.xml'];
    expect(sheet).not.toContain('<f>');
    expect(sheet).toContain('<t>=HYPERLINK(&quot;http://evil&quot;)</t>');
    expect(sheet).toContain('<t>&lt;b&gt;&amp;&quot;quote&quot;&lt;/b&gt;</t>');
    assertWellFormed(sheet);
  });

  it('computes column letters', () => {
    expect([0, 25, 26, 51, 701, 702].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AZ', 'ZZ', 'AAA']);
    expect(escapeXml('a\u0000\u0007b')).toBe('ab');
  });
});
