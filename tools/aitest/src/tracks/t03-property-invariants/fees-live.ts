/**
 * Fees commands against the live backend package: `FeesService` over
 * `PgFeesRepository` (runtime role, RLS enforced), the same construction as
 * packages/backend/fees/src/pg-fees-ledger.live.test.ts. Each property run
 * uses a fresh random tenant and student.
 */
import { randomUUID } from 'node:crypto';

import { FeesService, PgFeesRepository, SandboxPaymentAdapter } from '@proctira/backend-fees';
import { getSharedPgPool, withPgTenant } from '@proctira/database';
import { ensurePgTestStudent } from '@proctira/database/test-fixtures';
import fc from 'fast-check';

import { agree, attempt, pick, type CommandStats, type ViolationLog } from './core.js';
import {
  checkFeesSnapshot,
  emptyFeesModel,
  expectedDiscount,
  expectedInstalments,
  FEES_INVARIANTS,
  paidOf,
  refundedOf,
  unpaidOf,
  type FeesModel,
  type FeesSnapshot,
  type MInvoice,
} from './fees-model.js';
import type { DomainSpec, RealBase } from './runner.js';

type Pool = NonNullable<ReturnType<typeof getSharedPgPool>>;

export interface FeesReal extends RealBase {
  pool: Pool;
  tenantId: string;
  studentId: string;
  service: FeesService;
}

type Cmd = fc.AsyncCommand<FeesModel, FeesReal, boolean>;

const num = (v: unknown) => Number(v);

export async function loadFeesSnapshot(pool: Pool, tenantId: string): Promise<FeesSnapshot> {
  return withPgTenant(pool, tenantId, async (c) => {
    const q = async (sql: string) =>
      (await c.query(sql, [tenantId])).rows as Record<string, unknown>[];
    // One client: queries run one after another (pg forbids overlapping queries).
    const ledger = await q(
      `SELECT journal_id, invoice_id, account, side, amount_cents FROM fee_ledger_entries WHERE tenant_id = $1`,
    );
    const invoices = await q(
      `SELECT id, amount_cents, status, structure_id FROM parent_fee_invoices WHERE tenant_id = $1`,
    );
    const payments = await q(
      `SELECT id, invoice_id, amount_cents, status FROM parent_fee_payments WHERE tenant_id = $1`,
    );
    const receipts = await q(
      `SELECT payment_id, invoice_id, amount_cents FROM parent_fee_receipts WHERE tenant_id = $1`,
    );
    const refunds = await q(
      `SELECT payment_id, invoice_id, amount_cents, status FROM fee_refunds WHERE tenant_id = $1`,
    );
    const cn = await q(
      `SELECT invoice_id, amount_cents, status FROM fee_credit_notes WHERE tenant_id = $1`,
    );
    const wo = await q(
      `SELECT invoice_id, amount_cents, status FROM fee_write_offs WHERE tenant_id = $1`,
    );
    const conc =
      await q(`SELECT id, invoice_id, structure_id, source_disbursement_id, amount_cents, status, journal_id
             FROM fee_concessions WHERE tenant_id = $1`);
    const inst = await q(
      `SELECT structure_id, amount_cents FROM fee_structure_instalments WHERE tenant_id = $1`,
    );
    const structures = await q(
      `SELECT id, amount_cents, code FROM fee_structures WHERE tenant_id = $1`,
    );
    const recon = await q(`SELECT invoice_id, payment_id, amount_cents, matched, bank_reference,
                  to_char(value_date, 'YYYY-MM-DD') AS value_date
             FROM fee_reconciliation_rows WHERE tenant_id = $1`);

    const s = (v: unknown) => (v == null ? null : String(v));
    return {
      ledger: ledger.map((r) => ({
        journalId: String(r.journal_id),
        invoiceId: s(r.invoice_id),
        account: String(r.account) as FeesSnapshot['ledger'][number]['account'],
        side: String(r.side) as 'debit' | 'credit',
        amount: num(r.amount_cents),
      })),
      invoices: invoices.map((r) => ({
        id: String(r.id),
        face: num(r.amount_cents),
        status: String(r.status),
        structureId: s(r.structure_id),
      })),
      payments: payments.map((r) => ({
        id: String(r.id),
        invoiceId: String(r.invoice_id),
        amount: num(r.amount_cents),
        status: String(r.status),
      })),
      receipts: receipts.map((r) => ({
        paymentId: String(r.payment_id),
        invoiceId: String(r.invoice_id),
        amount: num(r.amount_cents),
      })),
      refunds: refunds.map((r) => ({
        paymentId: s(r.payment_id),
        invoiceId: String(r.invoice_id),
        amount: num(r.amount_cents),
        status: String(r.status),
      })),
      creditNotes: cn.map((r) => ({
        invoiceId: String(r.invoice_id),
        amount: num(r.amount_cents),
        status: String(r.status),
      })),
      writeOffs: wo.map((r) => ({
        invoiceId: String(r.invoice_id),
        amount: num(r.amount_cents),
        status: String(r.status),
      })),
      concessions: conc.map((r) => ({
        id: String(r.id),
        invoiceId: s(r.invoice_id),
        structureId: String(r.structure_id),
        sourceDisbursementId: s(r.source_disbursement_id),
        amount: r.amount_cents == null ? null : num(r.amount_cents),
        status: String(r.status),
        journalId: s(r.journal_id),
      })),
      instalments: inst.map((r) => ({
        structureId: String(r.structure_id),
        amount: num(r.amount_cents),
      })),
      structures: structures.map((r) => ({
        id: String(r.id),
        amount: num(r.amount_cents),
        code: String(r.code),
      })),
      reconRows: recon.map((r) => ({
        invoiceId: s(r.invoice_id),
        paymentId: s(r.payment_id),
        amount: num(r.amount_cents),
        matched: Boolean(r.matched),
        bankReference: s(r.bank_reference),
        valueDate: s(r.value_date),
      })),
    };
  });
}

