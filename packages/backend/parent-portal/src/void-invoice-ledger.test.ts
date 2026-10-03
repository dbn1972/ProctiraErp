/**
 * PRC-H058: parent-portal invoice void always goes through the fees ledger's locked void
 * (row lock + reversal journal). Without a ledger it fails closed instead of flipping status.
 */
import { describe, expect, it, vi } from 'vitest';

import { EmptyAcademicVisibilityStore } from './academic-visibility.js';
import { InMemoryParentPortalRepository } from './in-memory-repository.js';
import { ParentPortalService, type FeesLedgerPort } from './parent-portal-service.js';

describe('parent-portal voidInvoice (PRC-H058)', () => {
  it('delegates to the fees ledger with actor and reason', async () => {
    const voidInvoice = vi.fn().mockResolvedValue({ id: 'inv-1', status: 'void' });
    const service = new ParentPortalService(
      new InMemoryParentPortalRepository(),
      new EmptyAcademicVisibilityStore(),
      { voidInvoice } as unknown as FeesLedgerPort,
    );
    await service.voidInvoice('t-1', 'inv-1', { actorId: 'staff-1', reason: 'duplicate' });
    expect(voidInvoice).toHaveBeenCalledWith('t-1', 'inv-1', {
      actorId: 'staff-1',
      reason: 'duplicate',
    });
  });

  it('refuses to void without a fees ledger (no unlocked, journal-less status flip)', async () => {
    const repository = new InMemoryParentPortalRepository();
    const update = vi.spyOn(repository, 'updateInvoice');
    vi.spyOn(repository, 'findInvoiceById').mockResolvedValue({
      id: 'inv-2',
      status: 'open',
    } as never);
    const service = new ParentPortalService(repository);
    await expect(service.voidInvoice('t-1', 'inv-2')).rejects.toThrow(/fees ledger/);
    expect(update).not.toHaveBeenCalled();
  });
});
