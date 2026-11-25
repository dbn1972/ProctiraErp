/**
 * PRC-M246 / PRC-M090: a refund targets one succeeded payment of the invoice, is
 * capped at that payment's unrefunded amount, and never silently picks "the first"
 * payment of a multi-payment invoice.
 */
import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { BusinessRuleError, NotFoundError } from '@proctira/common';
import { feesPlugin } from './fees-plugin.js';
import { FeesService } from './fees-service.js';
import { InMemoryFeesRepository } from './in-memory-repository.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const STUDENT = '00000000-0000-4000-8000-000000000099';

describe('PRC-M246 refund by payment', () => {
  let repository: InMemoryFeesRepository;
  let service: FeesService;
  let invoiceId: string;
  let firstPaymentId: string;
  let secondPaymentId: string;

  beforeEach(async () => {
    repository = new InMemoryFeesRepository();
    service = new FeesService(repository, new SandboxPaymentAdapter());
    const invoice = await service.createInvoice(TENANT, 'staff-1', {
      studentId: STUDENT,
      title: 'Tuition',
      amountCents: 10_000,
    });
    invoiceId = invoice.id;
    const first = await service.recordPayment(TENANT, 'staff-1', {
      invoiceId,
      amountCents: 6_000,
    });
    const second = await service.recordPayment(TENANT, 'staff-1', {
      invoiceId,
      amountCents: 4_000,
    });
    firstPaymentId = first.payment.id;
    secondPaymentId = second.payment.id;
  });

  it('records the refund against the named payment', async () => {
    const refund = await service.recordRefund(TENANT, 'staff-1', {
      invoiceId,
      paymentId: secondPaymentId,
      amountCents: 1_500,
      reason: 'overcharge',
    });
    expect(refund.paymentId).toBe(secondPaymentId);
  });

  it('refuses a refund above the targeted payment even when the invoice total allows it', async () => {
    await expect(
      service.recordRefund(TENANT, 'staff-1', {
        invoiceId,
        paymentId: secondPaymentId,
        amountCents: 4_001,
        reason: 'too much',
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    await service.recordRefund(TENANT, 'staff-1', {
      invoiceId,
      paymentId: secondPaymentId,
      amountCents: 3_000,
      reason: 'part',
    });
    await expect(
      service.recordRefund(TENANT, 'staff-1', {
        invoiceId,
        paymentId: secondPaymentId,
        amountCents: 1_001,
        reason: 'beyond the rest of that payment',
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(await repository.listRefundsForInvoice(TENANT, invoiceId)).toHaveLength(1);
  });

  it('refuses a payment id from another invoice (404) and a missing id on a multi-payment invoice', async () => {
    const other = await service.createInvoice(TENANT, 'staff-1', {
      studentId: STUDENT,
      title: 'Bus',
      amountCents: 2_000,
    });
    const otherPayment = await service.recordPayment(TENANT, 'staff-1', {
      invoiceId: other.id,
      amountCents: 2_000,
    });
    await expect(
      service.recordRefund(TENANT, 'staff-1', {
        invoiceId,
        paymentId: otherPayment.payment.id,
        amountCents: 100,
        reason: 'wrong invoice',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.recordRefund(TENANT, 'staff-1', {
        invoiceId,
        amountCents: 100,
        reason: 'which payment?',
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(await repository.listRefundsForInvoice(TENANT, invoiceId)).toHaveLength(0);
  });

  it('defaults to the only payment when the invoice has exactly one', async () => {
    const single = await service.createInvoice(TENANT, 'staff-1', {
      studentId: STUDENT,
      title: 'Lab',
      amountCents: 1_000,
    });
    const paid = await service.recordPayment(TENANT, 'staff-1', { invoiceId: single.id });
    const refund = await service.recordRefund(TENANT, 'staff-1', {
      invoiceId: single.id,
      amountCents: 250,
      reason: 'breakage deposit',
    });
    expect(refund.paymentId).toBe(paid.payment.id);
  });

  it('PRC-M090: GET /invoices/:id/payments lists what is refundable per payment (staff only)', async () => {
    await service.recordRefund(TENANT, 'staff-1', {
      invoiceId,
      paymentId: firstPaymentId,
      amountCents: 1_000,
      reason: 'part',
    });
    const build = async (roles: string[]) => {
      const app = Fastify();
      app.decorateRequest('tenantId', '');
      app.addHook('onRequest', async (request) => {
        const r = request as { tenantId?: string; user?: { sub?: string; roles?: unknown } };
        r.tenantId = TENANT;
        r.user = { sub: 'u-1', roles };
      });
      await app.register(feesPlugin, { repository, prefix: '/fees' });
      await app.ready();
      return app;
    };
    const staff = await build(['bursar']);
    const res = await staff.inject({ method: 'GET', url: `/fees/invoices/${invoiceId}/payments` });
    await staff.close();
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ paymentId: string; refundableCents: number }>;
    expect(rows.find((r) => r.paymentId === firstPaymentId)).toMatchObject({
      amountCents: 6_000,
      refundedCents: 1_000,
      refundableCents: 5_000,
    });
    expect(rows.find((r) => r.paymentId === secondPaymentId)?.refundableCents).toBe(4_000);
    const parent = await build(['parent']);
    const denied = await parent.inject({
      method: 'GET',
      url: `/fees/invoices/${invoiceId}/payments`,
    });
    await parent.close();
    expect(denied.statusCode).toBe(403);
  });

  it('HTTP: refund with a foreign paymentId is 404 and posts nothing', async () => {
    const app = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      const r = request as { tenantId?: string; user?: { sub?: string; roles?: unknown } };
      r.tenantId = TENANT;
      r.user = { sub: 'bursar-1', roles: ['bursar'] };
    });
    await app.register(feesPlugin, { repository, prefix: '/fees' });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: `/fees/invoices/${invoiceId}/refund`,
      payload: {
        paymentId: '00000000-0000-4000-8000-0000000000ff',
        amountCents: 100,
        reason: 'x',
      },
    });
    const ok = await app.inject({
      method: 'POST',
      url: `/fees/invoices/${invoiceId}/refund`,
      payload: { paymentId: firstPaymentId, amountCents: 100, reason: 'y' },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(ok.statusCode).toBe(201);
    expect(ok.json().paymentId).toBe(firstPaymentId);
    expect(await repository.listRefundsForInvoice(TENANT, invoiceId)).toHaveLength(1);
  });
});