async function afterCommand(m: FeesModel, r: FeesReal): Promise<void> {
  checkFeesSnapshot(r.log, m, await loadFeesSnapshot(r.pool, r.tenantId));
}

/** Base class: subclasses implement `exec`, the snapshot check always runs. */
abstract class FeesCommand implements Cmd {
  abstract readonly name: string;
  check(_m: Readonly<FeesModel>): boolean {
    return true;
  }
  protected abstract exec(m: FeesModel, r: FeesReal): Promise<boolean>;
  async run(m: FeesModel, r: FeesReal): Promise<void> {
    const accepted = await this.exec(m, r);
    r.stats.note(this.name, accepted);
    await afterCommand(m, r);
  }
  abstract toString(): string;
}

function addInvoice(
  m: FeesModel,
  inv: { id: string; invoiceNumber: string | null; amountCents: number },
  kind: MInvoice['kind'],
  structureId: string | null,
) {
  m.invoices.push({
    id: inv.id,
    number: inv.invoiceNumber ?? inv.id.slice(0, 8),
    kind,
    structureId,
    issued: inv.amountCents,
    face: inv.amountCents,
    status: 'open',
    payments: [],
  });
}

class CreatePlan extends FeesCommand {
  readonly name = 'CreatePlan';
  constructor(readonly amount: number) {
    super();
  }
  protected async exec(m: FeesModel, r: FeesReal) {
    m.seq += 1;
    const got = await attempt(() =>
      r.service.createFeePlan(r.tenantId, 'staff-1', {
        name: `Plan ${m.seq} ${randomUUID().slice(0, 6)}`,
        amountCents: this.amount,
      }),
    );
    if (!agree(r.log, String(this), { accept: true, why: 'non-negative integer amount' }, got)) {
      return false;
    }
    m.plans.push({ id: got.value.id, amount: got.value.amountCents });
    return true;
  }
  toString() {
    return `CreatePlan(${this.amount})`;
  }
}

class CreateInvoice extends FeesCommand {
  readonly name = 'CreateInvoice';
  constructor(
    readonly amount: number,
    readonly planIdx: number | null,
  ) {
    super();
  }
  protected async exec(m: FeesModel, r: FeesReal) {
    const plan = this.planIdx === null ? undefined : pick(m.plans, this.planIdx);
    const amount = plan ? plan.amount : this.amount;
    const valid = Number.isInteger(amount) && amount >= 0;
    const got = await attempt(() =>
      r.service.createInvoice(r.tenantId, 'staff-1', {
        studentId: r.studentId,
        ...(plan ? { planId: plan.id } : { title: 'Ad-hoc fee', amountCents: this.amount }),
      }),
    );
    if (!agree(r.log, String(this), { accept: valid, why: `amount ${amount}` }, got)) return false;
    addInvoice(m, got.value, plan ? 'plan' : 'adhoc', null);
    return true;
  }
  toString() {
    return `CreateInvoice(${this.amount}${this.planIdx === null ? '' : `, plan#${this.planIdx}`})`;
  }
}

