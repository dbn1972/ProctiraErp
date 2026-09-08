/**
 * Minimal, dependency-free PDF 1.4 writer (G-716).
 *
 * Produces real, spec-conformant PDF bytes that open in every mainstream
 * viewer: a Catalog → Pages → Page tree, one content stream per page, and the
 * standard-14 Helvetica / Helvetica-Bold fonts (which viewers must ship, so no
 * font embedding is required). Text is WinAnsi encoded; characters outside
 * Latin-1 are replaced with `?` rather than producing corrupt output.
 *
 * Two layers are exposed:
 *  - `PdfDocument` — low-level page primitives (`text`, `line`, `rect`).
 *  - `PdfFlow`     — a cursor-driven layout helper (headings, paragraphs,
 *                    key/value rows, tables) with automatic page breaks. This
 *                    is what the report-card / transcript / exam generators use.
 */

export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;

export type PdfFont = 'regular' | 'bold';

export interface TextOptions {
  size?: number;
  font?: PdfFont;
  /** 0–1 grey level (0 = black). */
  grey?: number;
}

interface PageState {
  ops: string[];
}

/** Average Helvetica glyph advance as a fraction of the font size. */
const AVG_GLYPH_WIDTH = 0.52;

/** Approximate rendered width of a string in points. */
export function measureText(text: string, size: number): number {
  return text.length * size * AVG_GLYPH_WIDTH;
}

/**
 * Escapes a string for a PDF literal string and coerces it to Latin-1.
 * Backslash, parentheses and line breaks are escaped; everything outside
 * 0x20–0xFF becomes `?`.
 */
