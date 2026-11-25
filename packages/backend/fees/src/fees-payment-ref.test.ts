/**
 * PRC-M535: `isRecordedPaymentRef` answers whether a reference names a
 * succeeded payment recorded on that invoice (payment id, idempotency key or
 * receipt number). The admissions guardian accept uses it to refuse made-up
 * payment references.
 */
import { NotFoundError } from '@proctira/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { FeesService } from './fees-service.js';
import { InMemoryFeesRepository } from './in-memory-repository.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';

const TENANT = '00000000-0000-4000-8000-0000000005a1';
const OTHER_TENANT = '00000000-0000-4000-8000-0000000005a2';
const STUDENT = '00000000-0000-4000-8000-0000000005b1';

describe('PRC-M535 FeesService.isRecordedPaymentRef', () => {
  let service: FeesService;

  beforeEach(() => {
    service = new FeesService(new InMemoryFeesRepository(), new SandboxPaymentAdapter());
  });

  async function invoice(tenantId = TENANT) {
    return service.createInvoice(tenantId, 'staff-1', {
      studentId: STUDENT,
      title: 'Offer fee',
      amountCents: 10_000,
      dueAt: '2030-01-01T00:00:00.000Z',
    } as never);
  }

  it('matches the payment id, the idempotency key and the receipt number', async () => {
    const inv = await invoice();
    const { payment, receipt } = await service.recordPayment(TENANT, 'parent-1', {
      invoiceId: inv.id,
      amountCents: 10_000,
      idempotencyKey: 'psp-evt-42',
    });
    expect(await service.isRecordedPaymentRef(TENANT, inv.id, payment.id)).toBe(true);
    expect(await service.isRecordedPaymentRef(TENANT, inv.id, 'psp-evt-42')).toBe(true);
    expect(await service.isRecordedPaymentRef(TENANT, inv.id, receipt.receiptNumber)).toBe(true);
  });

  it('rejects a made-up reference and a payment recorded on another invoice', async () => {
    const inv = await invoice();
    const other = await invoice();
    const { payment } = await service.recordPayment(TENANT, 'parent-1', {
      invoiceId: other.id,
      amountCents: 10_000,
    });
    expect(await service.isRecordedPaymentRef(TENANT, inv.id, 'SANDBOX-PAY')).toBe(false);
    expect(await service.isRecordedPaymentRef(TENANT, inv.id, payment.id)).toBe(false);
    expect(await service.isRecordedPaymentRef(TENANT, inv.id, '   ')).toBe(false);
  });

  it('does not see another tenant invoice (NotFoundError)', async () => {
    const inv = await invoice(OTHER_TENANT);
    await expect(service.isRecordedPaymentRef(TENANT, inv.id, 'x')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