class CreateStructureInvoice extends FeesCommand {
  readonly name = 'CreateStructureInvoice';
  constructor(
    readonly amount: number,
    readonly parts: number,
  ) {
    super();
  }
  protected async exec(m: FeesModel, r: FeesReal) {
    m.seq += 1;
    const name = `Tuition ${m.seq} ${randomUUID().slice(0, 6)}`;
    const st = await attempt(() =>
      r.service.createFeeStructure(r.tenantId, 'staff-1', {
        name,
        code: `AIT_${m.seq}_${randomUUID().slice(0, 6)}`.toUpperCase(),
        category: 'tuition',
        amountCents: this.amount,
        partCount: this.parts,
      }),
    );
    if (!agree(r.log, `${String(this)} structure`, { accept: true, why: 'valid structure' }, st)) {
      return false;
    }
    m.structures.push({ id: st.value.id, amount: this.amount, partCount: this.parts });
    const got = await attempt(() =>
      r.service.bulkInvoiceClass(r.tenantId, 'staff-1', {
        structureId: st.value.id,
        studentIds: [r.studentId],
      }),
    );
    if (!agree(r.log, `${String(this)} bulk`, { accept: true, why: 'one new student' }, got)) {
      return false;
    }
    const inv = got.value.created[0];
    r.log.check(
      'model-agreement',
      got.value.created.length === 1,
      () => `${String(this)}: bulk created ${got.value.created.length} invoices`,
    );
    if (inv) {
      addInvoice(m, inv, 'structure', st.value.id);
      r.log.check(
        'invoice-equals-lines',
        inv.amountCents === this.amount,
        () => `structure invoice ${inv.amountCents} != structure ${this.amount} (no concession)`,
      );
    }
    const parts = await r.service.listInstalments(r.tenantId, st.value.id);
    const amounts = [...parts].sort((a, b) => a.sequence - b.sequence).map((p) => p.amountCents);
    // A one-part structure has no schedule rows (createFeeStructure: partCount > 1).
    const expected = this.parts > 1 ? expectedInstalments(this.amount, this.parts) : [];
    r.log.check(
      'invoice-equals-lines',
      JSON.stringify(amounts) === JSON.stringify(expected),
      () => `instalments ${JSON.stringify(amounts)} != even split ${JSON.stringify(expected)}`,
    );
    return true;
  }
  toString() {
    return `CreateStructureInvoice(${this.amount}, parts ${this.parts})`;
  }
}

class Pay extends FeesCommand {
  readonly name = 'Pay';
  constructor(
    readonly invIdx: number,
    readonly mode: 'full' | 'part' | 'over',
    readonly frac: number,
    readonly withKey = false,
  ) {
    super();
  }
  check(m: Readonly<FeesModel>) {
    return m.invoices.length > 0;
  }
  protected async exec(m: FeesModel, r: FeesReal) {
    const inv = pick(m.invoices, this.invIdx)!;
    const idempotencyKey = this.withKey ? `aitest-${randomUUID()}` : undefined;
    const remaining = inv.face - paidOf(inv);
    const amount =
      this.mode === 'full'
        ? undefined
        : this.mode === 'part'
          ? Math.max(1, Math.floor(remaining * this.frac))
          : Math.max(1, remaining) + 1 + Math.floor(this.frac * 1000);
    const charge = amount ?? remaining;
    const accept = inv.status === 'open' && remaining > 0 && charge > 0 && charge <= remaining;
    const got = await attempt(() =>
      r.service.recordPayment(r.tenantId, 'parent-1', {
        invoiceId: inv.id,
        method: 'sandbox',
        ...(amount !== undefined ? { amountCents: amount } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {}),
      }),
    );
    const why = `status ${inv.status}, remaining ${remaining}, charge ${charge}`;
    if (!agree(r.log, `${String(this)} on ${inv.number}`, { accept, why }, got)) return false;
    inv.payments.push({
      id: got.value.payment.id,
      amount: got.value.payment.amountCents,
      refunded: 0,
    });
    if (idempotencyKey) {
      m.keyedPayments.push({
        key: idempotencyKey,
        invoiceId: inv.id,
        paymentId: got.value.payment.id,
        amount: got.value.payment.amountCents,
      });
    }
    if (paidOf(inv) >= inv.face) inv.status = 'paid';
    return true;
  }
  toString() {
    return `Pay(inv#${this.invIdx}, ${this.mode}, ${this.frac.toFixed(3)}${this.withKey ? ', idempotency key' : ''})`;
  }
}

/** PRC-M247: a replayed idempotency key returns the first payment and records nothing new. */
class ReplayPay extends FeesCommand {
  readonly name = 'ReplayPay';
  constructor(
    readonly idx: number,
    readonly sameAmount: boolean,
  ) {
    super();
  }
  check(m: Readonly<FeesModel>) {
    return m.keyedPayments.length > 0;
  }
  protected async exec(m: FeesModel, r: FeesReal) {
    const k = pick(m.keyedPayments, this.idx)!;
    const amount = this.sameAmount ? k.amount : k.amount + 1;
    const got = await attempt(() =>
      r.service.recordPayment(r.tenantId, 'parent-1', {
        invoiceId: k.invoiceId,
        method: 'sandbox',
        amountCents: amount,
        idempotencyKey: k.key,
      }),
    );
    const why = this.sameAmount
      ? 'same key, invoice, amount and payer'
      : 'same key, different amount';
    if (!agree(r.log, String(this), { accept: this.sameAmount, why }, got)) return false;
    r.log.check(
      'receipt-matches-payment',
      got.value.idempotent === true && got.value.payment.id === k.paymentId,
      () =>
        `${String(this)}: replay returned payment ${got.value.payment.id.slice(0, 8)} idempotent ${got.value.idempotent}`,
    );
    return true;
  }
  toString() {
    return `ReplayPay(key#${this.idx}${this.sameAmount ? '' : ', different amount'})`;
  }
}

