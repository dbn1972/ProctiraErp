/**
 * PRC-L107 — live Postgres proof that invoice and receipt numbers come from a
 * per-tenant counter (db/sql/324), not from 8 hex characters of a random UUID.
 *
 * Before: numbers were INV-/RCP-<yyyymmdd>-<8 hex> and could collide (a
 * unique-violation 500). After: INV-/RCP-<yyyymmdd>-<counter>, unique and
 * gap-free per tenant, also under concurrent issue, and a rolled-back
 * document returns its number.
 *
 * Requires DATABASE_URL as proctira_app against a DB migrated through 324.
 */
import { randomUUID } from 'node:crypto';
import { ensurePgTestStudent } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';
import { FeesService } from './fees-service.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';
import { getSharedFeesPool, PgFeesRepository } from './pg-fees-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'fee-document-numbers.live.test' });
const pool = getSharedFeesPool();
const live = Boolean(DATABASE_URL) && pool !== null;

const suffix = (n: string) => Number(/^(?:INV|RCP)-\d{8}-(\d{6,})$/.exec(n)?.[1] ?? Number.NaN);

async function setup() {
  const repo = new PgFeesRepository(pool!);
  const service = new FeesService(repo, new SandboxPaymentAdapter());
  const tenantId = randomUUID();
  const studentId = randomUUID();
  await ensurePgTestStudent(pool!, tenantId, studentId);
  return { repo, service, tenantId, studentId };
}

describe('PRC-L107 per-tenant document numbers (live)', () => {
  it.skipIf(!live)('concurrent invoices get unique, consecutive numbers per tenant', async () => {
    const a = await setup();
    const b = await setup();
    const issue = (ctx: typeof a, i: number) =>
      ctx.service.createInvoice(ctx.tenantId, 'staff-1', {
        studentId: ctx.studentId,
        title: `Fee ${i}`,
        amountCents: 1_000,
      });
    const [fromA, fromB] = await Promise.all([
      Promise.all(Array.from({ length: 8 }, (_, i) => issue(a, i))),
      Promise.all(Array.from({ length: 3 }, (_, i) => issue(b, i))),
    ]);
    const seqA = fromA.map((inv) => suffix(inv.invoiceNumber ?? '')).sort((x, y) => x - y);
    const seqB = fromB.map((inv) => suffix(inv.invoiceNumber ?? '')).sort((x, y) => x - y);
    expect(seqA).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(seqB).toEqual([1, 2, 3]);
  });

  it.skipIf(!live)('receipts are numbered from their own counter', async () => {
    const ctx = await setup();
    const receipts: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const invoice = await ctx.service.createInvoice(ctx.tenantId, 'staff-1', {
        studentId: ctx.studentId,
        title: `Fee ${i}`,
        amountCents: 2_000,
      });
      const paid = await ctx.service.recordPayment(ctx.tenantId, 'parent-1', {
        invoiceId: invoice.id,
        method: 'sandbox',
      });
      receipts.push(paid.receipt.receiptNumber);
    }
    expect(receipts.map(suffix)).toEqual([1, 2, 3]);
    expect(receipts.every((n) => n.startsWith('RCP-'))).toBe(true);
  });

  it.skipIf(!live)('a rolled-back invoice returns its number', async () => {
    const ctx = await setup();
    await expect(
      ctx.repo.runInTransaction(ctx.tenantId, async (tx) => {
        expect(await tx.nextDocumentNumber(ctx.tenantId, 'invoice')).toBe(1);
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    const invoice = await ctx.service.createInvoice(ctx.tenantId, 'staff-1', {
      studentId: ctx.studentId,
      title: 'After rollback',
      amountCents: 500,
    });
    expect(suffix(invoice.invoiceNumber ?? '')).toBe(1);
  });
});
