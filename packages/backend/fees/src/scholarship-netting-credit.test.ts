/**
 * F-D1 / F-D2 — scholarship netting credits the verified disbursement amount in exact
 * integer paise against any open invoice (structure, plan or ad-hoc), up to the invoice's
 * open amount. Any remainder stays on the disbursement (amount / netted / remaining) and is
 * offered for the student's next open invoice; a disbursement is "netted" only once its full
 * amount has been applied. Netting the same disbursement twice (double click, retry, outbox
 * redelivery, concurrent calls) never credits more than the disbursement amount.
 */
import { describe, expect, it } from 'vitest';
import type { FeesMoneyAuditEvent, FeesMoneyAuditSink } from './fees-repository.js';
import type {
  NettableScholarshipDisbursement,
  ScholarshipDisbursementLookup,
} from './fees-service.js';
import { FeesService } from './fees-service.js';
import { InMemoryFeesRepository } from './in-memory-repository.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const STUDENT = '22222222-2222-4222-8222-222222222222';

function setup() {
  const repo = new InMemoryFeesRepository();
  const service = new FeesService(repo);
  return { repo, service };
}

function recordingAudit(): { sink: FeesMoneyAuditSink; events: FeesMoneyAuditEvent[] } {
  const events: FeesMoneyAuditEvent[] = [];
  return {
    events,
    sink: async (_tx, event) => {
      events.push(event);
    },
  };
}

function lookupFor(rows: NettableScholarshipDisbursement[]): ScholarshipDisbursementLookup {
  return {
    async findDisbursement(tenantId, id) {
      return rows.find((r) => r.id === id && r.tenantId === tenantId) ?? null;
    },
    async listPaidDisbursements(tenantId) {
      return rows.filter((r) => r.tenantId === tenantId && r.paymentStatus === 'paid');
    },
  };
}

async function structureInvoice(service: FeesService, amountCents: number) {
  const structure = await service.createFeeStructure(TENANT, 'staff', {
    name: `Tuition ${amountCents}`,
    category: 'tuition',
    amountCents,
  });
  const { created } = await service.bulkInvoiceClass(TENANT, 'staff', {
    structureId: structure.id,
    studentIds: [STUDENT],
  });
  return created[0]!;
}

async function nettingRows(repo: InMemoryFeesRepository, disbursementId: string) {
  return (await repo.listConcessions(TENANT)).filter(
    (c) => c.sourceDisbursementId === disbursementId,
  );
}

describe('F-D1 scholarship credit equals the verified disbursement amount', () => {
  it('credits an ad-hoc invoice (no structure) by the exact paise amount', async () => {
    const { repo, service } = setup();
    const invoice = await service.createInvoice(TENANT, 'staff', {
      studentId: STUDENT,
      title: 'Ad-hoc',
      amountCents: 200_000,
    });
    const result = await service.applyScholarshipNetting(TENANT, 'scholarship-netting', {
      studentId: STUDENT,
      disbursementId: 'disb-adhoc',
      amountCents: 50_025,
    });
    expect(result.idempotent).toBe(false);
    expect(result.discountCents).toBe(50_025);
    expect(result.invoice?.id).toBe(invoice.id);
    expect(result.invoice?.amountCents).toBe(149_975);
    expect((await service.getInvoice(TENANT, invoice.id)).amountCents).toBe(149_975);
    expect(result.nettedCents).toBe(50_025);
    expect(result.remainingCents).toBe(0);
    const rows = await nettingRows(repo, 'disb-adhoc');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amountCents).toBe(50_025);
    expect(rows[0]!.invoiceId).toBe(invoice.id);
    // Ledger: one balanced concession journal for exactly the credited paise.
    const legs = (await service.getInvoiceLedger(TENANT, invoice.id)).filter(
      (e) => e.memo === 'concession applied',
    );
    expect(legs.map((e) => e.amountCents)).toEqual([50_025, 50_025]);
    const tb = await service.getTrialBalance(TENANT);
    expect(tb.debitCents).toBe(tb.creditCents);
  });

  it('credits a fee-plan invoice by the exact paise amount', async () => {
    const { service } = setup();
    const plan = await service.createFeePlan(TENANT, 'staff', {
      name: 'Term plan',
      amountCents: 120_000,
    });
    const invoice = await service.createInvoice(TENANT, 'staff', {
      studentId: STUDENT,
      planId: plan.id,
    });
    const result = await service.applyScholarshipNetting(TENANT, 'scholarship-netting', {
      studentId: STUDENT,
      disbursementId: 'disb-plan',
      amountCents: 33_325,
    });
    expect(result.discountCents).toBe(33_325);
    expect((await service.getInvoice(TENANT, invoice.id)).amountCents).toBe(86_675);
  });

  it('credits a structure invoice by the exact paise amount (.25 case)', async () => {
    const { service } = setup();
    const invoice = await structureInvoice(service, 100_000);
    const result = await service.applyScholarshipNetting(TENANT, 'scholarship-netting', {
      studentId: STUDENT,
      disbursementId: 'disb-structure',
      amountCents: 25_025,
      invoiceId: invoice.id,
    });
    expect(result.discountCents).toBe(25_025);
    expect((await service.getInvoice(TENANT, invoice.id)).amountCents).toBe(74_975);
  });
});

