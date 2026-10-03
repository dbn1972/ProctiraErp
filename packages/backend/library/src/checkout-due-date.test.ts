/** PRC-M104 — barcode checkout keeps the clerk's due date; past/over-policy rejected. */
import { describe, expect, it } from 'vitest';
import { InMemoryFeesLedgerPort } from './fees-ledger-port.js';
import { InMemoryLibraryRepository } from './in-memory-repository.js';
import { StubIsbnLookup } from './isbn-lookup.js';
import { LIBRARY_MAX_LOAN_DAYS, LibraryService } from './library-service.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';
const STUDENT = '55555555-5555-4555-8555-555555555555';
const DAY = 24 * 60 * 60 * 1000;

async function barcodeFixture() {
  const lib = new LibraryService(
    new InMemoryLibraryRepository(),
    new InMemoryFeesLedgerPort(),
    new StubIsbnLookup(),
  );
  const item = await lib.createItem(TENANT, { title: 'Due date', copies: 2 });
  const [copy] = await lib.listCopies(TENANT, item.id);
  return { lib, barcode: copy!.barcode };
}

describe('checkout due date (PRC-M104)', () => {
  it('persists the requested due date on a barcode checkout', async () => {
    const { lib, barcode } = await barcodeFixture();
    const dueAt = new Date(Date.now() + 7 * DAY).toISOString();
    const loan = await lib.checkout(TENANT, { barcode, studentId: STUDENT, dueAt });
    expect(loan.dueAt.toISOString()).toBe(dueAt);
  });

  it('rejects a past due date (400)', async () => {
    const { lib, barcode } = await barcodeFixture();
    await expect(
      lib.checkout(TENANT, {
        barcode,
        studentId: STUDENT,
        dueAt: new Date(Date.now() - DAY).toISOString(),
      }),
    ).rejects.toMatchObject({ statusCode: 400, message: 'Due date cannot be in the past' });
  });

  it('rejects a due date beyond the loan policy and an invalid date', async () => {
    const { lib, barcode } = await barcodeFixture();
    await expect(
      lib.checkout(TENANT, {
        barcode,
        studentId: STUDENT,
        dueAt: new Date(Date.now() + (LIBRARY_MAX_LOAN_DAYS + 1) * DAY).toISOString(),
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      lib.checkout(TENANT, { barcode, studentId: STUDENT, dueAt: 'not-a-date' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('defaults to 14 days when no due date is given', async () => {
    const { lib, barcode } = await barcodeFixture();
    const loan = await lib.checkout(TENANT, { barcode, studentId: STUDENT });
    expect(Math.round((loan.dueAt.getTime() - Date.now()) / DAY)).toBe(14);
  });
});