class Refund extends FeesCommand {
  readonly name = 'Refund';
  constructor(
    readonly invIdx: number,
    readonly payIdx: number,
    readonly mode: 'within' | 'over',
    readonly frac: number,
    readonly omitPaymentId: boolean,
  ) {
    super();
  }
  check(m: Readonly<FeesModel>) {
    return m.invoices.some((i) => i.payments.length > 0);
  }
  protected async exec(m: FeesModel, r: FeesReal) {
    const withPay = m.invoices.filter((i) => i.payments.length > 0);
    const inv = pick(withPay, this.invIdx)!;
    const p = pick(inv.payments, this.payIdx)!;
    const left = p.amount - p.refunded;
    const amount = this.mode === 'within' ? Math.max(1, Math.floor(left * this.frac)) : left + 1;
    const single = inv.payments.length === 1;
    const accept =
      amount > 0 &&
      amount <= left &&
      refundedOf(inv) + amount <= paidOf(inv) &&
      (!this.omitPaymentId || single);
    const got = await attempt(() =>
      r.service.recordRefund(r.tenantId, 'staff-1', {
        invoiceId: inv.id,
        ...(this.omitPaymentId ? {} : { paymentId: p.id }),
        amountCents: amount,
        reason: 'aitest refund',
      }),
    );
    const why = `payment ${p.amount}, refunded ${p.refunded}, refund ${amount}, payments ${inv.payments.length}`;
    if (!agree(r.log, `${String(this)} on ${inv.number}`, { accept, why }, got)) return false;
    const target = inv.payments.find((x) => x.id === got.value.paymentId) ?? p;
    target.refunded += got.value.amountCents;
    return true;
  }
  toString() {
    return `Refund(inv#${this.invIdx}, pay#${this.payIdx}, ${this.mode}, ${this.frac.toFixed(3)}${this.omitPaymentId ? ', no paymentId' : ''})`;
  }
}

class Adjust extends FeesCommand {
  readonly name: string;
  constructor(
    readonly kind: 'creditNote' | 'writeOff',
    readonly invIdx: number,
    readonly mode: 'within' | 'all' | 'over',
    readonly frac: number,
  ) {
    super();
    this.name = kind === 'creditNote' ? 'CreditNote' : 'WriteOff';
  }
  check(m: Readonly<FeesModel>) {
    return m.invoices.length > 0;
  }
  protected async exec(m: FeesModel, r: FeesReal) {
    const inv = pick(m.invoices, this.invIdx)!;
    const unpaid = unpaidOf(inv);
    const amount =
      this.mode === 'within'
        ? Math.max(1, Math.floor(unpaid * this.frac))
        : this.mode === 'all'
          ? Math.max(1, unpaid)
          : unpaid + 1;
    const accept =
      !['void', 'written_off', 'paid'].includes(inv.status) && amount > 0 && amount <= unpaid;
    const input = { invoiceId: inv.id, amountCents: amount, reason: 'aitest adjustment' };
    const got = await attempt<unknown>(() =>
      this.kind === 'creditNote'
        ? r.service.issueCreditNote(r.tenantId, 'staff-1', input)
        : r.service.writeOffInvoice(r.tenantId, 'staff-1', input),
    );
    const why = `status ${inv.status}, unpaid ${unpaid}, amount ${amount}`;
    if (!agree(r.log, `${String(this)} on ${inv.number}`, { accept, why }, got)) return false;
    inv.face -= amount;
    if (unpaid - amount === 0) inv.status = this.kind === 'creditNote' ? 'paid' : 'written_off';
    return true;
  }
  toString() {
    return `${this.name}(inv#${this.invIdx}, ${this.mode}, ${this.frac.toFixed(3)})`;
  }
}

class Void extends FeesCommand {
  readonly name = 'Void';
  constructor(readonly invIdx: number) {
    super();
  }
  check(m: Readonly<FeesModel>) {
    return m.invoices.length > 0;
  }
  protected async exec(m: FeesModel, r: FeesReal) {
    const inv = pick(m.invoices, this.invIdx)!;
    const net = paidOf(inv) - refundedOf(inv);
    const accept = inv.status === 'void' || net === 0;
    const got = await attempt(() =>
      r.service.voidInvoice(r.tenantId, inv.id, { actorId: 'staff-1', reason: 'aitest void' }),
    );
    const why = `status ${inv.status}, net collected ${net}`;
    if (!agree(r.log, `${String(this)} on ${inv.number}`, { accept, why }, got)) return false;
    inv.status = 'void';
    return true;
  }
  toString() {
    return `Void(inv#${this.invIdx})`;
  }
}

