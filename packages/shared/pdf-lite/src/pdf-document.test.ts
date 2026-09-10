import { describe, expect, it } from 'vitest';
import { inspectPdf, isPdfBuffer } from './inspect.js';
import { PdfDocument, PdfFlow, encodePdfString, wrapText } from './pdf-document.js';

describe('pdf-lite — PdfDocument', () => {
  it('emits a structurally valid single-page PDF 1.4', () => {
    const doc = new PdfDocument({ title: 'Test', creationDate: new Date('2026-01-01T00:00:00Z') });
    const p = doc.addPage();
    doc.text(p, 50, 800, 'Hello (PDF) \\ world');
    const bytes = doc.toBuffer();

    expect(isPdfBuffer(bytes)).toBe(true);
    const info = inspectPdf(bytes);
    expect(info.version).toBe('1.4');
    expect(info.pageCount).toBe(1);
    expect(info.hasXref).toBe(true);
    expect(info.hasEof).toBe(true);
    expect(info.startXrefValid).toBe(true);
    expect(info.literalStrings).toContain('Hello (PDF) \\ world');
  });

  it('writes accurate xref byte offsets for every object', () => {
    const doc = new PdfDocument();
    doc.addPage();
    doc.addPage();
    const text = doc.toBuffer().toString('latin1');
    const xrefStart = text.indexOf('\nxref\n') + 1;
    const lines = text.slice(xrefStart).split('\n');
    const count = Number(lines[1]!.split(' ')[1]);
    // Entries start at lines[3] (skip "xref", "0 N", and the free entry).
    for (let i = 1; i < count; i++) {
      const entry = lines[2 + i]!;
      const offset = Number(entry.slice(0, 10));
      expect(text.slice(offset, offset + `${i} 0 obj`.length)).toBe(`${i} 0 obj`);
    }
  });

  it('coerces non-Latin-1 characters and escapes delimiters', () => {
    expect(encodePdfString('a(b)c\\d')).toBe('a\\(b\\)c\\\\d');
    expect(encodePdfString('caf\u00e9 \u4e2d')).toBe('caf\u00e9 ?');
    expect(encodePdfString('line\nbreak')).toBe('line break');
  });

  it('always has at least one page', () => {
    expect(inspectPdf(new PdfDocument().toBuffer()).pageCount).toBe(1);
  });
});

describe('pdf-lite — PdfFlow', () => {
  it('breaks onto new pages automatically and numbers footers', () => {
    const flow = new PdfFlow(new PdfDocument(), {
      header: 'Header',
      footer: 'Page {page} of {pages}',
    });
    flow.heading('Long document');
    for (let i = 0; i < 120; i++) flow.paragraph(`Paragraph ${i} with some words to wrap around.`);
    const bytes = flow.finish();
    const info = inspectPdf(bytes);
    expect(info.pageCount).toBeGreaterThan(1);
    expect(info.literalStrings).toContain(`Page 1 of ${info.pageCount}`);
    expect(info.literalStrings).toContain(`Page ${info.pageCount} of ${info.pageCount}`);
    expect(info.literalStrings.filter((s) => s === 'Header')).toHaveLength(info.pageCount);
  });

  it('renders tables with header + rows and key/value pairs', () => {
    const flow = new PdfFlow(new PdfDocument());
    flow.keyValue('Student', 'Ada Lovelace');
    flow.table(
      [{ header: 'Subject' }, { header: 'Score', align: 'right' }],
      [
        ['Mathematics', '98'],
        ['Physics', '91'],
      ],
    );
    const info = inspectPdf(flow.finish());
    for (const s of [
      'Student',
      'Ada Lovelace',
      'Subject',
      'Score',
      'Mathematics',
      '98',
      'Physics',
      '91',
    ]) {
      expect(info.literalStrings).toContain(s);
    }
  });

  it('wraps text greedily by approximate width', () => {
    const lines = wrapText('one two three four five six seven eight nine ten', 100, 10);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('one two three four five six seven eight nine ten');
    expect(wrapText('', 100, 10)).toEqual(['']);
  });
});
