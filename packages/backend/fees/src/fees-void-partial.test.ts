/**
 * PRC-H059: voiding an invoice with collected cash is refused until refunded;
 * the reversal journal covers only the unpaid remainder and records the actor.
 */
import { BusinessRuleError } from '@proctira/common';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { feesPlugin } from './fees-plugin.js';
import { FeesService } from './fees-service.js';
import { InMemoryFeesRepository } from './in-memory-repository.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';

const TENANT = '00000000-0000-4000-8000-0000000000c1';
const STUDENT = '00000000-0000-4000-8000-0000000000d1';

describe('voidInvoice with partial payments (PRC-H059)', () => {
  let repository: InMemoryFeesRepository;
  let service: FeesService;

  beforeEach(() => {
    repository = new InMemoryFeesRepository();
    service = new FeesService(repository, new SandboxPaymentAdapter());
  });

  async function partPaid() {
    const invoice = await service.createInvoice(TENANT, 'staff-1', {
      studentId: STUDENT,
      title: 'Part paid',
      amountCents: 10_000,
    });
    await service.recordPayment(TENANT, 'parent-1', { invoiceId: invoice.id, amountCents: 4_000 });
    return invoice;
  }

  it('invoice 10000, pay 4000, void -> BusinessRuleError; refund 4000 then void nets AR to 0', async () => {
    const invoice = await partPaid();
    await expect(
      service.voidInvoice(TENANT, invoice.id, { actorId: 'bursar-1', reason: 'duplicate' }),
    ).rejects.toThrow(BusinessRuleError);
    expect((await service.getInvoice(TENANT, invoice.id)).status).toBe('open');

    await service.recordRefund(TENANT, 'bursar-1', {
      invoiceId: invoice.id,
      amountCents: 4_000,
      reason: 'cancelled',
    });
    const voided = await service.voidInvoice(TENANT, invoice.id, {
      actorId: 'bursar-1',
      reason: 'duplicate',
    });
    expect(voided.status).toBe('void');

    const tb = await service.getTrialBalance(TENANT);
    expect(tb.debitCents).toBe(tb.creditCents);
    expect(tb.accounts.accounts_receivable).toBe(0);
    expect(tb.accounts.cash).toBe(0);
    expect(tb.accounts.fee_revenue).toBe(0);

    const voidLegs = (await service.getInvoiceLedger(TENANT, invoice.id)).filter((e) =>
      e.memo?.startsWith('invoice voided'),
    );
    expect(voidLegs).toHaveLength(2);
    for (const leg of voidLegs) {
      expect(leg.amountCents).toBe(6_000);
      expect(leg.postedBy).toBe('bursar-1');
      expect(leg.memo).toBe('invoice voided: duplicate');
    }
  });

  it('HTTP: voiding a part-paid invoice returns 422; missing reason returns 400', async () => {
    const invoice = await partPaid();
    const app = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      const r = request as { tenantId?: string; user?: { sub?: string; roles?: unknown } };
      r.tenantId = TENANT;
      r.user = { sub: 'bursar-1', roles: ['bursar'] };
    });
    await app.register(feesPlugin, { repository, prefix: '/fees' });
    await app.ready();
    try {
      const noReason = await app.inject({
        method: 'POST',
        url: `/fees/invoices/${invoice.id}/void`,
        payload: {},
      });
      expect(noReason.statusCode).toBe(400);
      const partPaidVoid = await app.inject({
        method: 'POST',
        url: `/fees/invoices/${invoice.id}/void`,
        payload: { reason: 'duplicate' },
      });
      expect(partPaidVoid.statusCode).toBe(422);
    } finally {
      await app.close();
    }
  });
});