class RequestConcession extends FeesCommand {
  readonly name = 'RequestConcession';
  constructor(
    readonly invIdx: number,
    readonly kind: 'percent' | 'amount',
    readonly value: number,
  ) {
    super();
  }
  check(m: Readonly<FeesModel>) {
    return m.invoices.some((i) => i.kind === 'structure');
  }
  protected async exec(m: FeesModel, r: FeesReal) {
    const inv = pick(
      m.invoices.filter((i) => i.kind === 'structure'),
      this.invIdx,
    )!;
    const st = m.structures.find((s) => s.id === inv.structureId)!;
    const spec =
      this.kind === 'percent'
        ? { kind: 'percent' as const, percent: this.value }
        : { kind: 'amount' as const, amountCents: this.value };
    const discount = expectedDiscount(st.amount, spec);
    const exists = m.concessions.some((c) => c.structureId === st.id);
    const accept = discount !== null && !exists;
    const got = await attempt(() =>
      r.service.applyConcession(r.tenantId, 'staff-1', {
        studentId: r.studentId,
        structureId: st.id,
        ...spec,
        reason: 'aitest concession',
      }),
    );
    const why = `discount ${String(discount)}, existing manual concession ${exists}`;
    if (!agree(r.log, String(this), { accept, why }, got)) return false;
    m.concessions.push({
      id: got.value.concession.id,
      structureId: st.id,
      invoiceId: inv.id,
      discount: discount ?? got.value.discountCents,
      status: 'pending',
      createdBy: 'staff-1',
    });
    return true;
  }
  toString() {
    return `RequestConcession(inv#${this.invIdx}, ${this.kind} ${this.value})`;
  }
}

class DecideConcession extends FeesCommand {
  readonly name: string;
  constructor(
    readonly idx: number,
    readonly approve: boolean,
    readonly sameActor: boolean,
  ) {
    super();
    this.name = approve ? 'ApproveConcession' : 'RejectConcession';
  }
  check(m: Readonly<FeesModel>) {
    return m.concessions.length > 0;
  }
  protected async exec(m: FeesModel, r: FeesReal) {
    const c = pick(m.concessions, this.idx)!;
    const inv = m.invoices.find((i) => i.id === c.invoiceId)!;
    const actor = this.sameActor ? c.createdBy : 'staff-2';
    let accept = c.status === 'pending' && actor !== c.createdBy;
    let why = `status ${c.status}, actor ${actor}`;
    // A void invoice is not a target (findInvoiceForStructureStudent skips void):
    // the concession is approved and waits for the next invoice of the structure.
    const applies = inv.status !== 'void';
    if (this.approve && accept && applies) {
      accept = inv.status === 'open' && c.discount <= unpaidOf(inv);
      why += `, invoice ${inv.status}, discount ${c.discount}, unpaid ${unpaidOf(inv)}`;
    }
    const got = await attempt(() =>
      this.approve
        ? r.service.approveConcession(r.tenantId, actor, c.id)
        : r.service.rejectConcession(r.tenantId, actor, c.id),
    );
    if (!agree(r.log, String(this), { accept, why }, got)) return false;
    if (this.approve) {
      c.status = 'approved';
      if (applies) {
        inv.face -= c.discount;
        if (inv.face <= paidOf(inv)) inv.status = 'paid';
      }
    } else {
      c.status = 'rejected';
    }
    return true;
  }
  toString() {
    return `${this.name}(conc#${this.idx}${this.sameActor ? ', same actor' : ''})`;
  }
}

class Netting extends FeesCommand {
  readonly name = 'ScholarshipNetting';
  constructor(
    readonly disbIdx: number | null,
    readonly amount: number,
  ) {
    super();
  }
  protected async exec(m: FeesModel, r: FeesReal) {
    let d = this.disbIdx === null ? undefined : pick(m.disbursements, this.disbIdx);
    if (!d) {
      d = { id: randomUUID(), amount: this.amount, credits: new Map(), reversed: false };
      m.disbursements.push(d);
    }
    const netted = [...d.credits.values()].reduce((s, v) => s + v, 0);
    const remaining = d.reversed ? 0 : Math.max(0, d.amount - netted);
    const eligible = m.invoices.filter(
      (i) => i.status === 'open' && !d.credits.has(i.id) && unpaidOf(i) > 0,
    );
    const got = await attempt(() =>
      r.service.applyScholarshipNetting(r.tenantId, 'scholarship-netting', {
        studentId: r.studentId,
        disbursementId: d.id,
        amountCents: d.amount,
      }),
    );
    if (!agree(r.log, String(this), { accept: true, why: 'netting never refuses' }, got)) {
      return false;
    }
    const applied = got.value.appliedCents;
    const target = got.value.invoice
      ? m.invoices.find((i) => i.id === got.value.invoice!.id)
      : null;
    if (applied > 0) {
      const ok = target !== null && target !== undefined && eligible.includes(target);
      r.log.check(
        'model-agreement',
        ok && applied === Math.min(remaining, unpaidOf(target)),
        () =>
          `${String(this)}: credited ${applied} to ${target?.number ?? 'unknown'} (eligible ${ok}); expected min(remaining ${remaining}, unpaid ${target ? unpaidOf(target) : '?'})`,
      );
      if (target) {
        d.credits.set(target.id, applied);
        target.face -= applied;
        if (target.face <= paidOf(target)) target.status = 'paid';
      }
    } else {
      r.log.check(
        'model-agreement',
        remaining === 0 || eligible.length === 0,
        () =>
          `${String(this)}: credited nothing but ${remaining} remains and ${eligible.length} open invoices are eligible`,
      );
    }
    return true;
  }
  toString() {
    return `ScholarshipNetting(${this.disbIdx === null ? 'new' : `disb#${this.disbIdx}`}, ${this.amount})`;
  }
}

