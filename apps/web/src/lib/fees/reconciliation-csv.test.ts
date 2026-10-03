/** PRC-M092: reconciliation CSV pre-check. */
import { describe, expect, it } from 'vitest';
import { MAX_RECON_BYTES, rupeesToPaise, validateReconciliationCsv } from './reconciliation-csv';
import { reconciliationFormSchema } from './validation';

describe('validateReconciliationCsv', () => {
  it('accepts a 1,000-row paise file and normalises it', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => `INV-2026-${i},${1000 + i}`);
    const res = validateReconciliationCsv(
      `invoiceNumber,amountCents\n${rows.join('\n')}\n`,
      'paise',
    );
    expect(res.ok).toBe(true);
    expect(res.rowCount).toBe(1000);
    expect(res.normalized?.split('\n')[1]).toBe('INV-2026-0,1000');
  });

  it('gives a clear size message for a 100k-row file', () => {
    const rows = Array.from({ length: 100_000 }, (_, i) => `INV-2026-${i},1000`);
    const csv = `invoiceNumber,amountCents\n${rows.join('\n')}`;
    expect(csv.length).toBeGreaterThan(MAX_RECON_BYTES);
    const res = validateReconciliationCsv(csv, 'paise');
    expect(res.ok).toBe(false);
    expect(res.issues[0]?.message).toMatch(/too large/);
  });

  it('rejects a malformed header and bad rows with line numbers', () => {
    expect(validateReconciliationCsv('inv,amt\nA,1', 'paise').issues[0]).toMatchObject({ line: 1 });
    const res = validateReconciliationCsv('invoiceNumber,amountCents\nA,10.5\n,5\nB,7,8', 'paise');
    expect(res.issues.map((i) => i.line)).toEqual([2, 3, 4]);
  });

  it('converts decimal rupees with integer-safe parsing', () => {
    expect(rupeesToPaise('5000.00')).toBe(500000);
    expect(rupeesToPaise('0.1')).toBe(10);
    expect(rupeesToPaise('1.005')).toBeNull();
    const res = validateReconciliationCsv('invoiceNumber,amount\nINV-1,5000.5', 'rupees');
    expect(res.normalized).toBe('invoiceNumber,amountCents\nINV-1,500050\n');
  });

  it('schema rejects invalid files before any import', () => {
    const parsed = reconciliationFormSchema.safeParse({ csv: 'bad header\nx', unit: 'paise' });
    expect(parsed.success).toBe(false);
  });
});
