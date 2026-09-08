/**
 * Live Postgres proof for the double-entry fee ledger (G-718). Skipped without
 * DATABASE_URL. Requires db/sql/021 + 023 applied (ensureFeesSchema applies 023).
 */
import { randomUUID } from 'node:crypto';

import { withPgTenant } from '@proctira/database';
import { describe, expect, it } from 'vitest';

import { FeesService } from './fees-service.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';
import { getSharedFeesPool, PgFeesRepository } from './pg-fees-repository.js';

const pool = getSharedFeesPool();

describe('fee ledger (live Postgres)', () => {
  it.skipIf(!pool)('issue → pay posts two balanced journals and the trial balance nets to 0 AR', async () => {
    const repo = new PgFeesRepository(pool!);
    const service = new FeesService(repo, new SandboxPaymentAdapter());
    const tenantId = randomUUID();

    const invoice = await service.createInvoice(tenantId, 'staff-1', {
      studentId: randomUUID(),
      title: 'Term fee',
      amountCents: 125_000,
    });
    await service.recordPayment(tenantId, 'parent-1', { invoiceId: invoice.id, method: 'sandbox' });

    const ledger = await service.getInvoiceLedger(tenantId, invoice.id);
    expect(ledger).toHaveLength(4);
    const trial = await service.getTrialBalance(tenantId);
    expect(trial.debitCents).toBe(trial.creditCents);
    expect(trial.accounts.accounts_receivable).toBe(0);
    expect(trial.accounts.cash).toBe(125_000);
    expect(trial.accounts.fee_revenue).toBe(-125_000);
  });

  it.skipIf(!pool)('database rejects an unbalanced journal at COMMIT and keeps it append-only', async () => {
    const repo = new PgFeesRepository(pool!);
    await repo.ensureSchema();
    const tenantId = randomUUID();
    const journalId = randomUUID();
    const invoiceId = randomUUID();
    const leg = (side: 'debit' | 'credit', amountCents: number) => ({
      id: randomUUID(),
      tenantId,
      journalId,
      invoiceId,
      paymentId: null,
      receiptId: null,
      account: side === 'debit' ? ('cash' as const) : ('accounts_receivable' as const),
      side,
      amountCents,
      currency: 'INR',
      memo: null,
      postedBy: null,
      postedAt: new Date(),
    });

    await expect(repo.postLedgerEntries([leg('debit', 500), leg('credit', 400)])).rejects.toThrow(
      /unbalanced/,
    );
    // Nothing from the failed journal survived the rollback.
    expect(await repo.listLedgerForInvoice(tenantId, invoiceId)).toHaveLength(0);

    const posted = await repo.postLedgerEntries([leg('debit', 700), leg('credit', 700)]);
    expect(posted).toHaveLength(2);
    await expect(
      withPgTenant(pool!, tenantId, (c) =>
        c.query('UPDATE fee_ledger_entries SET amount_cents = 1 WHERE id = $1', [posted[0]!.id]),
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      withPgTenant(pool!, tenantId, (c) =>
        c.query('DELETE FROM fee_ledger_entries WHERE id = $1', [posted[0]!.id]),
      ),
    ).rejects.toThrow(/append-only/);
  });
});
