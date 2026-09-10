/**
 * Lightweight structural inspection of PDF bytes. Used by tests (and health
 * probes) to prove that a generated artifact is a real PDF rather than text
 * or HTML masquerading under a `.pdf` name.
 */

export interface PdfInspection {
  /** `%PDF-x.y` header version, e.g. `1.4`. */
  version: string;
  /** Number of `/Type /Page` objects (excluding the `/Pages` tree node). */
  pageCount: number;
  /** Whether an `xref` table and `%%EOF` trailer are present. */
  hasXref: boolean;
  hasEof: boolean;
  /** `startxref` byte offset and whether it points at the `xref` keyword. */
  startXref: number | null;
  startXrefValid: boolean;
  /** Plain-text literal strings found in content streams (WinAnsi decoded). */
  literalStrings: string[];
}

/** True when the buffer starts with a PDF header. */
export function isPdfBuffer(bytes: Uint8Array | Buffer): boolean {
  return bytes.length > 7 && Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';
}

export function inspectPdf(bytes: Uint8Array | Buffer): PdfInspection {
  const buf = Buffer.from(bytes);
  const text = buf.toString('latin1');
  const header = /^%PDF-(\d\.\d)/.exec(text);
  const version = header?.[1] ?? '';
  const pageCount = (text.match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
  const hasXref = text.includes('\nxref\n');
  const hasEof = text.trimEnd().endsWith('%%EOF');
  const startXrefMatch = /startxref\s+(\d+)/.exec(text);
  const startXref = startXrefMatch ? Number(startXrefMatch[1]) : null;
  const startXrefValid = startXref !== null && text.slice(startXref, startXref + 4) === 'xref';

  const literalStrings: string[] = [];
  const re = /\((?:\\.|[^\\)])*\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0].replace(/\)\s*Tj$/, '').slice(1);
    literalStrings.push(raw.replace(/\\([\\()])/g, '$1'));
  }

  return { version, pageCount, hasXref, hasEof, startXref, startXrefValid, literalStrings };
}
