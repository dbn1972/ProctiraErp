/**
 * Library fines → fees ledger unit tests (G-603).
 */
import { describe, expect, it } from 'vitest';

import { InMemoryFeesLedgerPort } from './fees-ledger-port.js';
import { InMemoryLibraryRepository } from './in-memory-repository.js';
import { LibraryService } from './library-service.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';
const STUDENT = '55555555-5555-4555-8555-555555555555';

describe('LibraryService.assessFine (G-603)', () => {
  it('posts an overdue fine invoice to the fees ledger', async () => {
    const repo = new InMemoryLibraryRepository();
    const ledger = new InMemoryFeesLedgerPort();
    const service = new LibraryService(repo, ledger);

    const item = await service.createItem(TENANT, { title: 'Algorithms', copies: 1 });
    const loan = await service.checkout(TENANT, {
      itemId: item.id,
      studentId: STUDENT,
      dueAt: '2020-01-01T00:00:00.000Z',
    });

    const assessed = await service.assessFine(TENANT, 'librarian-1', {
      loanId: loan.id,
      amountCents: 1500,
    });

    expect(assessed.amountCents).toBe(1500);
    expect(assessed.invoice.status).toBe('open');
    expect(assessed.invoice.studentId).toBe(STUDENT);
    expect(ledger.invoices).toHaveLength(1);
    expect(ledger.invoices[0]!.title).toMatch(/Library fine/i);
  });

  it('rejects fine when fees ledger is not configured', async () => {
    const service = new LibraryService(new InMemoryLibraryRepository(), null);
    await expect(
      service.assessFine(TENANT, 'librarian-1', {
        loanId: 'd1000000-0000-4000-8000-000000000101',
      }),
    ).rejects.toThrow(/Fees ledger/i);
  });
});