describe('F-D2 excess over the open invoice is carried, never dropped', () => {
  it('applies up to the open amount and keeps the remainder nettable for the next invoice', async () => {
    const { repo, service } = setup();
    const first = await structureInvoice(service, 100_000);
    const audit = recordingAudit();
    const applied = await service.applyScholarshipNetting(
      TENANT,
      'scholarship-netting',
      { studentId: STUDENT, disbursementId: 'disb-excess', amountCents: 150_000 },
      audit.sink,
    );
    expect(applied.discountCents).toBe(100_000);
    expect(applied.invoice?.amountCents).toBe(0);
    expect(applied.invoice?.status).toBe('paid');
    expect(applied.nettedCents).toBe(100_000);
    expect(applied.remainingCents).toBe(50_000);
    expect(applied.amountCents).toBe(150_000);

    const lookup = lookupFor([
      {
        id: 'disb-excess',
        tenantId: TENANT,
        studentId: STUDENT,
        amountCents: 150_000,
        paymentStatus: 'paid',
      },
    ]);
    const nettable = await service.listNettableScholarshipDisbursements(TENANT, lookup);
    expect(nettable).toEqual([
      expect.objectContaining({
        id: 'disb-excess',
        amountCents: 150_000,
        nettedCents: 100_000,
        remainingCents: 50_000,
      }),
    ]);

    // Replay with no other open invoice: nothing new is credited, the stored credit and
    // the remainder are reported.
    const replay = await service.applyScholarshipNetting(TENANT, 'scholarship-netting', {
      studentId: STUDENT,
      disbursementId: 'disb-excess',
      amountCents: 150_000,
    });
    expect(replay.idempotent).toBe(true);
    expect(replay.discountCents).toBe(100_000);
    expect(replay.remainingCents).toBe(50_000);
    expect((await nettingRows(repo, 'disb-excess')).length).toBe(1);

    // The next open invoice takes part of the remainder…
    const second = await service.createInvoice(TENANT, 'staff', {
      studentId: STUDENT,
      title: 'Transport',
      amountCents: 30_000,
    });
    const carried = await service.applyScholarshipNetting(
      TENANT,
      'scholarship-netting',
      { studentId: STUDENT, disbursementId: 'disb-excess', amountCents: 150_000 },
      audit.sink,
    );
    expect(carried.idempotent).toBe(false);
    expect(carried.invoice?.id).toBe(second.id);
    expect(carried.discountCents).toBe(30_000);
    expect(carried.remainingCents).toBe(20_000);

    // …and a third takes the rest; the disbursement is then fully netted.
    const third = await service.createInvoice(TENANT, 'staff', {
      studentId: STUDENT,
      title: 'Library',
      amountCents: 50_000,
    });
    const last = await service.applyScholarshipNetting(
      TENANT,
      'scholarship-netting',
      { studentId: STUDENT, disbursementId: 'disb-excess', amountCents: 150_000 },
      audit.sink,
    );
    expect(last.invoice?.id).toBe(third.id);
    expect(last.discountCents).toBe(20_000);
    expect(last.remainingCents).toBe(0);
    expect((await service.getInvoice(TENANT, third.id)).amountCents).toBe(30_000);
    expect(await service.listNettableScholarshipDisbursements(TENANT, lookup)).toEqual([]);

    // Money conservation: credits sum to the disbursement, no invoice went negative.
    const rows = await nettingRows(repo, 'disb-excess');
    expect(rows.reduce((sum, r) => sum + (r.amountCents ?? 0), 0)).toBe(150_000);
    for (const id of [first.id, second.id, third.id]) {
      expect((await service.getInvoice(TENANT, id)).amountCents).toBeGreaterThanOrEqual(0);
    }
    // Every netting is audited with the credited paise and the invoice it touched.
    expect(audit.events.map((e) => [e.kind, e.invoiceId, e.amountCents])).toEqual([
      ['scholarship_netting', first.id, 100_000],
      ['scholarship_netting', second.id, 30_000],
      ['scholarship_netting', third.id, 20_000],
    ]);
  });

  it('never credits more than the open amount after a part payment', async () => {
    const { service } = setup();
    const invoice = await service.createInvoice(TENANT, 'staff', {
      studentId: STUDENT,
      title: 'Ad-hoc',
      amountCents: 100_000,
    });
    await service.recordPayment(TENANT, 'staff', {
      invoiceId: invoice.id,
      amountCents: 60_000,
      method: 'cash',
    });
    const result = await service.applyScholarshipNetting(TENANT, 'scholarship-netting', {
      studentId: STUDENT,
      disbursementId: 'disb-part-paid',
      amountCents: 70_000,
    });
    expect(result.discountCents).toBe(40_000);
    expect(result.remainingCents).toBe(30_000);
    const after = await service.getInvoice(TENANT, invoice.id);
    expect(after.amountCents).toBe(60_000);
    expect(after.status).toBe('paid');
  });

  it('leaves the full amount nettable when the student has no open invoice', async () => {
    const { repo, service } = setup();
    const result = await service.applyScholarshipNetting(TENANT, 'scholarship-netting', {
      studentId: STUDENT,
      disbursementId: 'disb-no-invoice',
      amountCents: 12_345,
    });
    expect(result.invoice).toBeNull();
    expect(result.discountCents).toBe(0);
    expect(result.remainingCents).toBe(12_345);
    expect(await nettingRows(repo, 'disb-no-invoice')).toEqual([]);
    const later = await service.createInvoice(TENANT, 'staff', {
      studentId: STUDENT,
      title: 'Ad-hoc',
      amountCents: 50_000,
    });
    const applied = await service.applyScholarshipNetting(TENANT, 'scholarship-netting', {
      studentId: STUDENT,
      disbursementId: 'disb-no-invoice',
      amountCents: 12_345,
    });
    expect(applied.invoice?.id).toBe(later.id);
    expect(applied.discountCents).toBe(12_345);
    expect(applied.remainingCents).toBe(0);
  });
});