export function encodePdfString(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    if (ch === '\\' || ch === '(' || ch === ')') {
      out += `\\${ch}`;
    } else if (ch === '\n' || ch === '\r') {
      out += ' ';
    } else if (code < 0x20 || code > 0xff) {
      out += '?';
    } else {
      out += ch;
    }
  }
  return out;
}

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export class PdfDocument {
  private readonly pages: PageState[] = [];
  private readonly title: string;
  private readonly author: string;
  private readonly creationDate: Date;

  constructor(options: { title?: string; author?: string; creationDate?: Date } = {}) {
    this.title = options.title ?? 'Document';
    this.author = options.author ?? 'ProctiraERP';
    this.creationDate = options.creationDate ?? new Date();
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /** Starts a new A4 portrait page and returns its index. */
  addPage(): number {
    this.pages.push({ ops: [] });
    return this.pages.length - 1;
  }

  private page(index: number): PageState {
    const page = this.pages[index];
    if (!page) throw new RangeError(`Page ${index} does not exist`);
    return page;
  }

  /** Draws text with its baseline at (x, y) in PDF user space (origin bottom-left). */
  text(pageIndex: number, x: number, y: number, value: string, options: TextOptions = {}): void {
    const size = options.size ?? 10;
    const font = options.font === 'bold' ? '/F2' : '/F1';
    const grey = options.grey ?? 0;
    this.page(pageIndex).ops.push(
      `BT ${num(grey)} g ${font} ${num(size)} Tf ${num(x)} ${num(y)} Td (${encodePdfString(value)}) Tj ET`,
    );
  }

  /** Draws a straight line. */
  line(
    pageIndex: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width = 0.5,
    grey = 0,
  ): void {
    this.page(pageIndex).ops.push(
      `${num(grey)} G ${num(width)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`,
    );
  }

  /** Fills a rectangle with a grey level (0 black … 1 white). */
  rect(pageIndex: number, x: number, y: number, w: number, h: number, grey: number): void {
    this.page(pageIndex).ops.push(`${num(grey)} g ${num(x)} ${num(y)} ${num(w)} ${num(h)} re f`);
  }

  /** Serialises the document to PDF bytes. */
  toBuffer(): Buffer {
    if (this.pages.length === 0) this.addPage();

    // Object numbering: 1 catalog, 2 pages, 3 F1, 4 F2, 5 info, then per page (page, content).
    const objects: string[] = [];
    const pageObjectIds: number[] = [];
    const firstPageObj = 6;
    this.pages.forEach((_, i) => pageObjectIds.push(firstPageObj + i * 2));

    objects.push('<< /Type /Catalog /Pages 2 0 R >>');
    objects.push(
      `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${this.pages.length} >>`,
    );
    objects.push(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    );
    objects.push(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    );
    objects.push(
      `<< /Title (${encodePdfString(this.title)}) /Author (${encodePdfString(this.author)}) /Producer (ProctiraERP pdf-lite) /CreationDate (D:${formatPdfDate(this.creationDate)}) >>`,
    );

    this.pages.forEach((page, i) => {
      const contentId = pageObjectIds[i]! + 1;
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(A4_WIDTH_PT)} ${num(A4_HEIGHT_PT)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`,
      );
      const stream = page.ops.join('\n');
      const streamBytes = Buffer.byteLength(stream, 'latin1');
      objects.push(`<< /Length ${streamBytes} >>\nstream\n${stream}\nendstream`);
    });

    const chunks: Buffer[] = [];
    let offset = 0;
    const offsets: number[] = [];
    const push = (s: string): void => {
      const b = Buffer.from(s, 'latin1');
      chunks.push(b);
      offset += b.length;
    };

    push('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');
    objects.forEach((body, i) => {
      offsets.push(offset);
      push(`${i + 1} 0 obj\n${body}\nendobj\n`);
    });

    const xrefOffset = offset;
    const total = objects.length + 1;
    let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
    push(xref);
    push(
      `trailer\n<< /Size ${total} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    );

    return Buffer.concat(chunks);
  }
}

function formatPdfDate(d: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

// ─── Flow layout ─────────────────────────────────────────────────────────────

export interface PdfFlowOptions {
  margin?: number;
  /** Text repeated at the top of every page (e.g. institution name). */
  header?: string;
  /** Text repeated in the footer; `{page}` / `{pages}` are substituted at the end. */
  footer?: string;
}

export interface TableColumn {
  header: string;
  /** Relative width weight (defaults to 1). */
  weight?: number;
  align?: 'left' | 'right';
}

/**
 * Cursor-driven layout over a `PdfDocument`. Starts a page lazily and breaks
 * pages automatically when the cursor would cross the bottom margin.
 */
export class PdfFlow {
  readonly doc: PdfDocument;
  private readonly margin: number;
  private readonly header: string | undefined;
  private readonly footer: string | undefined;
  private pageIndex = -1;
  private y = 0;
  private readonly footerSlots: Array<{ page: number }> = [];

  constructor(doc: PdfDocument, options: PdfFlowOptions = {}) {
    this.doc = doc;
    this.margin = options.margin ?? 48;
    this.header = options.header;
    this.footer = options.footer;
  }

  get contentWidth(): number {
    return A4_WIDTH_PT - this.margin * 2;
  }

  private ensurePage(): void {
    if (this.pageIndex < 0) this.newPage();
  }

  newPage(): void {
    this.pageIndex = this.doc.addPage();
    this.y = A4_HEIGHT_PT - this.margin;
    if (this.header) {
      this.doc.text(this.pageIndex, this.margin, this.y, this.header, { size: 8, grey: 0.4 });
      this.y -= 6;
      this.doc.line(
        this.pageIndex,
        this.margin,
        this.y,
        A4_WIDTH_PT - this.margin,
        this.y,
        0.5,
        0.6,
      );
      this.y -= 14;
    }
    if (this.footer) this.footerSlots.push({ page: this.pageIndex });
  }

  private ensureSpace(height: number): void {
    this.ensurePage();
    if (this.y - height < this.margin + 18) this.newPage();
  }

  spacer(height = 8): void {
    this.ensurePage();
    this.y -= height;
  }

  heading(text: string, size = 16): void {
    this.ensureSpace(size + 8);
    this.doc.text(this.pageIndex, this.margin, this.y - size, text, { size, font: 'bold' });
    this.y -= size + 8;
  }

  subheading(text: string): void {
    this.heading(text, 12);
  }

  /** Word-wrapped paragraph. */
  paragraph(text: string, options: TextOptions = {}): void {
    const size = options.size ?? 10;
    const lineHeight = size * 1.35;
    for (const line of wrapText(text, this.contentWidth, size)) {
      this.ensureSpace(lineHeight);
      this.doc.text(this.pageIndex, this.margin, this.y - size, line, { ...options, size });
      this.y -= lineHeight;
    }
  }

  /** Two-column key/value row. */
  keyValue(label: string, value: string, labelWidth = 150): void {
    const size = 10;
    this.ensureSpace(size * 1.5);
    this.doc.text(this.pageIndex, this.margin, this.y - size, label, { size, font: 'bold' });
    const lines = wrapText(value, this.contentWidth - labelWidth, size);
    lines.forEach((line, i) => {
      if (i > 0) this.ensureSpace(size * 1.5);
      this.doc.text(this.pageIndex, this.margin + labelWidth, this.y - size, line, { size });
      this.y -= size * 1.5;
    });
  }

  /** Simple ruled table with a shaded header row; rows break across pages. */
  table(columns: TableColumn[], rows: string[][]): void {
    const size = 9;
    const rowHeight = size * 1.8;
    const totalWeight = columns.reduce((acc, c) => acc + (c.weight ?? 1), 0);
    const widths = columns.map((c) => ((c.weight ?? 1) / totalWeight) * this.contentWidth);

    const drawRow = (cells: string[], isHeader: boolean): void => {
      this.ensureSpace(rowHeight);
      const top = this.y;
      if (isHeader) {
        this.doc.rect(
          this.pageIndex,
          this.margin,
          top - rowHeight,
          this.contentWidth,
          rowHeight,
          0.9,
        );
      }
      let x = this.margin;
      columns.forEach((col, i) => {
        const width = widths[i]!;
        const raw = cells[i] ?? '';
        const text = truncateToWidth(raw, width - 8, size);
        const textX = col.align === 'right' ? x + width - 4 - measureText(text, size) : x + 4;
        this.doc.text(this.pageIndex, textX, top - rowHeight + size * 0.55, text, {
          size,
          font: isHeader ? 'bold' : 'regular',
        });
        x += width;
      });
      this.doc.line(
        this.pageIndex,
        this.margin,
        top - rowHeight,
        this.margin + this.contentWidth,
        top - rowHeight,
        0.4,
        0.7,
      );
      this.y -= rowHeight;
    };

    drawRow(
      columns.map((c) => c.header),
      true,
    );
    for (const row of rows) drawRow(row, false);
    this.y -= 6;
  }

  horizontalRule(): void {
    this.ensureSpace(10);
    this.y -= 4;
    this.doc.line(this.pageIndex, this.margin, this.y, A4_WIDTH_PT - this.margin, this.y, 0.6, 0.5);
    this.y -= 6;
  }

  /** Writes footers (with page numbers) and returns the PDF bytes. */
  finish(): Buffer {
    this.ensurePage();
    if (this.footer) {
      const total = this.doc.pageCount;
      for (const slot of this.footerSlots) {
        const text = this.footer
          .replace('{page}', String(slot.page + 1))
          .replace('{pages}', String(total));
        this.doc.text(slot.page, this.margin, this.margin - 20, text, { size: 8, grey: 0.45 });
      }
    }
    return this.doc.toBuffer();
  }
}

/** Greedy word wrap using the average-width metric. */
export function wrapText(text: string, maxWidth: number, size: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measureText(candidate, size) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function truncateToWidth(text: string, maxWidth: number, size: number): string {
  if (measureText(text, size) <= maxWidth) return text;
  const maxChars = Math.max(1, Math.floor(maxWidth / (size * AVG_GLYPH_WIDTH)) - 1);
  return `${text.slice(0, maxChars)}...`;
}