class ReverseNetting extends FeesCommand {
  readonly name = 'ReverseNetting';
  constructor(readonly disbIdx: number) {
    super();
  }
  check(m: Readonly<FeesModel>) {
    return m.disbursements.length > 0;
  }
  protected async exec(m: FeesModel, r: FeesReal) {
    const d = pick(m.disbursements, this.disbIdx)!;
    const got = await attempt(() =>
      r.service.reverseScholarshipNetting(r.tenantId, 'scholarship-netting', {
        disbursementId: d.id,
      }),
    );
    if (!agree(r.log, String(this), { accept: true, why: 'reversal is idempotent' }, got)) {
      return false;
    }
    if (!d.reversed && d.credits.size > 0) {
      for (const [invoiceId, amount] of d.credits) {
        const inv = m.invoices.find((i) => i.id === invoiceId)!;
        inv.face += amount;
        // Code rule (W2-FIN-08): written-off reopens; paid reopens when it owes again.
        if (inv.status === 'written_off' || (inv.status === 'paid' && inv.face > paidOf(inv))) {
          inv.status = 'open';
        }
      }
      d.credits.clear();
      d.reversed = true;
    } else if (d.credits.size === 0 && !d.reversed) {
      // nothing netted yet: the service reports reversed=false and leaves no rows
      d.reversed = false;
    }
    return true;
  }
  toString() {
    return `ReverseNetting(disb#${this.disbIdx})`;
  }
}

type LineSpec = {
  mode: 'exact' | 'wrongAmount' | 'unknownInvoice' | 'repeatKey' | 'priorLine';
  invIdx: number;
  payIdx: number;
  ref: number;
};

