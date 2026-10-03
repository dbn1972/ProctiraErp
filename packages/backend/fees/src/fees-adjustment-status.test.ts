/**
 * PRC-M245: adjustments recompute invoice status; concessions cannot exceed the unpaid balance.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { FeesService } from './fees-service.js';
import { InMemoryFeesRepository } from './in-memory-repository.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';

const TENANT = '00000000-0000-4000-8000-0000000000c1';
const STUDENT = '00000000-0000-4000-8000-0000000000d1';

describe('PRC-M245 adjustment status recompute', () => {
  let service: FeesService;

  beforeEach(() => {
    service = new FeesService(new InMemoryFeesRepository(), new SandboxPaymentAdapter());
  });

  async function partPaid() {
    const invoice = await service.createInvoice(TENANT, 'staff-1', {
      studentId: STUDENT,
      title: 'Term',
      amountCents: 10_000,
      dueAt: '2020-01-01T00:00:00.000Z',
    } as never);
    await service.recordPayment(TENANT, 'parent-1', { invoiceId: invoice.id, amountCents: 4_000 });
    return invoice;
  }

  it('10000 invoice, pay 4000, credit note 6000 -> paid and not in dues/overdue', async () => {
    const invoice = await partPaid();
    const { invoice: after } = await service.issueCreditNote(TENANT, 'bursar-1', {
      invoiceId: invoice.id,
      amountCents: 6_000,
      reason: 'sibling discount',
    });
    expect(after.status).toBe('paid');
    const overdue = await service.listOverdueForReminder(TENANT, new Date());
    expect(overdue.find((r) => r.invoiceId === invoice.id)).toBeUndefined();
  });

  it('partial credit note keeps the invoice open', async () => {
    const invoice = await partPaid();
    const { invoice: after } = await service.issueCreditNote(TENANT, 'bursar-1', {
      invoiceId: invoice.id,
      amountCents: 1_000,
      reason: 'goodwill',
    });
    expect(after.status).toBe('open');
  });

  async function concessionFor(invoiceId: string, amountCents: number) {
    const structure = await service.createFeeStructure(TENANT, 'staff-1', {
      code: `S${amountCents}`,
      name: 'Tuition',
      category: 'tuition',
      amountCents: 10_000,
      currency: 'INR',
    } as never);
    return service.applyConcession(TENANT, 'clerk-1', {
      studentId: STUDENT,
      structureId: structure.id,
      invoiceId,
      kind: 'amount',
      amountCents,
      reason: 'need based',
    } as never);
  }

  it('concession exceeding the unpaid balance is rejected and stays pending', async () => {
    const invoice = await partPaid();
    const { concession } = await concessionFor(invoice.id, 7_000);
    await expect(service.approveConcession(TENANT, 'bursar-1', concession.id)).rejects.toThrow(
      /exceeds unpaid balance/,
    );
    const inv = await service.getInvoice(TENANT, invoice.id);
    expect(inv.amountCents).toBe(10_000);
  });

  it('concession equal to the unpaid balance settles the invoice', async () => {
    const invoice = await partPaid();
    const { concession } = await concessionFor(invoice.id, 6_000);
    const res = await service.approveConcession(TENANT, 'bursar-1', concession.id);
    expect(res.invoice?.status).toBe('paid');
    expect(res.concession.status).toBe('approved');
  });
});
