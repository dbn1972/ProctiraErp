/**
 * Live Postgres proof for the double-entry fee ledger (G-718). Skipped without
 * DATABASE_URL. Requires db/sql/021 + 023 applied (ensureFeesSchema applies 023).
 */
import { randomUUID } from 'node:crypto';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';

import { withPlatformScope } from '@proctira/database';
import { ensurePgTestStudent } from '@proctira/database/test-fixtures';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { FeesService } from './fees-service.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';
import { getSharedFeesPool, PgFeesRepository } from './pg-fees-repository.js';
const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-fees-ledger.live.test' });

const pool = getSharedFeesPool();
const live = Boolean(DATABASE_URL) && pool !== null;
const MIGRATOR_DATABASE_URL = process.env['MIGRATOR_DATABASE_URL']?.trim();
const ownerPool = MIGRATOR_DATABASE_URL
  ? new pg.Pool({ connectionString: MIGRATOR_DATABASE_URL, max: 2 })
  : null;

afterAll(async () => {
  await ownerPool?.end();
});

describe('fee ledger (live Postgres)', () => {
  it.skipIf(!live)(
    'issue → pay posts two balanced journals and the trial balance nets to 0 AR',
    async () => {
      const repo = new PgFeesRepository(pool!);
      const service = new FeesService(repo, new SandboxPaymentAdapter());
      const tenantId = randomUUID();
      const studentId = randomUUID();
      await ensurePgTestStudent(pool!, tenantId, studentId);

      const invoice = await service.createInvoice(tenantId, 'staff-1', {
        studentId,
        title: 'Term fee',
        amountCents: 125_000,
      });
      await service.recordPayment(tenantId, 'parent-1', {
        invoiceId: invoice.id,
        method: 'sandbox',
      });

      const ledger = await service.getInvoiceLedger(tenantId, invoice.id);
      expect(ledger).toHaveLength(4);
      const trial = await service.getTrialBalance(tenantId);
      expect(trial.debitCents).toBe(trial.creditCents);
      expect(trial.accounts.accounts_receivable).toBe(0);
      expect(trial.accounts.cash).toBe(125_000);
      expect(trial.accounts.fee_revenue).toBe(-125_000);
    },
  );

  // W3-TEST-01 — payment/receipt amount integrity after pay (re-read from Postgres).
  it.skipIf(!live)(
    'recordPayment persists payment.amountCents === receipt.amountCents on re-read',
    async () => {
      const repo = new PgFeesRepository(pool!);
      const service = new FeesService(repo, new SandboxPaymentAdapter());
      const tenantId = randomUUID();
      const studentId = randomUUID();
      await ensurePgTestStudent(pool!, tenantId, studentId);

      const invoice = await service.createInvoice(tenantId, 'staff-1', {
        studentId,
        title: 'Library fee',
        amountCents: 42_500,
      });
      const paid = await service.recordPayment(tenantId, 'parent-1', {
        invoiceId: invoice.id,
        method: 'sandbox',
      });

      expect(paid.payment.amountCents).toBe(42_500);
      expect(paid.receipt.amountCents).toBe(paid.payment.amountCents);
      expect(paid.receipt.paymentId).toBe(paid.payment.id);

      const payments = await service.listPayments(tenantId);
      const receipts = await service.listReceipts(tenantId);
      const payment = payments.find((p) => p.id === paid.payment.id);
      const receipt = receipts.find((r) => r.id === paid.receipt.id);
      expect(payment?.amountCents).toBe(42_500);
      expect(receipt?.amountCents).toBe(payment?.amountCents);
      expect(receipt?.paymentId).toBe(payment?.id);
      expect(receipt?.invoiceId).toBe(invoice.id);
    },
  );

  it.skipIf(!live || !ownerPool)(
    'database rejects an unbalanced journal at COMMIT and keeps it append-only',
    async () => {
      const repo = new PgFeesRepository(pool!);
      await repo.ensureSchema();
      const tenantId = randomUUID();
      const journalId = randomUUID();
      const invoiceId = randomUUID();
      const studentId = randomUUID();
      await ensurePgTestStudent(pool!, tenantId, studentId);
      await repo.createInvoice({
        id: invoiceId,
        tenantId,
        studentId,
        planId: null,
        title: 'Ledger invariant fixture',
        description: '',
        amountCents: 1_000,
        currency: 'INR',
        status: 'open',
        dueAt: null,
        createdBy: 'test',
        invoiceNumber: `TEST-${invoiceId}`,
        structureId: null,
        classId: null,
        gradeId: null,
      });
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
        withPlatformScope(
          ownerPool!,
          (c) =>
            c.query('UPDATE fee_ledger_entries SET amount_cents = 1 WHERE id = $1', [
              posted[0]!.id,
            ]),
          tenantId,
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        withPlatformScope(
          ownerPool!,
          (c) => c.query('DELETE FROM fee_ledger_entries WHERE id = $1', [posted[0]!.id]),
          tenantId,
        ),
      ).rejects.toThrow(/append-only/);
    },
  );
});
