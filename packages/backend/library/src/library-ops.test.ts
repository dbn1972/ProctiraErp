/**
 * G-916 library ops: hold queue, fine cap, barcode, tenant isolation.
 */
import { describe, expect, it, vi } from 'vitest';

import { InMemoryFeesLedgerPort } from './fees-ledger-port.js';
import { InMemoryLibraryRepository } from './in-memory-repository.js';
import { createIsbnLookup, StubIsbnLookup } from './isbn-lookup.js';
import { computeFineCents, HOLD_READY_MS, overdueDaysSince } from './library-ops.js';
import { LibraryService } from './library-service.js';

const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';
const TENANT_B = '660e8400-e29b-41d4-a716-446655440000';
const STUDENT_A = '55555555-5555-4555-8555-555555555555';
const STUDENT_B = '66666666-6666-4666-8666-666666666666';
const PATRON_A = 'patron-a';
const PATRON_B = 'patron-b';

function service(repo = new InMemoryLibraryRepository()) {
  return { repo, service: new LibraryService(repo, new InMemoryFeesLedgerPort(), new StubIsbnLookup()) };
}

describe('computeFineCents', () => {
  it('applies the per-day rate and caps the amount', () => {
    expect(computeFineCents(3, 500, 5000)).toBe(1500);
    expect(computeFineCents(20, 500, 5000)).toBe(5000);
    expect(computeFineCents(0, 500, 5000)).toBe(0);
    expect(overdueDaysSince(new Date(Date.now() + 60_000))).toBe(0);
  });
});

describe('ISBN lookup adapter', () => {
  it('defaults to the offline stub and never calls fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const lookup = createIsbnLookup();
      const result = await lookup.lookup('978-0-13-468599-1');
      expect(result?.title).toBe('Introduction to Algorithms');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('LibraryService holds + barcode + fines (G-916)', () => {
  it('queues holds FIFO and promotes the first when a copy returns', async () => {
    const { service: lib } = service();
    const item = await lib.createItem(TENANT_A, { title: 'Held Title', copies: 1 });
    const copies = await lib.listCopies(TENANT_A, item.id);
    expect(copies).toHaveLength(1);
    const barcode = copies[0]!.barcode;

    const loanOut = await lib.checkout(TENANT_A, { itemId: item.id, studentId: STUDENT_A });

    const first = await lib.placeHold(TENANT_A, { itemId: item.id, patronUserId: PATRON_A });
    const second = await lib.placeHold(TENANT_A, { itemId: item.id, patronUserId: PATRON_B });
    expect(first.position).toBe(1);
    expect(second.position).toBe(2);
    expect(first.status).toBe('queued');

    await lib.returnLoan(TENANT_A, loanOut.id);

    const holds = await lib.listHolds(TENANT_A, item.id);
    const ready = holds.find((h) => h.id === first.id);
    const queued = holds.find((h) => h.id === second.id);
    expect(ready?.status).toBe('ready');
    expect(ready?.position).toBe(1);
    expect(ready?.copyId).toBe(copies[0]!.id);
    expect(ready?.expiresAt).not.toBeNull();
    expect(queued?.status).toBe('queued');
    expect(queued?.position).toBe(1);

    const forbidden = lib.checkout(TENANT_A, { barcode, studentId: STUDENT_B });
    await expect(forbidden).rejects.toThrow(/reserved/i);

    const loanReady = await lib.checkout(TENANT_A, {
      barcode,
      patronUserId: PATRON_A,
    });
    expect(loanReady.barcode).toBe(barcode);
    const after = await lib.listHolds(TENANT_A, item.id);
    expect(after.find((h) => h.id === first.id)?.status).toBe('fulfilled');
  });

  it('expires a ready hold and promotes the next patron', async () => {
    const { repo, service: lib } = service();
    const item = await lib.createItem(TENANT_A, { title: 'Expiry Title', copies: 1 });
    const loanOut = await lib.checkout(TENANT_A, { itemId: item.id, studentId: STUDENT_A });
    const first = await lib.placeHold(TENANT_A, { itemId: item.id, studentId: STUDENT_A });
    const second = await lib.placeHold(TENANT_A, { itemId: item.id, studentId: STUDENT_B });
    await lib.returnLoan(TENANT_A, loanOut.id);

    const ready = (await lib.listHolds(TENANT_A, item.id)).find((h) => h.id === first.id);
    expect(ready?.status).toBe('ready');
    await repo.updateHold(first.id, TENANT_A, {
      expiresAt: new Date(Date.now() - HOLD_READY_MS),
    });

    const listed = await lib.listHolds(TENANT_A, item.id);
    expect(listed.find((h) => h.id === first.id)?.status).toBe('expired');
    expect(listed.find((h) => h.id === second.id)?.status).toBe('ready');
  });

  it('looks up a copy by barcode', async () => {
    const { service: lib } = service();
    const item = await lib.createItem(TENANT_A, { title: 'Barcode Book', copies: 2 });
    const copies = await lib.listCopies(TENANT_A, item.id);
    const found = await lib.lookupBarcode(TENANT_A, copies[1]!.barcode);
    expect(found.copy.itemId).toBe(item.id);
    expect(found.item?.title).toBe('Barcode Book');
    await expect(lib.lookupBarcode(TENANT_A, 'NOPE')).rejects.toThrow(/not found/i);
  });

  it('assesses an overdue fine using the policy cap and marks it paid', async () => {
    const { service: lib } = service();
    await lib.upsertFinePolicy(TENANT_A, { centsPerDay: 500, capCents: 1000 });
    const item = await lib.createItem(TENANT_A, { title: 'Overdue Book', copies: 1 });
    const loan = await lib.checkout(TENANT_A, {
      itemId: item.id,
      studentId: STUDENT_A,
      dueAt: '2020-01-01T00:00:00.000Z',
    });

    const assessed = await lib.assessFine(TENANT_A, 'librarian-1', { loanId: loan.id });
    expect(assessed.amountCents).toBe(1000);
    expect(assessed.fine.status).toBe('open');
    await expect(lib.assessFine(TENANT_A, 'librarian-1', { loanId: loan.id })).rejects.toThrow(
      /already exists/i,
    );

    const paid = await lib.markFinePaid(TENANT_A, assessed.fine.id);
    expect(paid.status).toBe('paid');
    const summary = await lib.summarizeForStudent(TENANT_A, STUDENT_A);
    expect(summary.openCount).toBe(0);
    expect(summary.paidAmountCents).toBe(1000);
  });

  it('isolates catalog, holds, and fines across tenants', async () => {
    const { service: lib } = service();
    const item = await lib.createItem(TENANT_A, { title: 'Tenant A only', copies: 1 });
    await lib.checkout(TENANT_A, { itemId: item.id, studentId: STUDENT_A });
    await lib.placeHold(TENANT_A, { itemId: item.id, studentId: STUDENT_B });

    expect(await lib.listItems(TENANT_B)).toHaveLength(0);
    expect(await lib.listHolds(TENANT_B)).toHaveLength(0);
    expect(await lib.listFines(TENANT_B)).toHaveLength(0);
    expect(await lib.searchOpac(TENANT_B, 'Tenant')).toHaveLength(0);
    expect(await lib.searchOpac(TENANT_A, 'Tenant A')).toHaveLength(1);
  });
});
