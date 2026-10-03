/**
 * PRC-M248: hot paths use per-invoice queries; staff list routes paginate.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { feesPlugin } from './fees-plugin.js';
import { FeesService } from './fees-service.js';
import { InMemoryFeesRepository } from './in-memory-repository.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const STUDENT = '00000000-0000-4000-8000-000000000099';

async function seed(repository: InMemoryFeesRepository, n: number) {
  const service = new FeesService(repository, new SandboxPaymentAdapter());
  const invoices = [];
  for (let i = 0; i < n; i += 1) {
    const inv = await service.createInvoice(TENANT, 'staff-1', {
      studentId: STUDENT,
      title: `I${i}`,
      amountCents: 1_000,
    });
    await service.recordPayment(TENANT, 'parent-1', { invoiceId: inv.id, amountCents: 1_000 });
    invoices.push(inv);
  }
  return { service, invoices };
}

describe('PRC-M248 bounded fees queries', () => {
  it('refund / net-collected / idempotent replay do not scan tenant-wide payments or receipts', async () => {
    const repository = new InMemoryFeesRepository();
    const { service, invoices } = await seed(repository, 30);
    const target = invoices[7]!;
    const keyed = await service.createInvoice(TENANT, 'staff-1', {
      studentId: STUDENT,
      title: 'keyed',
      amountCents: 500,
    });
    await service.recordPayment(TENANT, 'parent-1', {
      invoiceId: keyed.id,
      amountCents: 500,
      idempotencyKey: 'k1',
    });
    repository.tenantScans = 0;
    await service.recordRefund(TENANT, 'bursar-1', {
      invoiceId: target.id,
      amountCents: 200,
      reason: 'overpaid',
    });
    expect(await service.getNetCollectedCents(TENANT, target.id)).toBe(800);
    const replay = await service.recordPayment(TENANT, 'parent-1', {
      invoiceId: keyed.id,
      amountCents: 500,
      idempotencyKey: 'k1',
    });
    expect(replay.idempotent).toBe(true);
    await service.listReceiptsForInvoiceIds(TENANT, [target.id]);
    expect(repository.tenantScans).toBe(0);
  });

  it('list routes honour limit/cursor and cap', async () => {
    const repository = new InMemoryFeesRepository();
    await seed(repository, 7);
    const app: FastifyInstance = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      const r = request as { tenantId?: string; user?: { sub?: string; roles?: unknown } };
      r.tenantId = TENANT;
      r.user = { sub: 'bursar-1', roles: ['bursar'] };
    });
    await app.register(feesPlugin, { repository, prefix: '/fees' });
    await app.ready();
    for (const path of ['invoices', 'payments', 'receipts']) {
      const first = await app.inject({ method: 'GET', url: `/fees/${path}?limit=5` });
      expect(first.statusCode).toBe(200);
      expect(first.json().data).toHaveLength(5);
      expect(first.json().nextCursor).toBe('5');
      const second = await app.inject({ method: 'GET', url: `/fees/${path}?limit=5&cursor=5` });
      expect(second.json().data).toHaveLength(2);
      expect(second.json().nextCursor).toBeNull();
      expect((await app.inject({ method: 'GET', url: `/fees/${path}?limit=201` })).statusCode).toBe(
        400,
      );
    }
    await app.close();
  });
});
