/**
 * PRC-L306: refund / credit note / write-off / void audit runs inside the
 * locked money transaction; a failing audit append rolls the movement back.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { FeesMoneyAuditEvent, FeesMoneyAuditSink } from './fees-repository.js';
import { FeesService } from './fees-service.js';
import { InMemoryFeesRepository } from './in-memory-repository.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';

const TENANT = '00000000-0000-4000-8000-0000000000a1';
const STUDENT = '00000000-0000-4000-8000-0000000000b1';
const failingAudit: FeesMoneyAuditSink = async () => {
  throw new Error('audit sink down');
};

describe('fees money audit atomicity (PRC-L306)', () => {
  let repository: InMemoryFeesRepository;
  let service: FeesService;
  beforeEach(() => {
    repository = new InMemoryFeesRepository();
    service = new FeesService(repository, new SandboxPaymentAdapter());
  });
  async function invoice(face: number, paid: number) {
    const inv = await service.createInvoice(TENANT, 'staff-1', {
      studentId: STUDENT,
      title: 'Audit probe',
      amountCents: face,
    });
    if (paid > 0) {
      await service.recordPayment(TENANT, 'parent-1', { invoiceId: inv.id, amountCents: paid });
    }
    return inv;
  }
  async function journalLegCount(invoiceId: string) {
    return (await service.getInvoiceLedger(TENANT, invoiceId)).length;
  }

  it('audit failure rolls back a refund and its journal', async () => {
    const inv = await invoice(10_000, 10_000);
    const legs = await journalLegCount(inv.id);
    await expect(
      service.recordRefund(
        TENANT,
        'staff-2',
        { invoiceId: inv.id, amountCents: 5_000, reason: 'r' },
        failingAudit,
      ),
    ).rejects.toThrow('audit sink down');
    expect(await repository.listRefundsForInvoice(TENANT, inv.id)).toHaveLength(0);
    expect(await journalLegCount(inv.id)).toBe(legs);
  });

  it('audit failure rolls back a write-off and the invoice face', async () => {
    const inv = await invoice(10_000, 0);
    await expect(
      service.writeOffInvoice(
        TENANT,
        'staff-2',
        { invoiceId: inv.id, amountCents: 10_000, reason: 'uncollectible' },
        failingAudit,
      ),
    ).rejects.toThrow('audit sink down');
    const after = await service.getInvoice(TENANT, inv.id);
    expect(after.status).toBe('open');
    expect(after.amountCents).toBe(10_000);
  });

  it('audit failure rolls back a credit note and a void', async () => {
    const inv = await invoice(10_000, 0);
    await expect(
      service.issueCreditNote(
        TENANT,
        'staff-2',
        { invoiceId: inv.id, amountCents: 1_000, reason: 'goodwill' },
        failingAudit,
      ),
    ).rejects.toThrow('audit sink down');
    await expect(
      service.voidInvoice(TENANT, inv.id, { actorId: 'staff-2', audit: failingAudit }),
    ).rejects.toThrow('audit sink down');
    const after = await service.getInvoice(TENANT, inv.id);
    expect(after.status).toBe('open');
    expect(after.amountCents).toBe(10_000);
  });

  it('emits amount and before/after status for the audit record', async () => {
    const inv = await invoice(10_000, 10_000);
    const events: FeesMoneyAuditEvent[] = [];
    const refund = await service.recordRefund(
      TENANT,
      'staff-2',
      { invoiceId: inv.id, amountCents: 2_500, reason: 'r' },
      async (_tx, event) => {
        events.push(event);
      },
    );
    expect(events).toEqual([
      {
        kind: 'refund',
        entityId: refund.id,
        invoiceId: inv.id,
        amountCents: 2_500,
        beforeStatus: 'paid',
        afterStatus: 'paid',
      },
    ]);
  });
});