class Reconcile extends FeesCommand {
  readonly name = 'Reconcile';
  constructor(
    readonly lines: LineSpec[],
    readonly replayLast: boolean,
  ) {
    super();
  }
  check(m: Readonly<FeesModel>) {
    return !this.replayLast || m.lastCsv !== null;
  }
  protected async exec(m: FeesModel, r: FeesReal) {
    if (this.replayLast && m.lastCsv) {
      const before = (await loadFeesSnapshot(r.pool, r.tenantId)).reconRows.length;
      const got = await attempt(() =>
        r.service.importReconciliationCsv(r.tenantId, 'staff-1', m.lastCsv!),
      );
      if (!agree(r.log, `${String(this)} replay`, { accept: true, why: 'same content' }, got)) {
        return false;
      }
      const after = (await loadFeesSnapshot(r.pool, r.tenantId)).reconRows.length;
      r.log.check(
        'recon-matches-once',
        got.value.idempotent === true && after === before,
        () =>
          `re-import of the same file: idempotent ${got.value.idempotent}, rows ${before} -> ${after}`,
      );
      return true;
    }
    const withPay = m.invoices.filter((i) => i.payments.length > 0);
    const rows: Array<{ number: string; amount: number; ref: string; date: string }> = [];
    let lastKey: { number: string; amount: number; ref: string; date: string } | null = null;
    for (const l of this.lines) {
      const inv = pick(withPay.length > 0 ? withPay : m.invoices, l.invIdx);
      const p = inv ? pick(inv.payments, l.payIdx) : undefined;
      const date = `2026-11-${String((l.ref % 27) + 1).padStart(2, '0')}`;
      const ref = `UTR${m.seq}${l.ref}${randomUUID().slice(0, 4)}`;
      if (l.mode === 'repeatKey' && lastKey) {
        rows.push({ ...lastKey });
        continue;
      }
      const prior = pick(m.matchedLines, l.ref);
      if (l.mode === 'priorLine' && prior) {
        // A bank line already reconciled in an earlier file (PRC-M251: exception).
        rows.push({ ...prior });
        continue;
      }
      if (l.mode === 'unknownInvoice' || !inv) {
        rows.push({ number: `INV-NOPE-${l.ref}`, amount: 100 + l.ref, ref, date });
      } else if (l.mode === 'wrongAmount' || !p) {
        rows.push({ number: inv.number, amount: (p?.amount ?? inv.face) + 7, ref, date });
      } else {
        rows.push({ number: inv.number, amount: p.amount, ref, date });
      }
      lastKey = rows.at(-1)!;
    }
    m.seq += 1;
    const csv = [
      'invoiceNumber,amountCents,utr,valueDate',
      ...rows.map((x) => `${x.number},${x.amount},${x.ref},${x.date}`),
    ].join('\n');
    // PRC-M251: the same file content (blank lines / spaces ignored) replays the first import.
    const contentKey = csv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join('\n');
    const priorMatched = m.priorFiles.get(contentKey);
    if (priorMatched !== undefined) {
      const got = await attempt(() =>
        r.service.importReconciliationCsv(r.tenantId, 'staff-1', csv),
      );
      if (!agree(r.log, `${String(this)} same content`, { accept: true, why: 'replay' }, got)) {
        return false;
      }
      r.log.check(
        'recon-matches-once',
        got.value.idempotent === true && got.value.matched.length === priorMatched,
        () =>
          `same file content re-imported: idempotent ${got.value.idempotent}, matched ${got.value.matched.length} (first import ${priorMatched})`,
      );
      return true;
    }
    // Model: which lines should match.
    const claimedPay = new Set(m.reconciledPayments);
    const claimedKey = new Set(m.reconciledLineKeys);
    let expectedMatched = 0;
    for (const x of rows) {
      const inv = m.invoices.find((i) => i.number === x.number);
      const key = `${x.ref}|${x.amount}|${x.date}`;
      if (!inv || claimedKey.has(key)) continue;
      const p = inv.payments.find((y) => y.amount === x.amount && !claimedPay.has(y.id));
      if (!p) continue;
      claimedPay.add(p.id);
      claimedKey.add(key);
      expectedMatched += 1;
    }
    const got = await attempt(() => r.service.importReconciliationCsv(r.tenantId, 'staff-1', csv));
    if (!agree(r.log, String(this), { accept: true, why: 'import never refuses' }, got)) {
      return false;
    }
    r.log.check(
      'recon-matches-once',
      got.value.matched.length === expectedMatched,
      () =>
        `${String(this)}: matched ${got.value.matched.length}, model expected ${expectedMatched}`,
    );
    for (const x of got.value.matched) {
      m.reconciledPayments.add(x.paymentId);
      if (x.bankReference && x.valueDate) {
        m.reconciledLineKeys.add(`${x.bankReference}|${x.amountCents}|${x.valueDate}`);
        m.matchedLines.push({
          number: x.invoiceNumber,
          amount: x.amountCents,
          ref: x.bankReference,
          date: x.valueDate,
        });
      }
    }
    m.lastCsv = csv;
    m.priorFiles.set(contentKey, got.value.matched.length);
    return true;
  }
  toString() {
    return `Reconcile(${this.replayLast ? 'replay last file' : JSON.stringify(this.lines)})`;
  }
}

