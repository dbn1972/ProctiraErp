/**
 * PRC-H058: the parent-portal staff void path delegates to the shared fees ledger
 * (invoice lock + atomic reversal journal) with the acting user, and the
 * ledger-less fallback store fails closed in production.
 */
import { BusinessRuleError } from '@proctira/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryParentPortalRepository } from './in-memory-repository.js';
import { EmptyAcademicVisibilityStore } from './academic-visibility.js';
import { ParentPortalService, type FeesLedgerPort } from './parent-portal-service.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const INVOICE = '00000000-0000-4000-8000-0000000000e1';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ParentPortalService.voidInvoice (PRC-H058)', () => {
  it('delegates to the fees ledger with the acting staff user', async () => {
    const voidInvoice = vi.fn(async () => ({ id: INVOICE, status: 'void' }));
    const fees = { voidInvoice } as unknown as FeesLedgerPort;
    const service = new ParentPortalService(
      new InMemoryParentPortalRepository(),
      new EmptyAcademicVisibilityStore(),
      fees,
    );
    await service.voidInvoice(TENANT, INVOICE, { actorId: 'bursar-1' });
    expect(voidInvoice).toHaveBeenCalledWith(TENANT, INVOICE, {
      actorId: 'bursar-1',
      reason: null,
    });
  });

  it('refuses the ledger-less fallback void in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const service = new ParentPortalService(new InMemoryParentPortalRepository());
    await expect(service.voidInvoice(TENANT, INVOICE)).rejects.toBeInstanceOf(BusinessRuleError);
  });
});
