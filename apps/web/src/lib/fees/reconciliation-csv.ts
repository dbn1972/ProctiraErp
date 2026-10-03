/**
 * Bank / PSP reconciliation CSV pre-check (PRC-M092).
 *
 * Runs in the browser (row-level preview before submit) and again in the
 * server action, so a malformed file is rejected before any batch is created
 * and an oversized file gets a clear size message instead of hitting the
 * 1 MB Server Action body limit.
 *
 * Accepted headers:
 *   invoiceNumber,amountCents   (unit = paise: integer minor units)
 *   invoiceNumber,amount        (unit = rupees: up to 2 decimals)
 * The output is always normalised to `invoiceNumber,amountCents` integers,
 * which is what the fees service imports.
 */

/** Keep well under Next's 1 MB Server Action body limit. */
export const MAX_RECON_BYTES = 512 * 1024;
export const MAX_RECON_ROWS = 5_000;
const MAX_INVOICE_NUMBER = 64;
const MAX_AMOUNT_CENTS = 10_000_000_000; // ₹10 crore

export type ReconAmountUnit = 'paise' | 'rupees';

export interface ReconCsvIssue {
  /** 1-based line number in the file (0 = whole file). */
  line: number;
  message: string;
}

export interface ReconCsvResult {
  ok: boolean;
  rowCount: number;
  issues: ReconCsvIssue[];
  /** Normalised `invoiceNumber,amountCents` CSV (only when ok). */
  normalized: string | null;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Integer-safe major->minor conversion: "5000.5" -> 500050. Null when invalid. */
export function rupeesToPaise(raw: string): number | null {
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(raw);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? '').padEnd(2, '0'));
  return whole * 100 + frac;
}

function parsePaise(raw: string): number | null {
  if (!/^\d{1,13}$/.test(raw)) return null;
  return Number(raw);
}

export function validateReconciliationCsv(csv: string, unit: ReconAmountUnit): ReconCsvResult {
  const fail = (issues: ReconCsvIssue[], rowCount = 0): ReconCsvResult => ({
    ok: false,
    rowCount,
    issues,
    normalized: null,
  });
  if (byteLength(csv) > MAX_RECON_BYTES) {
    return fail([
      {
        line: 0,
        message: `File is too large (limit ${Math.round(MAX_RECON_BYTES / 1024)} KB, about ${MAX_RECON_ROWS.toLocaleString('en-IN')} rows). Split it into smaller files.`,
      },
    ]);
  }
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  if (lines.length === 0) return fail([{ line: 0, message: 'The file is empty.' }]);

  const header = lines[0]!.split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const expectedAmount = unit === 'paise' ? 'amountcents' : 'amount';
  if (header.length !== 2 || header[0] !== 'invoicenumber' || header[1] !== expectedAmount) {
    return fail([
      {
        line: 1,
        message: `Header must be "invoiceNumber,${unit === 'paise' ? 'amountCents' : 'amount'}" for amounts in ${unit}.`,
      },
    ]);
  }
  const dataLines = lines.slice(1);
  if (dataLines.length === 0) return fail([{ line: 2, message: 'No data rows after the header.' }]);
  if (dataLines.length > MAX_RECON_ROWS) {
    return fail(
      [
        {
          line: 0,
          message: `Too many rows (${dataLines.length.toLocaleString('en-IN')}; limit ${MAX_RECON_ROWS.toLocaleString('en-IN')}). Split the file.`,
        },
      ],
      dataLines.length,
    );
  }

  const issues: ReconCsvIssue[] = [];
  const out: string[] = ['invoiceNumber,amountCents'];
  dataLines.forEach((raw, index) => {
    const line = index + 2;
    if (raw.trim() === '') {
      issues.push({ line, message: 'Blank row.' });
      return;
    }
    const cells = raw.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cells.length !== 2) {
      issues.push({ line, message: `Expected 2 columns, found ${cells.length}.` });
      return;
    }
    const [invoiceNumber, amountRaw] = cells as [string, string];
    if (
      !invoiceNumber ||
      invoiceNumber.length > MAX_INVOICE_NUMBER ||
      !/^[\w.\-/]+$/.test(invoiceNumber)
    ) {
      issues.push({ line, message: 'Invoice number is missing or invalid.' });
      return;
    }
    const cents = unit === 'paise' ? parsePaise(amountRaw) : rupeesToPaise(amountRaw);
    if (cents === null || cents <= 0 || cents > MAX_AMOUNT_CENTS) {
      issues.push({
        line,
        message:
          unit === 'paise'
            ? `Amount "${amountRaw}" must be a positive whole number of paise.`
            : `Amount "${amountRaw}" must be a positive rupee amount with at most 2 decimals.`,
      });
      return;
    }
    out.push(`${invoiceNumber},${cents}`);
  });
  if (issues.length > 0) return fail(issues, dataLines.length);
  return { ok: true, rowCount: dataLines.length, issues: [], normalized: `${out.join('\n')}\n` };
}
