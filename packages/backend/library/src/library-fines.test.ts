/**
 * Library fines unit tests (G-603 + G-916 local ledger).
 */
import { describe, expect, it } from 'vitest';

import { InMemoryFeesLedgerPort } from './fees-ledger-port.js';
import { InMemoryLibraryRepository } from './in-memory-repository.js';
import { LibraryService } from './library-service.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';
const STUDENT = '55555555-5555-4555-8555-555555555555';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * PRC-M104: checkout refuses past due dates, so check out with a valid future
 * due date and then backdate the stored loan to make it overdue.
 */
async function checkoutOverdue(
  repo: InMemoryLibraryRepository,
  service: LibraryService,
  itemId: string,
) {
  const loan = await service.checkout(TENANT, {
    itemId,
    studentId: STUDENT,
    dueAt: new Date(Date.now() + 14 * DAY_MS).toISOString(),
  });
  await repo.updateLoan(loan.id, TENANT, { dueAt: new Date(Date.now() - 30 * DAY_MS) });
  return loan;
}

describe('LibraryService.assessFine (G-603 / G-916)', () => {
  it('posts an overdue fine invoice to the fees ledger when wired', async () => {
    const repo = new InMemoryLibraryRepository();
    const ledger = new InMemoryFeesLedgerPort();
    const service = new LibraryService(repo, ledger);

    const item = await service.createItem(TENANT, { title: 'Algorithms', copies: 1 });
    const loan = await checkoutOverdue(repo, service, item.id);

    const assessed = await service.assessFine(TENANT, 'librarian-1', {
      loanId: loan.id,
      amountCents: 1500,
    });

    expect(assessed.amountCents).toBe(1500);
    expect(assessed.invoice?.status).toBe('open');
    expect(assessed.invoice?.studentId).toBe(STUDENT);
    expect(ledger.invoices).toHaveLength(1);
    expect(ledger.invoices[0]!.title).toMatch(/Library fine/i);
    expect(assessed.fine.status).toBe('open');
  });

  it('still records a local fine when the fees ledger is not configured', async () => {
    const repo = new InMemoryLibraryRepository();
    const service = new LibraryService(repo, null);
    const item = await service.createItem(TENANT, { title: 'Local Fine', copies: 1 });
    const loan = await checkoutOverdue(repo, service, item.id);
    const assessed = await service.assessFine(TENANT, 'librarian-1', {
      loanId: loan.id,
      amountCents: 200,
    });
    expect(assessed.invoice).toBeNull();
    expect(assessed.fine.amountCents).toBe(200);
  });
});

describe('LibraryService.markFinePaid (PRC-H025)', () => {
  it('settles the fee-ledger invoice when the fine is marked paid', async () => {
    const repo = new InMemoryLibraryRepository();
    const ledger = new InMemoryFeesLedgerPort();
    const service = new LibraryService(repo, ledger);

    const item = await service.createItem(TENANT, { title: 'Algorithms', copies: 1 });
    const loan = await checkoutOverdue(repo, service, item.id);
    const assessed = await service.assessFine(TENANT, 'librarian-1', {
      loanId: loan.id,
      amountCents: 1500,
    });

    // Precondition: invoice posted and still open on the ledger.
    expect(ledger.invoices[0]!.status).toBe('open');

    const paid = await service.markFinePaid(TENANT, assessed.fine.id, 'librarian-1');

    expect(paid.status).toBe('paid');
    // Would fail before the fix: the invoice stayed 'open' on the fee ledger.
    expect(ledger.invoices[0]!.status).toBe('paid');
    expect(ledger.invoices[0]!.id).toBe(assessed.fine.invoiceId);
  });

  it('still flips a local fine with no ledger invoice', async () => {
    const repo = new InMemoryLibraryRepository();
    const service = new LibraryService(repo, null);
    const item = await service.createItem(TENANT, { title: 'Local', copies: 1 });
    const loan = await checkoutOverdue(repo, service, item.id);
    const assessed = await service.assessFine(TENANT, 'librarian-1', {
      loanId: loan.id,
      amountCents: 200,
    });
    const paid = await service.markFinePaid(TENANT, assessed.fine.id, 'librarian-1');
    expect(paid.status).toBe('paid');
  });

  it('does not flip the local fine when ledger settlement fails', async () => {
    const repo = new InMemoryLibraryRepository();
    const ledger = new InMemoryFeesLedgerPort();
    // Force settlement failure to assert the local fine stays open.
    ledger.settleFineInvoice = async () => {
      throw new Error('ledger down');
    };
    const service = new LibraryService(repo, ledger);
    const item = await service.createItem(TENANT, { title: 'Algorithms', copies: 1 });
    const loan = await checkoutOverdue(repo, service, item.id);
    const assessed = await service.assessFine(TENANT, 'librarian-1', {
      loanId: loan.id,
      amountCents: 1500,
    });

    await expect(service.markFinePaid(TENANT, assessed.fine.id, 'librarian-1')).rejects.toThrow(
      /ledger down/,
    );
    const stillOpen = await service.listFines(TENANT, assessed.studentId);
    expect(stillOpen[0]!.status).toBe('open');
  });
});