describe('F-D1/F-D2 netting is idempotent and safe under concurrency', () => {
  it('rejects a second netting of a fully netted disbursement', async () => {
    const { repo, service } = setup();
    const invoice = await service.createInvoice(TENANT, 'staff', {
      studentId: STUDENT,
      title: 'Ad-hoc',
      amountCents: 200_000,
    });
    const other = await service.createInvoice(TENANT, 'staff', {
      studentId: STUDENT,
      title: 'Second open invoice',
      amountCents: 200_000,
    });
    const audit = recordingAudit();
    const input = { studentId: STUDENT, disbursementId: 'disb-once', amountCents: 50_025 };
    const first = await service.applyScholarshipNetting(TENANT, 'n', input, audit.sink);
    const second = await service.applyScholarshipNetting(TENANT, 'n', input, audit.sink);
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.discountCents).toBe(50_025);
    expect(await nettingRows(repo, 'disb-once')).toHaveLength(1);
    expect(
      (await service.getInvoice(TENANT, invoice.id)).amountCents +
        (await service.getInvoice(TENANT, other.id)).amountCents,
    ).toBe(400_000 - 50_025);
    expect(audit.events).toHaveLength(1);
  });

  it('concurrent nettings of one disbursement credit its amount exactly once', async () => {
    const { repo, service } = setup();
    const a = await service.createInvoice(TENANT, 'staff', {
      studentId: STUDENT,
      title: 'A',
      amountCents: 40_000,
    });
    const b = await service.createInvoice(TENANT, 'staff', {
      studentId: STUDENT,
      title: 'B',
      amountCents: 40_000,
    });
    const input = { studentId: STUDENT, disbursementId: 'disb-race', amountCents: 50_025 };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => service.applyScholarshipNetting(TENANT, 'n', input)),
    );
    const credited = results
      .filter((r) => !r.idempotent)
      .reduce((sum, r) => sum + r.discountCents, 0);
    expect(credited).toBe(50_025);
    const rows = await nettingRows(repo, 'disb-race');
    expect(rows.reduce((sum, r) => sum + (r.amountCents ?? 0), 0)).toBe(50_025);
    const faces =
      (await service.getInvoice(TENANT, a.id)).amountCents +
      (await service.getInvoice(TENANT, b.id)).amountCents;
    expect(faces).toBe(80_000 - 50_025);
  });

  it('reversal restores every invoice by the credit it received', async () => {
    const { service } = setup();
    const first = await structureInvoice(service, 100_000);
    await service.applyScholarshipNetting(TENANT, 'n', {
      studentId: STUDENT,
      disbursementId: 'disb-reverse',
      amountCents: 150_000,
    });
    const second = await service.createInvoice(TENANT, 'staff', {
      studentId: STUDENT,
      title: 'Transport',
      amountCents: 80_000,
    });
    await service.applyScholarshipNetting(TENANT, 'n', {
      studentId: STUDENT,
      disbursementId: 'disb-reverse',
      amountCents: 150_000,
    });
    expect((await service.getInvoice(TENANT, second.id)).amountCents).toBe(30_000);
    const reversed = await service.reverseScholarshipNetting(TENANT, 'n', {
      disbursementId: 'disb-reverse',
    });
    expect(reversed.reversed).toBe(true);
    expect(reversed.discountCents).toBe(150_000);
    const firstAfter = await service.getInvoice(TENANT, first.id);
    expect(firstAfter.amountCents).toBe(100_000);
    // The restored balance is collectable again.
    expect(firstAfter.status).toBe('open');
    expect((await service.getInvoice(TENANT, second.id)).amountCents).toBe(80_000);
    const tb = await service.getTrialBalance(TENANT);
    expect(tb.debitCents).toBe(tb.creditCents);
  });
});
