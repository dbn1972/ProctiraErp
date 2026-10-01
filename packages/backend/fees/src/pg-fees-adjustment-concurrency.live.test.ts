/**
 * Live Postgres proof for PRC-H058: refunds and write-offs serialize on the invoice
 * row (`SELECT … FOR UPDATE`) and a failed journal rolls back the adjustment row.
 */
import { randomUUID } from 'node:crypto';
import { BusinessRuleError } from '@proctira/common';
import { ensurePgTestStudent } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';
import { FeesService } from './fees-service.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';
import { getSharedFeesPool, PgFeesRepository } from './pg-fees-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({
  suite: 'pg-fees-adjustment-concurrency.live.test',
});
const pool = getSharedFeesPool();
const live = Boolean(DATABASE_URL) && pool !== null;

describe('PgFeesRepository adjustment concurrency (live, PRC-H058)', () => {
  async function setup() {
    const repo = new PgFeesRepository(pool!);
    const service = new FeesService(repo, new SandboxPaymentAdapter());
    const tenantId = randomUUID();
    const studentId = randomUUID();
    await ensurePgTestStudent(pool!, tenantId, studentId);
    const invoice = await service.createInvoice(tenantId, 'staff-1', {
      studentId,
      title: 'Adjustment probe',
      amountCents: 10_000,
    });
    return { repo, service, tenantId, invoice };
  }

  it.skipIf(!live)('5 concurrent full refunds -> exactly one succeeds', async () => {
    const { repo, service, tenantId, invoice } = await setup();
    await service.recordPayment(tenantId, 'parent-1', { invoiceId: invoice.id });
    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        service.recordRefund(tenantId, `staff-${i}`, {
          invoiceId: invoice.id,
          amountCents: 10_000,
          reason: 'concurrency probe',
        }),
      ),
    );
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    for (const o of outcomes.filter((x) => x.status === 'rejected')) {
      expect((o as PromiseRejectedResult).reason).toBeInstanceOf(BusinessRuleError);
    }
    const refunds = await repo.listRefundsForInvoice(tenantId, invoice.id);
    expect(refunds.reduce((s, r) => s + r.amountCents, 0)).toBe(10_000);
    const tb = await service.getTrialBalance(tenantId);
    expect(tb.debitCents).toBe(tb.creditCents);
  });

  it.skipIf(!live)(
    'concurrent pay + write-off keeps AR >= 0 and trial balance balanced',
    async () => {
      const { service, tenantId, invoice } = await setup();
      await Promise.allSettled([
        service.recordPayment(tenantId, 'parent-1', { invoiceId: invoice.id }),
        service.writeOffInvoice(tenantId, 'staff-1', {
          invoiceId: invoice.id,
          amountCents: 10_000,
          reason: 'uncollectible',
        }),
      ]);
      const tb = await service.getTrialBalance(tenantId);
      expect(tb.debitCents).toBe(tb.creditCents);
      expect(tb.accounts.accounts_receivable).toBe(0);
    },
  );

  it.skipIf(!live)('journal failure rolls back the refund row', async () => {
    const { repo, service, tenantId, invoice } = await setup();
    await service.recordPayment(tenantId, 'parent-1', { invoiceId: invoice.id });
    // Inject the fault on the transaction-bound repository the service receives.
    const originalLock = repo.withInvoiceLock.bind(repo);
    repo.withInvoiceLock = (t, id, fn) =>
      originalLock(t, id, (tx, locked) => {
        tx.postLedgerEntries = async () => {
          throw new Error('ledger insert failed');
        };
        return fn(tx, locked);
      });
    await expect(
      service.recordRefund(tenantId, 'staff-1', {
        invoiceId: invoice.id,
        amountCents: 1_000,
        reason: 'fault',
      }),
    ).rejects.toThrow('ledger insert failed');
    repo.withInvoiceLock = originalLock;
    expect(await repo.listRefundsForInvoice(tenantId, invoice.id)).toHaveLength(0);
  });
});