class Reports extends FeesCommand {
  readonly name = 'Reports';
  protected async exec(m: FeesModel, r: FeesReal) {
    const got = await attempt(() => r.service.duesReport(r.tenantId, new Date()));
    if (!agree(r.log, 'duesReport', { accept: true, why: 'read model' }, got)) return false;
    const expectedOpen = m.invoices
      .filter((i) => i.status === 'open' || i.status === 'overdue')
      .reduce((s, i) => s + Math.max(0, i.face - paidOf(i)), 0);
    const reported = got.value.byClass.reduce((s, c) => s + c.openCents, 0);
    r.log.check(
      'reports-match-ledger',
      reported === expectedOpen,
      () =>
        `dues report open ${reported}, expected Σ(face - paid) over open invoices ${expectedOpen}`,
    );
    for (const inv of m.invoices.filter((i) => i.payments.length > 0)) {
      const list = await r.service.listRefundablePayments(r.tenantId, inv.id);
      for (const p of inv.payments) {
        const row = list.find((x) => x.paymentId === p.id);
        r.log.check(
          'reports-match-ledger',
          row !== undefined && row.refundableCents === p.amount - p.refunded,
          () =>
            `${inv.number} payment ${p.amount} refunded ${p.refunded}: refundable ${row?.refundableCents ?? 'missing'}`,
        );
      }
      const net = await r.service.getNetCollectedCents(r.tenantId, inv.id);
      r.log.check(
        'reports-match-ledger',
        net === paidOf(inv) - refundedOf(inv),
        () => `${inv.number}: net collected ${net}, expected ${paidOf(inv) - refundedOf(inv)}`,
      );
    }
    return true;
  }
  toString() {
    return 'Reports()';
  }
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const paise = fc.integer({ min: 1, max: 500_000 });
const frac = fc.double({ min: 0.01, max: 0.99, noNaN: true });
const idx = fc.nat({ max: 50 });

const createPlan = paise.map((a) => new CreatePlan(a));
const createInvoice = fc
  .tuple(
    fc.oneof(
      { weight: 9, arbitrary: paise },
      { weight: 1, arbitrary: fc.constantFrom(-100, 12.5) },
    ),
    fc.option(idx, { nil: null, freq: 3 }),
  )
  .map(([a, p]) => new CreateInvoice(a, p));
const createStructureInvoice = fc
  .tuple(paise, fc.integer({ min: 1, max: 6 }))
  .map(([a, n]) => new CreateStructureInvoice(a, n));
const pay = fc
  .tuple(
    idx,
    fc.constantFrom('full' as const, 'part' as const, 'part' as const, 'over' as const),
    frac,
    fc.boolean(),
  )
  .map(([i, mode, f, key]) => new Pay(i, mode, f, key));
const replayPay = fc
  .tuple(idx, fc.oneof({ weight: 3, arbitrary: fc.constant(true) }, fc.constant(false)))
  .map(([i, same]) => new ReplayPay(i, same));
const refund = fc
  .tuple(
    idx,
    idx,
    fc.constantFrom('within' as const, 'within' as const, 'over' as const),
    frac,
    fc.boolean(),
  )
  .map(([i, p, mode, f, omit]) => new Refund(i, p, mode, f, omit));
const adjust = fc
  .tuple(
    fc.constantFrom('creditNote' as const, 'writeOff' as const),
    idx,
    fc.constantFrom('within' as const, 'all' as const, 'over' as const),
    frac,
  )
  .map(([k, i, mode, f]) => new Adjust(k, i, mode, f));
const voidInvoice = idx.map((i) => new Void(i));
const requestConcession = fc
  .tuple(
    idx,
    fc.constantFrom('percent' as const, 'amount' as const),
    fc.oneof(
      fc.integer({ min: 0, max: 100 }),
      fc.integer({ min: 1, max: 600_000 }),
      fc.constant(120),
    ),
  )
  .map(([i, k, v]) => new RequestConcession(i, k, v));
const decideConcession = fc
  .tuple(
    idx,
    fc.boolean(),
    fc.oneof({ weight: 4, arbitrary: fc.constant(false) }, fc.constant(true)),
  )
  .map(([i, a, same]) => new DecideConcession(i, a, same));
const netting = fc
  .tuple(fc.option(idx, { nil: null, freq: 2 }), paise)
  .map(([d, a]) => new Netting(d, a));
const reverseNetting = idx.map((d) => new ReverseNetting(d));
const reconcile = fc
  .array(
    fc.record({
      mode: fc.constantFrom(
        'exact' as const,
        'exact' as const,
        'wrongAmount' as const,
        'unknownInvoice' as const,
        'repeatKey' as const,
        'priorLine' as const,
      ),
      invIdx: idx,
      payIdx: idx,
      ref: fc.nat({ max: 999 }),
    }),
    { minLength: 1, maxLength: 4 },
  )
  .map((l) => new Reconcile(l, false));
const reimport = fc.constant(null).map(() => new Reconcile([], true));
const reports = fc.constant(null).map(() => new Reports());

/** fc.commands picks uniformly, so weight = number of copies. */
function weighted<T>(pairs: Array<[fc.Arbitrary<T>, number]>): Array<fc.Arbitrary<T>> {
  return pairs.flatMap(([a, w]) => Array.from({ length: w }, () => a));
}

export const feesCommands: Array<fc.Arbitrary<Cmd>> = weighted<Cmd>([
  [createPlan, 1],
  [createInvoice, 3],
  [createStructureInvoice, 2],
  [pay, 5],
  [replayPay, 1],
  [refund, 3],
  [adjust, 2],
  [voidInvoice, 1],
  [requestConcession, 1],
  [decideConcession, 1],
  [netting, 2],
  [reverseNetting, 1],
  [reconcile, 2],
  [reimport, 1],
  [reports, 1],
]);

export function feesSpec(): DomainSpec<FeesModel, FeesReal, null> {
  return {
    domain: 'fees',
    invariants: FEES_INVARIANTS,
    commands: feesCommands,
    config: fc.constant(null),
    maxCommands: 40,
    async setup(log: ViolationLog, stats: CommandStats) {
      const pool = getSharedPgPool();
      if (!pool) throw new Error('DATABASE_URL is required for the fees property');
      const tenantId = randomUUID();
      const studentId = randomUUID();
      await ensurePgTestStudent(pool, tenantId, studentId);
      const service = new FeesService(new PgFeesRepository(pool), new SandboxPaymentAdapter());
      return {
        model: emptyFeesModel(),
        real: { log, stats, pool, tenantId, studentId, service },
      };
    },
    async finalCheck(m, r) {
      await new Reports().run(m, r);
    },
  };
}
