/**
 * Live Postgres proof for W3-RACE-03 / B1: concurrent full payments against one
 * open invoice serialize on `SELECT … FOR UPDATE`, so at most one succeeds and
 * succeeded payments never exceed the invoice face amount.
 */
import { randomUUID } from 'node:crypto';

import { BusinessRuleError } from '@proctira/common';
import { ensurePgTestStudent } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';

import { FeesService } from './fees-service.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';
import { getSharedFeesPool, PgFeesRepository } from './pg-fees-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-fees-payment-concurrency.live.test' });

const pool = getSharedFeesPool();
const live = Boolean(DATABASE_URL) && pool !== null;

describe('PgFeesRepository payment concurrency (live)', () => {
  it.skipIf(!live)(
    'never double-receipts or over-pays an invoice under concurrent recordPayment',
    async () => {
      const repo = new PgFeesRepository(pool!);
      const service = new FeesService(repo, new SandboxPaymentAdapter());
      const tenantId = randomUUID();
      const studentId = randomUUID();
      await ensurePgTestStudent(pool!, tenantId, studentId);

      const invoice = await service.createInvoice(tenantId, 'staff-1', {
        studentId,
        title: 'Concurrency probe',
        amountCents: 10_000,
      });

      const outcomes = await Promise.allSettled(
        Array.from({ length: 5 }, (_, index) =>
          service.recordPayment(tenantId, `parent-${index}`, { invoiceId: invoice.id }),
        ),
      );

      const ok = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const fail = outcomes.filter((outcome) => outcome.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(fail).toHaveLength(4);
      for (const outcome of fail) {
        expect((outcome as PromiseRejectedResult).reason).toBeInstanceOf(BusinessRuleError);
      }

      const payments = await service.listPayments(tenantId);
      const receipts = await service.listReceipts(tenantId);
      const succeeded = payments.filter((payment) => payment.status === 'succeeded');
      const invoicePayments = succeeded.filter((payment) => payment.invoiceId === invoice.id);
      const totalPaidCents = invoicePayments.reduce((sum, payment) => sum + payment.amountCents, 0);

      expect(invoicePayments).toHaveLength(1);
      expect(receipts.filter((receipt) => receipt.invoiceId === invoice.id)).toHaveLength(1);
      expect(totalPaidCents).toBe(invoice.amountCents);

      const invoices = await service.listInvoices(tenantId);
      expect(invoices.find((row) => row.id === invoice.id)?.status).toBe('paid');
    },
  );
});
