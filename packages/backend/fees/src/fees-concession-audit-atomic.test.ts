/**
 * PRC-L306: concession approve/reject and scholarship netting / reversal write their
 * audit inside the money transaction. A failing audit append leaves the concession
 * pending (approve/reject) or un-created (netting), the invoice face unchanged and
 * no journal; the approved status flip happens under the invoice lock.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { FeesMoneyAuditEvent, FeesMoneyAuditSink } from './fees-repository.js';
import { FeesService } from './fees-service.js';
import { InMemoryFeesRepository } from './in-memory-repository.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';

const TENANT = '00000000-0000-4000-8000-0000000000a2';
const STUDENT = '00000000-0000-4000-8000-0000000000b2';

const failingAudit: FeesMoneyAuditSink = async () => {
  throw new Error('audit sink down');
};

describe('concession + netting audit atomicity (PRC-L306)', () => {
  let repository: InMemoryFeesRepository;
  let service: FeesService;

  beforeEach(() => {
    repository = new InMemoryFeesRepository();
    service = new FeesService(repository, new SandboxPaymentAdapter());
  });

  async function pendingConcession(withInvoice = true) {
    const structure = await service.createFeeStructure(TENANT, 'staff-1', {
      name: 'Tuition',
      category: 'tuition',
      amountCents: 10_000,
    });
    const invoice = withInvoice
      ? await service.createInvoice(TENANT, 'staff-1', {
          studentId: STUDENT,
          title: 'Tuition',
          amountCents: 10_000,
        })
      : null;
    const pending = await service.applyConcession(TENANT, 'clerk-1', {
      studentId: STUDENT,
      structureId: structure.id,
      ...(invoice ? { invoiceId: invoice.id } : {}),
      kind: 'amount',
      amountCents: 2_000,
      reason: 'hardship',
    });
    return { structure, invoice, concession: pending.concession };
  }

  /** Netting credits invoices billed from a fee structure (bulk invoice path). */
  async function structuredInvoice() {
    const structure = await service.createFeeStructure(TENANT, 'staff-1', {
      name: 'Tuition',
      category: 'tuition',
      amountCents: 10_000,
    });
    const { created } = await service.bulkInvoiceClass(TENANT, 'staff-1', {
      structureId: structure.id,
      studentIds: [STUDENT],
    });
    return created[0]!;
  }

  async function ledgerLegs(invoiceId: string) {
    return (await service.getInvoiceLedger(TENANT, invoiceId)).length;
  }

  it('audit failure on approve leaves the concession pending and the invoice untouched', async () => {
    const { invoice, concession } = await pendingConcession();
    const legs = await ledgerLegs(invoice!.id);
    await expect(
      service.approveConcession(TENANT, 'bursar-1', concession.id, failingAudit),
    ).rejects.toThrow('audit sink down');
    expect((await repository.findConcessionById(concession.id, TENANT))?.status).toBe('pending');
    expect((await service.getInvoice(TENANT, invoice!.id)).amountCents).toBe(10_000);
    expect(await ledgerLegs(invoice!.id)).toBe(legs);
    // A retry after the sink recovers approves exactly once.
    const ok = await service.approveConcession(TENANT, 'bursar-1', concession.id);
    expect(ok.concession.status).toBe('approved');
    expect(ok.invoice?.amountCents).toBe(8_000);
  });

  it('audit failure on approve without a target invoice leaves it pending', async () => {
    const { concession } = await pendingConcession(false);
    await expect(
      service.approveConcession(TENANT, 'bursar-1', concession.id, failingAudit),
    ).rejects.toThrow('audit sink down');
    expect((await repository.findConcessionById(concession.id, TENANT))?.status).toBe('pending');
  });

  it('audit failure on reject leaves the concession pending', async () => {
    const { concession } = await pendingConcession();
    await expect(
      service.rejectConcession(TENANT, 'bursar-1', concession.id, failingAudit),
    ).rejects.toThrow('audit sink down');
    expect((await repository.findConcessionById(concession.id, TENANT))?.status).toBe('pending');
  });

  it('reject emits an in-transaction audit event', async () => {
    const { invoice, concession } = await pendingConcession();
    const events: FeesMoneyAuditEvent[] = [];
    await service.rejectConcession(TENANT, 'bursar-1', concession.id, async (_tx, e) => {
      events.push(e);
    });
    expect(events).toEqual([
      {
        kind: 'concession_reject',
        entityId: concession.id,
        invoiceId: invoice!.id,
        amountCents: 0,
        beforeStatus: 'pending',
        afterStatus: 'rejected',
      },
    ]);
  });

  it('approve after a concurrent reject is refused (status re-checked under the lock)', async () => {
    const { concession } = await pendingConcession();
    const [a, b] = await Promise.allSettled([
      service.rejectConcession(TENANT, 'bursar-1', concession.id),
      service.approveConcession(TENANT, 'bursar-2', concession.id),
    ]);
    expect([a.status, b.status].filter((s) => s === 'fulfilled')).toHaveLength(1);
    const final = await repository.findConcessionById(concession.id, TENANT);
    expect(['approved', 'rejected']).toContain(final?.status);
  });

  it('audit failure on scholarship netting creates no concession and no credit; replay nets once', async () => {
    const invoice = await structuredInvoice();
    const input = { studentId: STUDENT, disbursementId: 'disb-1', amountCents: 3_000 };
    await expect(
      service.applyScholarshipNetting(TENANT, 'scholarship-netting', input, failingAudit),
    ).rejects.toThrow('audit sink down');
    expect(await repository.findConcessionBySourceDisbursementId(TENANT, 'disb-1')).toBeNull();
    expect((await service.getInvoice(TENANT, invoice.id)).amountCents).toBe(10_000);

    const events: FeesMoneyAuditEvent[] = [];
    const sink: FeesMoneyAuditSink = async (_tx, e) => {
      events.push(e);
    };
    const first = await service.applyScholarshipNetting(TENANT, 'scholarship-netting', input, sink);
    const replay = await service.applyScholarshipNetting(TENANT, 'scholarship-netting', input, sink);
    expect(first.idempotent).toBe(false);
    expect(replay.idempotent).toBe(true);
    expect((await service.getInvoice(TENANT, invoice.id)).amountCents).toBe(7_000);
    expect(events.map((e) => [e.kind, e.amountCents])).toEqual([['scholarship_netting', 3_000]]);
  });

  it('audit failure on netting reversal keeps the credit in place', async () => {
    const invoice = await structuredInvoice();
    await service.applyScholarshipNetting(TENANT, 'scholarship-netting', {
      studentId: STUDENT,
      disbursementId: 'disb-2',
      amountCents: 3_000,
    });
    await expect(
      service.reverseScholarshipNetting(
        TENANT,
        'scholarship-netting',
        { disbursementId: 'disb-2' },
        failingAudit,
      ),
    ).rejects.toThrow('audit sink down');
    expect((await service.getInvoice(TENANT, invoice.id)).amountCents).toBe(7_000);
    expect(
      (await repository.findConcessionBySourceDisbursementId(TENANT, 'disb-2'))?.status,
    ).toBe('approved');
  });
});
