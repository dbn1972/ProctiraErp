/**
 * Fees service — plans, invoices, sandbox payments, receipts.
 * recordPayment enforces receipt.amountCents === payment.amountCents === invoice.amountCents.
 */
import { createHash } from 'node:crypto';

import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
  pgIntegerCents,
} from '@proctira/common';
import type { PgQueryable } from '@proctira/database';
import { v4 as uuidv4 } from 'uuid';

import type {
  FeeConcessionEntity,
  FeeInvoiceEntity,
  FeeLedgerEntryEntity,
  FeePaymentEntity,
  FeePlanEntity,
  FeeReceiptEntity,
  FeeReconciliationBatchEntity,
  FeeReconciliationRowEntity,
  FeesMoneyAuditSink,
  FeesPageRequest,
  FeesRepository,
  LedgerAccount,
  LockedInvoiceBalance,
  PaymentMethod,
  ReconExceptionStatus,
} from './fees-repository.js';
import { PaymentIdempotencyReplay } from './fees-repository.js';
import {
  allocateByShares,
  allocateInstalments,
  assertRefundWithinPaid,
  concessionDiscountCents,
} from './instalment-schedule.js';
import { createPaymentAdapterFromEnv, type PaymentAdapter } from './payment-adapter.js';
import {
  FEES_REMINDER_LIVE_HONESTY_NOTE,
  FEES_REMINDER_SANDBOX_HONESTY_NOTE,
  type ReminderChannel,
  type ReminderDeliveryPort,
  type ReminderSendAuditEntity,
  type ReminderSendMode,
  type ReminderSuppressionEntity,
  type SendReminderResultRow,
} from './reminder-sandbox.js';

export type { ReminderChannel, ReminderSendAuditEntity, ReminderSuppressionEntity };

/** PRC-M249: statuses that still carry collectible AR. */
function isCollectible(status: string): boolean {
  return status === 'open' || status === 'overdue';
}

/** PRC-M248: trim a `limit + 1` fetch into a page. */
function feesPage<T>(rows: T[], page: FeesPageRequest): { data: T[]; nextCursor: string | null } {
  const hasMore = rows.length > page.limit;
  return {
    data: hasMore ? rows.slice(0, page.limit) : rows,
    nextCursor: hasMore ? String(page.offset + page.limit) : null,
  };
}

/** PRC-M247: unique violation on uq_parent_fee_payments_tenant_idempotency. */
function isIdempotencyUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string } | null;
  return (
    e?.code === '23505' &&
    (e.constraint === undefined || String(e.constraint).includes('idempotency'))
  );
}
export { FEES_REMINDER_SANDBOX_HONESTY_NOTE };

export interface AddReminderSuppressionInput {
  studentId?: string;
  invoiceId?: string;
  reason: string;
}

export interface SendRemindersInput {
  invoiceIds: string[];
  channels: ReminderChannel[];
  /** Skip invoices with fewer overdue days than this (default 1). */
  minOverdueDays?: number;
  /** Skip if a sandbox send for the same invoice+channel exists within this many days. */
  cadenceDays?: number;
}

export interface CreateFeePlanInput {
  code?: string;
  name: string;
  description?: string;
  amountCents: number;
  currency?: string;
  frequency?: FeePlanEntity['frequency'];
}

export interface CreateInvoiceInput {
  studentId: string;
  planId?: string;
  title?: string;
  description?: string;
  amountCents?: number;
  currency?: string;
  dueAt?: string;
}

export interface RecordPaymentInput {
  invoiceId: string;
  payerUserId?: string;
  method?: PaymentMethod;
  amountCents?: number;
  /** W2-FIN-02: replay-safe client/PSP event key (unique per tenant). */
  idempotencyKey?: string;
  /**
   * PRC-M089: external reference (UPI txn id, receipt-book no.). Persisted on
   * the payment's ledger journal memo.
   */
  reference?: string;
}

export interface CreateFeeStructureInput {
  code?: string;
  name: string;
  category: string;
  term?: string;
  amountCents: number;
  currency?: string;
  institutionId?: string;
  academicPeriodId?: string;
  gradeId?: string;
  classId?: string;
  validFrom?: string;
  validTo?: string | null;
  /** PRC-M091: equal instalments created atomically with the structure (1..24). */
  partCount?: number;
}

export interface GenerateInstalmentScheduleInput {
  partCount?: number;
  shares?: number[];
  dueOffsetDays?: number[];
  labels?: string[];
}

export interface BulkInvoiceInput {
  structureId: string;
  classId?: string;
  gradeId?: string;
  studentIds?: string[];
  dueAt?: string;
  /** PRC-M086: explicit opt-in to invoice every enrolled student. */
  allStudents?: boolean;
}

/** PRC-H020: tenant-scoped view of a scholarship disbursement used to verify netting. */
export interface NettableScholarshipDisbursement {
  id: string;
  tenantId: string;
  studentId: string;
  amountCents: number;
  paymentStatus: string;
  currency?: string | null;
  paidDate?: string | null;
  /**
   * F-D2: set on rows returned by `listNettableScholarshipDisbursements` — paise already
   * credited to invoices and paise still waiting for the student's next open invoice.
   */
  nettedCents?: number;
  remainingCents?: number;
}

/**
 * F-D1/F-D2: outcome of one scholarship netting call. `appliedCents` is credited by this
 * call; `nettedCents` / `remainingCents` are the disbursement totals after it.
 * `discountCents` keeps its PRC-H020 meaning: the credit applied now, or the stored
 * credit when the call is a replay (`idempotent: true`).
 */
export interface ScholarshipNettingResult {
  concession: FeeConcessionEntity | null;
  invoice: FeeInvoiceEntity | null;
  discountCents: number;
  appliedCents: number;
  amountCents: number;
  nettedCents: number;
  remainingCents: number;
  idempotent: boolean;
}
/** PRC-H020: injected by the gateway; backed by the scholarship repository. */
export interface ScholarshipDisbursementLookup {
  findDisbursement(
    tenantId: string,
    disbursementId: string,
  ): Promise<NettableScholarshipDisbursement | null>;
  listPaidDisbursements(
    tenantId: string,
    filter: { studentId?: string },
  ): Promise<NettableScholarshipDisbursement[]>;
}
export interface ApplyConcessionInput {
  studentId: string;
  structureId: string;
  invoiceId?: string;
  kind: 'percent' | 'amount';
  percent?: number;
  amountCents?: number;
  reason: string;
  /** W2-FIN-09: when set, uniquely identifies scholarship netting source. */
  sourceDisbursementId?: string;
  approverId?: string;
  /**
   * W2-FIN-04: when true (scholarship netting / system paths), approve immediately.
   * Staff UI defaults to pending and requires a different approver.
   */
  autoApprove?: boolean;
}

export interface RecordRefundInput {
  invoiceId: string;
  paymentId?: string;
  amountCents: number;
  reason: string;
}

export interface IssueCreditNoteInput {
  invoiceId: string;
  amountCents: number;
  reason: string;
}

export interface WriteOffInvoiceInput {
  invoiceId: string;
  amountCents: number;
  reason: string;
}

export interface ReconciliationCsvRow {
  invoiceNumber: string;
  amountCents: number;
  /** PRC-M251: bank reference / UTR (optional column). */
  bankReference: string | null;
  /** PRC-M251: value date YYYY-MM-DD (optional column); NaN-equivalent is `invalidValueDate`. */
  valueDate: string | null;
  invalidValueDate?: boolean;
}

/** PRC-M251: sha256 of the CSV with blank lines and surrounding whitespace removed. */
export function reconciliationContentHash(csv: string): string {
  const normalised = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
  return createHash('sha256').update(normalised).digest('hex');
}

const RECON_COLUMNS: Record<
  string,
  keyof Pick<ReconciliationCsvRow, 'invoiceNumber' | 'amountCents' | 'bankReference' | 'valueDate'>
> = {
  invoicenumber: 'invoiceNumber',
  invoice: 'invoiceNumber',
  invoice_number: 'invoiceNumber',
  amountcents: 'amountCents',
  amount: 'amountCents',
  amount_cents: 'amountCents',
  utr: 'bankReference',
  bankreference: 'bankReference',
  bank_reference: 'bankReference',
  reference: 'bankReference',
  valuedate: 'valueDate',
  value_date: 'valueDate',
};

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// PRC-L107: <prefix>-<yyyymmdd>-<per-tenant counter, at least 6 digits>. The counter
// (db/sql/324) is drawn in the document's transaction, so numbers never collide.
function documentNumber(prefix: 'INV' | 'RCP', sequence: number): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${prefix}-${stamp}-${String(sequence).padStart(6, '0')}`;
}

function receiptNumberFor(sequence: number): string {
  return documentNumber('RCP', sequence);
}

function invoiceNumberFor(sequence: number): string {
  return documentNumber('INV', sequence);
}

export function parseReconciliationCsv(csv: string): ReconciliationCsvRow[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const hasHeader = /invoice/i.test(lines[0]!);
  // PRC-M251: header names pick the columns (invoiceNumber, amountCents, utr, valueDate);
  // without a header the order is invoiceNumber, amountCents[, utr[, valueDate]].
  const order: Array<keyof typeof RECON_COLUMNS | undefined> = hasHeader
    ? lines[0]!.split(',').map((h) => h.trim().toLowerCase())
    : ['invoicenumber', 'amountcents', 'utr', 'valuedate'];
  const rows: ReconciliationCsvRow[] = [];
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const cells: Partial<
      Record<'invoiceNumber' | 'amountCents' | 'bankReference' | 'valueDate', string>
    > = {};
    line.split(',').forEach((cell, i) => {
      const name = order[i];
      const key = name ? RECON_COLUMNS[name] : undefined;
      if (key) cells[key] = cell.trim();
    });
    const invoiceNumber = cells.invoiceNumber ?? '';
    if (!invoiceNumber) continue;
    // W1-DATA-09: bank CSV amounts must already be integer cents — never Math.round(Number()).
    let amountCents: number;
    try {
      amountCents = pgIntegerCents(cells.amountCents);
    } catch {
      amountCents = Number.NaN;
    }
    const valueDate = cells.valueDate ? cells.valueDate : null;
    rows.push({
      invoiceNumber,
      amountCents,
      bankReference: cells.bankReference ? cells.bankReference : null,
      valueDate,
      ...(valueDate && !isIsoDate(valueDate) ? { invalidValueDate: true } : {}),
    });
  }
  return rows;
}

export class FeesService {
  private readonly paymentAdapter: PaymentAdapter;
  private readonly reminderDelivery: ReminderDeliveryPort | null;

  constructor(
    private readonly repository: FeesRepository,
    paymentAdapter?: PaymentAdapter,
    options: { reminderDelivery?: ReminderDeliveryPort } = {},
  ) {
    this.paymentAdapter = paymentAdapter ?? createPaymentAdapterFromEnv();
    // PRC-L291: no delivery port -> reminders stay sandbox (no provider is wired yet).
    this.reminderDelivery = options.reminderDelivery ?? null;
  }

  async createFeePlan(tenantId: string, actorId: string, input: CreateFeePlanInput) {
    if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
      throw new BusinessRuleError('Plan amountCents must be a non-negative integer');
    }
    const code =
      input.code?.trim() ||
      input.name
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 32) ||
      'PLAN';

    return this.repository.createFeePlan({
      id: uuidv4(),
      tenantId,
      code,
      name: input.name,
      description: input.description ?? '',
      amountCents: input.amountCents,
      currency: input.currency ?? 'INR',
      frequency: input.frequency ?? 'term',
      status: 'active',
      createdBy: actorId,
    });
  }

  async listFeePlans(tenantId: string) {
    return this.repository.listFeePlans(tenantId);
  }

  async getFeePlan(tenantId: string, planId: string) {
    const plan = await this.repository.findFeePlanById(planId, tenantId);
    if (!plan) {
      throw new NotFoundError(`Fee plan with id '${planId}' not found`);
    }
    return plan;
  }

  async createInvoice(tenantId: string, actorId: string, input: CreateInvoiceInput) {
    let title = input.title;
    let description = input.description ?? '';
    let amountCents = input.amountCents;
    let currency = input.currency ?? 'INR';
    let planId: string | null = input.planId ?? null;

    if (input.planId) {
      const plan = await this.repository.findFeePlanById(input.planId, tenantId);
      if (!plan || plan.status !== 'active') {
        throw new NotFoundError(`Fee plan with id '${input.planId}' not found`);
      }
      planId = plan.id;
      title = input.title ?? plan.name;
      description = input.description ?? plan.description;
      amountCents = input.amountCents ?? plan.amountCents;
      currency = input.currency ?? plan.currency;
    }

    if (title == null || title.trim() === '') {
      throw new BusinessRuleError('Invoice title is required');
    }
    if (amountCents == null || amountCents < 0 || !Number.isInteger(amountCents)) {
      throw new BusinessRuleError('Invoice amountCents must be a non-negative integer');
    }

    const invoiceId = uuidv4();
    const faceCents = amountCents;
    // PRC-H058: invoice row + issuance journal commit together.
    return this.repository.runInTransaction(tenantId, async (tx) => {
      const invoice = await tx.createInvoice({
        id: invoiceId,
        tenantId,
        studentId: input.studentId,
        planId,
        title,
        description,
        amountCents: faceCents,
        currency,
        status: 'open',
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        createdBy: actorId,
        invoiceNumber: invoiceNumberFor(await tx.nextDocumentNumber(tenantId, 'invoice')),
        structureId: null,
        classId: null,
        gradeId: null,
      });

      // G-718: DR accounts_receivable / CR fee_revenue
      if (faceCents > 0) {
        await this.postJournal(
          tx,
          invoice,
          actorId,
          'invoice issued',
          [
            ['accounts_receivable', 'debit'],
            ['fee_revenue', 'credit'],
          ],
          faceCents,
        );
      }
      return invoice;
    });
  }

  /**
   * Post one balanced journal for an invoice-scoped financial event (G-718).
   * W2-FIN-03: amountCents is explicit (may differ from invoice face — refunds,
   * concessions, future partial posts) so callers never forge a mutated invoice.
   * Both legs carry the same amount so the journal is balanced by construction;
   * the repository still rejects unbalanced journals defensively.
   */
  private async postJournal(
    repo: FeesRepository,
    invoice: FeeInvoiceEntity,
    actorId: string | null,
    memo: string,
    legs: ReadonlyArray<readonly [LedgerAccount, 'debit' | 'credit']>,
    amountCents: number,
    refs: { paymentId?: string; receiptId?: string; journalId?: string } = {},
  ): Promise<FeeLedgerEntryEntity[]> {
    if (!Number.isInteger(amountCents) || amountCents < 0) {
      throw new BusinessRuleError('Journal amountCents must be a non-negative integer');
    }
    // PRC-M202: an adjustment row carries the id of the journal that posted it.
    const journalId = refs.journalId ?? uuidv4();
    const postedAt = new Date();
    return repo.postLedgerEntries(
      legs.map(([account, side]) => ({
        id: uuidv4(),
        tenantId: invoice.tenantId,
        journalId,
        invoiceId: invoice.id,
        paymentId: refs.paymentId ?? null,
        receiptId: refs.receiptId ?? null,
        account,
        side,
        amountCents: amountCents,
        currency: invoice.currency,
        memo,
        postedBy: actorId,
        postedAt,
      })),
    );
  }

  /** Ledger legs posted for an invoice, oldest first (G-718). */
  async getInvoiceLedger(tenantId: string, invoiceId: string) {
    await this.getInvoice(tenantId, invoiceId);
    return this.repository.listLedgerForInvoice(tenantId, invoiceId);
  }

  /** Tenant trial balance — debits must equal credits (G-718). */
  async getTrialBalance(tenantId: string) {
    return this.repository.trialBalance(tenantId);
  }

  async listInvoices(tenantId: string) {
    return this.repository.listInvoicesForTenant(tenantId);
  }

  async getInvoice(tenantId: string, invoiceId: string) {
    const invoice = await this.repository.findInvoiceById(invoiceId, tenantId);
    if (!invoice) {
      throw new NotFoundError(`Invoice with id '${invoiceId}' not found`);
    }
    return invoice;
  }

  /**
   * Void an invoice.
   * PRC-H058: status check, void update and reversal journal under one invoice lock.
   * PRC-H059: refuses (422) while any collected cash is unrefunded, whatever the
   * status — a part-paid open invoice must be refunded first. The reversal journal
   * covers only the unpaid remainder (face − succeeded payments) so AR nets to zero
   * instead of being credited twice, and it carries the acting user and reason.
   */
  async voidInvoice(
    tenantId: string,
    invoiceId: string,
    options: { actorId?: string | null; reason?: string | null; audit?: FeesMoneyAuditSink } = {},
  ) {
    const reason = options.reason?.trim() ?? '';
    return this.repository.withInvoiceLock(tenantId, invoiceId, async (tx, locked) => {
      const { invoice } = locked;
      if (invoice.status === 'void') {
        return invoice;
      }
      const netCollected = Math.max(0, locked.paidCents - locked.refundedCents);
      if (netCollected > 0) {
        throw new BusinessRuleError(
          `Cannot void an invoice with ${netCollected} cents of collected cash — refund it first`,
        );
      }
      const updated = await tx.updateInvoice(invoiceId, tenantId, { status: 'void' });
      // G-718: reverse the unpaid issuance — DR fee_revenue / CR accounts_receivable
      const unpaidRemainder = Math.max(0, invoice.amountCents - locked.paidCents);
      if (unpaidRemainder > 0) {
        await this.postJournal(
          tx,
          invoice,
          options.actorId ?? null,
          reason ? `invoice voided: ${reason}` : 'invoice voided',
          [
            ['fee_revenue', 'debit'],
            ['accounts_receivable', 'credit'],
          ],
          unpaidRemainder,
        );
      }
      // PRC-L306: audit shares the COMMIT boundary.
      await options.audit?.(tx, {
        kind: 'void',
        entityId: invoiceId,
        invoiceId,
        amountCents: unpaidRemainder,
        beforeStatus: invoice.status,
        afterStatus: 'void',
      });
      return updated!;
    });
  }

  async listPayments(tenantId: string) {
    return this.repository.listPaymentsForTenant(tenantId);
  }
  /** PRC-M248: bounded staff list pages (`limit + 1` fetch -> nextCursor). */
  async listInvoicesPage(tenantId: string, page: FeesPageRequest) {
    return feesPage(await this.repository.listInvoicesPage(tenantId, page), page);
  }
  async listPaymentsPage(tenantId: string, page: FeesPageRequest) {
    return feesPage(await this.repository.listPaymentsPage(tenantId, page), page);
  }
  async listReceiptsPage(tenantId: string, page: FeesPageRequest) {
    return feesPage(await this.repository.listReceiptsPage(tenantId, page), page);
  }

  /**
   * PRC-M090: succeeded payments of one invoice with what is still refundable on each,
   * so a refund form can target a specific payment.
   */
  async listRefundablePayments(tenantId: string, invoiceId: string) {
    await this.getInvoice(tenantId, invoiceId);
    const [payments, refunds] = await Promise.all([
      this.repository.listPaymentsForInvoice(tenantId, invoiceId),
      this.repository.listRefundsForInvoice(tenantId, invoiceId),
    ]);
    return payments
      .filter((payment) => payment.status === 'succeeded')
      .map((payment) => {
        const refundedCents = refunds
          .filter((refund) => refund.status === 'posted' && refund.paymentId === payment.id)
          .reduce((sum, refund) => sum + refund.amountCents, 0);
        return {
          paymentId: payment.id,
          method: payment.method,
          amountCents: payment.amountCents,
          refundedCents,
          refundableCents: Math.max(0, payment.amountCents - refundedCents),
          paidAt: payment.paidAt,
        };
      });
  }

  async getNetCollectedCents(tenantId: string, invoiceId: string): Promise<number> {
    await this.getInvoice(tenantId, invoiceId);
    const payments = (await this.repository.listPaymentsForInvoice(tenantId, invoiceId))
      .filter((payment) => payment.status === 'succeeded')
      .reduce((sum, payment) => sum + payment.amountCents, 0);
    const refunds = (await this.repository.listRefundsForInvoice(tenantId, invoiceId))
      .filter((refund) => refund.status === 'posted')
      .reduce((sum, refund) => sum + refund.amountCents, 0);
    return Math.max(0, payments - refunds);
  }

  /**
   * PRC-M535: is `paymentRef` a succeeded payment recorded server-side on this
   * invoice? Matches the payment id, its idempotency (PSP event) key or its
   * receipt number. Read-only; unknown invoice -> NotFoundError.
   */
  async isRecordedPaymentRef(
    tenantId: string,
    invoiceId: string,
    paymentRef: string,
  ): Promise<boolean> {
    await this.getInvoice(tenantId, invoiceId);
    const ref = paymentRef.trim();
    if (!ref) return false;
    const payments = (await this.repository.listPaymentsForInvoice(tenantId, invoiceId)).filter(
      (payment) => payment.status === 'succeeded',
    );
    for (const payment of payments) {
      if (payment.id === ref || payment.idempotencyKey === ref) return true;
      const receipt = await this.repository.findReceiptByPaymentId(tenantId, payment.id);
      if (receipt?.receiptNumber === ref) return true;
    }
    return false;
  }

  async listReceipts(tenantId: string) {
    return this.repository.listReceiptsForTenant(tenantId);
  }

  async getReceipt(tenantId: string, receiptId: string) {
    const receipt = await this.repository.findReceiptById(receiptId, tenantId);
    if (!receipt) {
      throw new NotFoundError(`Receipt with id '${receiptId}' not found`);
    }
    return receipt;
  }

  /**
   * Charge via payment adapter, persist payment + receipt, update invoice status.
   * W2-FIN-01: partial payments allowed — receipt.amountCents === payment.amountCents
   * and payment must be within the remaining balance. Invoice stays open until
   * succeeded payments cover the face amount.
   */
  async recordPayment(
    tenantId: string,
    actorId: string,
    input: RecordPaymentInput,
    options?: {
      appendAuditInTxn?: (
        client: PgQueryable,
        settlement: {
          invoice: FeeInvoiceEntity;
          payment: FeePaymentEntity;
          receipt: FeeReceiptEntity;
        },
      ) => Promise<void>;
    },
  ): Promise<{
    invoice: FeeInvoiceEntity;
    payment: FeePaymentEntity;
    receipt: FeeReceiptEntity;
    idempotent: boolean;
  }> {
    const idempotencyKey =
      input.idempotencyKey != null && input.idempotencyKey.trim().length > 0
        ? input.idempotencyKey.trim()
        : null;

    const payerUserId = input.payerUserId ?? actorId;
    if (idempotencyKey) {
      const existing = await this.repository.findPaymentByIdempotencyKey(tenantId, idempotencyKey);
      if (existing) return this.replayIdempotentPayment(tenantId, existing, input, payerUserId);
    }

    let settled: {
      invoice: FeeInvoiceEntity;
      payment: FeePaymentEntity;
      receipt: FeeReceiptEntity;
    };
    try {
      settled = await this.settlePayment(tenantId, actorId, input, idempotencyKey, options);
    } catch (err) {
      // PRC-M247: a concurrent same-key request committed first — replay it.
      if (err instanceof PaymentIdempotencyReplay) {
        return this.replayIdempotentPayment(tenantId, err.payment, input, payerUserId);
      }
      if (idempotencyKey && isIdempotencyUniqueViolation(err)) {
        const winner = await this.repository.findPaymentByIdempotencyKey(tenantId, idempotencyKey);
        if (winner) return this.replayIdempotentPayment(tenantId, winner, input, payerUserId);
      }
      throw err;
    }
    return { ...settled, idempotent: false };
  }

  /** PRC-M247: replay validates invoice, amount and payer before returning the settlement. */
  private async replayIdempotentPayment(
    tenantId: string,
    existing: FeePaymentEntity,
    input: RecordPaymentInput,
    payerUserId: string,
  ) {
    if (existing.invoiceId !== input.invoiceId) {
      throw new BusinessRuleError('Idempotency key already used for a different invoice');
    }
    if (input.amountCents != null && input.amountCents !== existing.amountCents) {
      throw new BusinessRuleError('Idempotency key already used for a different payment amount');
    }
    if (existing.payerUserId !== payerUserId) {
      throw new BusinessRuleError('Idempotency key already used by a different payer');
    }
    const invoice = await this.getInvoice(tenantId, existing.invoiceId);
    const receipt = await this.repository.findReceiptByPaymentId(tenantId, existing.id);
    if (!receipt) {
      throw new BusinessRuleError(
        'Idempotent payment is missing its receipt — refuse silent repair',
      );
    }
    return { invoice, payment: existing, receipt, idempotent: true };
  }

  private async settlePayment(
    tenantId: string,
    actorId: string,
    input: RecordPaymentInput,
    idempotencyKey: string | null,
    options?: {
      appendAuditInTxn?: (
        client: PgQueryable,
        settlement: {
          invoice: FeeInvoiceEntity;
          payment: FeePaymentEntity;
          receipt: FeeReceiptEntity;
        },
      ) => Promise<void>;
    },
  ) {
    const { invoice, payment, receipt } = await this.repository.recordPaymentOnInvoice(
      tenantId,
      input.invoiceId,
      async ({ invoice, paidCents, remainingCents, nextDocumentNumber }) => {
        const paymentAmountCents = input.amountCents ?? remainingCents;
        if (!Number.isInteger(paymentAmountCents) || paymentAmountCents <= 0) {
          throw new BusinessRuleError('Payment amountCents must be a positive integer');
        }
        if (paymentAmountCents > remainingCents) {
          throw new BusinessRuleError(
            `Payment amountCents ${paymentAmountCents} exceeds remaining balance ${remainingCents}`,
          );
        }

        const charge = await this.paymentAdapter.charge({
          tenantId,
          invoiceId: invoice.id,
          payerUserId: input.payerUserId ?? actorId,
          amountCents: paymentAmountCents,
          currency: invoice.currency,
          method: input.method ?? 'sandbox',
        });

        if (charge.status !== 'succeeded') {
          throw new BusinessRuleError(`Payment charge failed with status '${charge.status}'`);
        }

        if (charge.amountCents !== paymentAmountCents) {
          throw new BusinessRuleError('Charge amountCents must equal payment amountCents');
        }

        const paidAt = new Date();
        const paymentId = uuidv4();
        const receiptId = uuidv4();
        const journalId = uuidv4();
        const postedAt = paidAt;

        return {
          paymentAmountCents,
          payment: {
            id: paymentId,
            invoiceId: invoice.id,
            tenantId,
            payerUserId: input.payerUserId ?? actorId,
            amountCents: paymentAmountCents,
            method: charge.method,
            status: 'succeeded' as const,
            paidAt,
            idempotencyKey,
          },
          receipt: {
            id: receiptId,
            tenantId,
            paymentId,
            invoiceId: invoice.id,
            receiptNumber: receiptNumberFor(await nextDocumentNumber('receipt')),
            amountCents: paymentAmountCents,
            currency: invoice.currency,
            issuedAt: paidAt,
          },
          ledgerEntries: [
            ['cash', 'debit'],
            ['accounts_receivable', 'credit'],
          ].map(([account, side]) => ({
            id: uuidv4(),
            tenantId: invoice.tenantId,
            journalId,
            invoiceId: invoice.id,
            paymentId,
            receiptId,
            account: account as LedgerAccount,
            side: side as 'debit' | 'credit',
            amountCents: paymentAmountCents,
            currency: invoice.currency,
            memo: input.reference?.trim()
              ? `payment received · ref ${input.reference.trim().slice(0, 100)}`
              : 'payment received',
            postedBy: actorId,
            postedAt,
          })),
          invoiceStatus: (paidCents + paymentAmountCents >= invoice.amountCents
            ? 'paid'
            : 'open') as FeeInvoiceEntity['status'],
        };
      },
      {
        idempotencyKey,
        ...(options?.appendAuditInTxn
          ? {
              appendAuditInTxn: async (
                client: PgQueryable,
                settled: {
                  invoice: FeeInvoiceEntity;
                  payment: FeePaymentEntity;
                  receipt: FeeReceiptEntity;
                },
              ) => {
                await options.appendAuditInTxn!(client, settled);
              },
            }
          : {}),
      },
    );

    return { invoice, payment, receipt };
  }

  async createFeeStructure(tenantId: string, actorId: string, input: CreateFeeStructureInput) {
    const code =
      input.code?.trim() ||
      `${input.category}-${input.name}`
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 32) ||
      'STRUCTURE';
    if (input.amountCents < 0 || !Number.isInteger(input.amountCents)) {
      throw new BusinessRuleError('Structure amountCents must be a non-negative integer');
    }
    const validFrom = input.validFrom ?? new Date().toISOString().slice(0, 10);
    const validTo = input.validTo === undefined ? null : input.validTo;
    if (validTo && validTo < validFrom) {
      throw new BusinessRuleError('validTo must be on or after validFrom');
    }
    if (input.classId) await this.assertClassExists(tenantId, input.classId);
    const partCount = input.partCount ?? 1;
    if (!Number.isInteger(partCount) || partCount < 1 || partCount > 24) {
      throw new BusinessRuleError('partCount must be an integer between 1 and 24');
    }
    // PRC-M091: structure + instalment schedule commit together, so a failed
    // schedule never leaves a structure without instalments.
    return this.repository.runInTransaction(tenantId, async (tx) => {
      const structure = await tx.createFeeStructure({
        id: uuidv4(),
        tenantId,
        institutionId: input.institutionId ?? null,
        academicPeriodId: input.academicPeriodId ?? null,
        gradeId: input.gradeId ?? null,
        classId: input.classId ?? null,
        category: input.category,
        term: input.term ?? null,
        code,
        name: input.name,
        amountCents: input.amountCents,
        currency: input.currency ?? 'INR',
        status: 'active',
        validFrom,
        validTo,
        version: 1,
        supersedesId: null,
        createdBy: actorId,
      });
      if (partCount > 1) {
        const amounts = allocateInstalments(structure.amountCents, partCount);
        await tx.replaceStructureInstalments(
          tenantId,
          structure.id,
          amounts.map((amountCents, index) => ({
            id: uuidv4(),
            tenantId,
            structureId: structure.id,
            sequence: index + 1,
            amountCents,
            dueOffsetDays: index * 30,
            label: `Instalment ${index + 1}`,
          })),
        );
      }
      return structure;
    });
  }

  /**
   * W1-DATA-07: close prior open window and append a non-overlapping successor.
   * Amount/valid_from on the prior row are never mutated.
   */
  async supersedeFeeStructure(
    tenantId: string,
    actorId: string,
    structureId: string,
    input: CreateFeeStructureInput & { validFrom: string },
  ) {
    const prior = await this.getFeeStructure(tenantId, structureId);
    // PRC-L471: successors keep the prior's logical code; a different code is refused
    // (it would start a new structure lineage, not a new version).
    if (input.code?.trim() && input.code.trim() !== prior.code) {
      throw new BusinessRuleError(
        `Cannot supersede: successor code must stay '${prior.code}' (got '${input.code.trim()}')`,
      );
    }
    const code = prior.code;
    const validFrom = input.validFrom;
    const validTo = input.validTo === undefined ? null : input.validTo;
    if (validTo && validTo < validFrom) {
      throw new BusinessRuleError('validTo must be on or after validFrom');
    }
    if (input.amountCents < 0 || !Number.isInteger(input.amountCents)) {
      throw new BusinessRuleError('Structure amountCents must be a non-negative integer');
    }

    // Close prior open-ended (or overlapping) window the day before successor starts.
    const closeTo = new Date(`${validFrom}T00:00:00.000Z`);
    closeTo.setUTCDate(closeTo.getUTCDate() - 1);
    const closeToStr = closeTo.toISOString().slice(0, 10);
    const closesPrior = prior.validTo == null || prior.validTo >= validFrom;
    if (closesPrior && closeToStr < prior.validFrom) {
      throw new ConflictError(
        `Cannot supersede: successor validFrom ${validFrom} does not leave a non-overlapping prior window`,
      );
    }

    // PRC-L471: the prior window close and the successor insert commit together,
    // so a failed insert never leaves the prior structure closed with no successor.
    return this.repository.runInTransaction(tenantId, async (tx) => {
      if (closesPrior) {
        await tx.closeFeeStructureValidTo(tenantId, prior.id, closeToStr);
      }
      return tx.createFeeStructure({
        id: uuidv4(),
        tenantId,
        institutionId: input.institutionId ?? prior.institutionId,
        academicPeriodId: input.academicPeriodId ?? prior.academicPeriodId,
        gradeId: input.gradeId ?? prior.gradeId,
        classId: input.classId ?? prior.classId,
        category: input.category ?? prior.category,
        term: input.term !== undefined ? input.term : prior.term,
        code,
        name: input.name,
        amountCents: input.amountCents,
        currency: input.currency ?? prior.currency,
        status: 'active',
        validFrom,
        validTo,
        version: prior.version + 1,
        supersedesId: prior.id,
        createdBy: actorId,
      });
    });
  }

  /**
   * PRC-L471: calendar due date of an instalment — the structure's validFrom plus the
   * instalment's dueOffsetDays (UTC calendar arithmetic, `YYYY-MM-DD`).
   */
  instalmentDueDate(structure: { validFrom: string }, dueOffsetDays: number): string {
    const due = new Date(`${structure.validFrom}T00:00:00.000Z`);
    due.setUTCDate(due.getUTCDate() + dueOffsetDays);
    return due.toISOString().slice(0, 10);
  }

  async listFeeStructures(tenantId: string, options?: { asOf?: string }) {
    return this.repository.listFeeStructures(tenantId, options);
  }

  async getFeeStructure(tenantId: string, structureId: string) {
    const structure = await this.repository.findFeeStructureById(structureId, tenantId);
    if (!structure) {
      throw new NotFoundError(`Fee structure with id '${structureId}' not found`);
    }
    return structure;
  }

  async generateInstalmentSchedule(
    tenantId: string,
    structureId: string,
    input: GenerateInstalmentScheduleInput = {},
  ) {
    const structure = await this.getFeeStructure(tenantId, structureId);
    const amounts = input.shares?.length
      ? allocateByShares(structure.amountCents, input.shares)
      : allocateInstalments(structure.amountCents, input.partCount ?? 1);
    const rows = amounts.map((amountCents, index) => ({
      id: uuidv4(),
      tenantId,
      structureId: structure.id,
      sequence: index + 1,
      amountCents,
      dueOffsetDays: input.dueOffsetDays?.[index] ?? index * 30,
      label: input.labels?.[index] ?? `Instalment ${index + 1}`,
    }));
    const saved = await this.repository.replaceStructureInstalments(tenantId, structure.id, rows);
    return saved.map((row) => ({
      ...row,
      dueDate: this.instalmentDueDate(structure, row.dueOffsetDays),
    }));
  }

  async listInstalments(tenantId: string, structureId: string) {
    const structure = await this.getFeeStructure(tenantId, structureId);
    const rows = await this.repository.listStructureInstalments(tenantId, structureId);
    // PRC-L471: expose the instalment-driven due date, not only the raw offset.
    return rows.map((row) => ({
      ...row,
      dueDate: this.instalmentDueDate(structure, row.dueOffsetDays),
    }));
  }

  /**
   * PRC-M087: reject ids that are not classes of this tenant (e.g. timetable
   * section ids), which would otherwise silently match zero enrolments.
   */
  private async assertClassExists(tenantId: string, classId: string, repo = this.repository) {
    if (!(await repo.classExists(tenantId, classId))) {
      throw new ValidationError('Class not found for this tenant', [
        { field: 'classId', rule: 'exists', message: 'Choose a class from the class list' },
      ]);
    }
  }

  /**
   * PRC-M086: resolve who a bulk invoice would bill. Refuses an unscoped run
   * (no class, grade or student list on the request *or* the structure)
   * unless `allStudents` is explicitly set, so an empty form can never
   * invoice every enrolled student in the tenant.
   */
  private async resolveBulkInvoiceScope(
    repo: FeesRepository,
    tenantId: string,
    input: BulkInvoiceInput,
  ) {
    const structure = await repo.findFeeStructureById(input.structureId, tenantId);
    if (!structure || structure.status !== 'active') {
      throw new NotFoundError(`Fee structure with id '${input.structureId}' not found`);
    }
    if (input.classId) await this.assertClassExists(tenantId, input.classId, repo);
    const classId = input.classId ?? structure.classId;
    const gradeId = input.gradeId ?? structure.gradeId;
    const fromInput = (input.studentIds ?? []).filter((id) => id.length > 0);
    if (fromInput.length === 0 && !classId && !gradeId && input.allStudents !== true) {
      throw new ValidationError('Choose a class, grade or students to invoice', [
        {
          field: 'classId',
          rule: 'required',
          message: 'Bulk invoicing needs a class, grade or student list',
        },
      ]);
    }
    const roster =
      fromInput.length > 0
        ? fromInput
        : await repo.listStudentIdsForScope(tenantId, { classId, gradeId });
    const unique = [...new Set(roster)];
    return { structure, classId, gradeId, studentIds: unique };
  }

  /**
   * PRC-M250: set-based lookups (one query each) instead of two queries per
   * student — the existing-invoice set and the first active concession per
   * student for this structure.
   */
  private async bulkInvoiceLookups(
    repo: FeesRepository,
    tenantId: string,
    structureId: string,
    studentIds: string[],
  ) {
    const [alreadyInvoiced, concessions] = await Promise.all([
      repo.listInvoicedStudentIdsForStructure(tenantId, structureId, studentIds),
      repo.listActiveConcessionsForStructure(tenantId, structureId, studentIds),
    ]);
    const concessionByStudent = new Map<string, FeeConcessionEntity>();
    for (const c of concessions) {
      if (!concessionByStudent.has(c.studentId)) concessionByStudent.set(c.studentId, c);
    }
    return { alreadyInvoiced, concessionByStudent };
  }

  /** PRC-M086: dry run — how many invoices a bulk run would create, and for how much. */
  async previewBulkInvoice(tenantId: string, input: BulkInvoiceInput) {
    const { structure, studentIds } = await this.resolveBulkInvoiceScope(
      this.repository,
      tenantId,
      input,
    );
    const { alreadyInvoiced, concessionByStudent } = await this.bulkInvoiceLookups(
      this.repository,
      tenantId,
      structure.id,
      studentIds,
    );
    let toCreate = 0;
    let totalAmountCents = 0;
    for (const studentId of studentIds) {
      if (alreadyInvoiced.has(studentId)) continue;
      const concession = concessionByStudent.get(studentId) ?? null;
      const discount =
        concession && concession.status === 'approved'
          ? concessionDiscountCents(structure.amountCents, concession)
          : 0;
      toCreate += 1;
      totalAmountCents += Math.max(0, structure.amountCents - discount);
    }
    return {
      structureId: structure.id,
      studentCount: studentIds.length,
      toCreateCount: toCreate,
      skippedCount: studentIds.length - toCreate,
      totalAmountCents,
      currency: structure.currency,
    };
  }

  async bulkInvoiceClass(tenantId: string, actorId: string, input: BulkInvoiceInput) {
    // PRC-M086: the whole batch (invoices + journals + concession links)
    // commits in one transaction, so a failure part-way creates nothing.
    return this.repository.runInTransaction(tenantId, async (tx) => {
      const { structure, classId, gradeId, studentIds } = await this.resolveBulkInvoiceScope(
        tx,
        tenantId,
        input,
      );
      if (studentIds.length === 0) {
        throw new BusinessRuleError('No students found to invoice for this class/grade');
      }
      const created: FeeInvoiceEntity[] = [];
      const skipped: string[] = [];
      const { alreadyInvoiced, concessionByStudent } = await this.bulkInvoiceLookups(
        tx,
        tenantId,
        structure.id,
        studentIds,
      );
      // PRC-L471: without an explicit dueAt, the invoice falls due on the structure's
      // first instalment (validFrom + dueOffsetDays) instead of never falling due.
      let dueAt: Date | null = input.dueAt ? new Date(input.dueAt) : null;
      if (!dueAt) {
        const [first] = [...(await tx.listStructureInstalments(tenantId, structure.id))].sort(
          (a, b) => a.sequence - b.sequence,
        );
        if (first) {
          dueAt = new Date(
            `${this.instalmentDueDate(structure, first.dueOffsetDays)}T00:00:00.000Z`,
          );
        }
      }
      for (const studentId of studentIds) {
        if (alreadyInvoiced.has(studentId)) {
          skipped.push(studentId);
          continue;
        }
        const concession = concessionByStudent.get(studentId) ?? null;
        const discount =
          concession && concession.status === 'approved'
            ? concessionDiscountCents(structure.amountCents, concession)
            : 0;
        const amountCents = Math.max(0, structure.amountCents - discount);
        const invoiceId = uuidv4();
        const row = await tx.createInvoice({
          id: invoiceId,
          tenantId,
          studentId,
          planId: null,
          title: structure.name,
          description: structure.category,
          amountCents,
          currency: structure.currency,
          status: 'open',
          dueAt,
          createdBy: actorId,
          invoiceNumber: invoiceNumberFor(await tx.nextDocumentNumber(tenantId, 'invoice')),
          structureId: structure.id,
          classId: classId ?? null,
          gradeId: gradeId ?? null,
        });
        if (amountCents > 0) {
          await this.postJournal(
            tx,
            row,
            actorId,
            'invoice issued',
            [
              ['accounts_receivable', 'debit'],
              ['fee_revenue', 'credit'],
            ],
            row.amountCents,
          );
        }
        if (concession) {
          await tx.updateConcession(concession.id, tenantId, { invoiceId: row.id });
        }
        created.push(row);
      }
      return { created, skipped, structureId: structure.id };
    });
  }

  async applyConcession(
    tenantId: string,
    actorId: string,
    input: ApplyConcessionInput,
    audit?: FeesMoneyAuditSink,
  ) {
    const structure = await this.getFeeStructure(tenantId, input.structureId);
    const discount = concessionDiscountCents(structure.amountCents, input);
    const peers = (await this.repository.listConcessions(tenantId)).filter(
      (c) => c.studentId === input.studentId && c.structureId === input.structureId,
    );
    if (!input.sourceDisbursementId) {
      const manual = peers.find((c) => c.sourceDisbursementId == null);
      if (manual) {
        throw new BusinessRuleError('A concession already exists for this student and structure');
      }
    }

    const autoApprove = input.autoApprove === true;
    if (input.sourceDisbursementId) {
      const bySource = await this.repository.findConcessionBySourceDisbursementId(
        tenantId,
        input.sourceDisbursementId,
      );
      if (bySource) {
        throw new BusinessRuleError(
          'A concession already exists for this scholarship disbursement',
        );
      }
    }

    const row: Omit<FeeConcessionEntity, 'createdAt'> = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      structureId: input.structureId,
      invoiceId: input.invoiceId ?? null,
      kind: input.kind,
      percent: input.kind === 'percent' ? (input.percent ?? 0) : null,
      amountCents: input.kind === 'amount' ? (input.amountCents ?? 0) : null,
      reason: input.reason,
      sourceDisbursementId: input.sourceDisbursementId ?? null,
      approverId: autoApprove ? (input.approverId ?? actorId) : null,
      status: autoApprove ? 'approved' : 'pending',
      createdBy: actorId,
    };

    if (!autoApprove) {
      const concession = await this.repository.createConcession(row);
      return { concession, invoice: null, discountCents: discount };
    }

    // PRC-L306: an auto-approved concession (scholarship netting) is created, applied,
    // journalled and audited in ONE money transaction — a failed audit rolls it all back.
    const auditKind = input.sourceDisbursementId ? 'scholarship_netting' : 'concession_approve';
    const target = await this.resolveConcessionTarget(tenantId, row);
    if (!target) {
      return this.repository.runInTransaction(tenantId, async (tx) => {
        const concession = await tx.createConcession(row);
        await audit?.(tx, {
          kind: auditKind,
          entityId: concession.id,
          invoiceId: null,
          amountCents: 0,
          beforeStatus: 'none',
          afterStatus: concession.status,
        });
        return { concession, invoice: null, discountCents: discount };
      });
    }
    return this.repository.withInvoiceLock(tenantId, target.id, async (tx, locked) => {
      const concession = await tx.createConcession(row);
      return this.applyConcessionLocked(
        tx,
        locked,
        tenantId,
        actorId,
        concession,
        discount,
        auditKind,
        audit,
      );
    });
  }

  /**
   * W2-FIN-04: second actor (≠ createdBy) approves a pending concession and posts ledger.
   */
  async approveConcession(
    tenantId: string,
    actorId: string,
    concessionId: string,
    audit?: FeesMoneyAuditSink,
  ) {
    const concession = await this.repository.findConcessionById(concessionId, tenantId);
    if (!concession) {
      throw new NotFoundError(`Concession with id '${concessionId}' not found`);
    }
    if (concession.status !== 'pending') {
      throw new BusinessRuleError('Only pending concessions can be approved');
    }
    if (concession.createdBy === actorId) {
      throw new BusinessRuleError('Concession creator cannot self-approve (four-eyes)');
    }
    const discount = concessionDiscountCents(
      (await this.getFeeStructure(tenantId, concession.structureId)).amountCents,
      concession,
    );
    // PRC-L306: re-check 'pending' and flip to 'approved' inside the same invoice lock
    // as the journal + face update + audit, so approve/reject/approve races serialize
    // and a failure anywhere leaves the concession pending.
    const approveInTx = async (tx: FeesRepository) => {
      const fresh = await tx.findConcessionById(concession.id, tenantId);
      if (!fresh || fresh.status !== 'pending') {
        throw new BusinessRuleError('Only pending concessions can be approved');
      }
      const approved = await tx.updateConcession(concession.id, tenantId, {
        status: 'approved',
        approverId: actorId,
      });
      return approved ?? { ...fresh, status: 'approved' as const, approverId: actorId };
    };
    const target = await this.resolveConcessionTarget(tenantId, concession);
    if (!target) {
      return this.repository.runInTransaction(tenantId, async (tx) => {
        const approved = await approveInTx(tx);
        await audit?.(tx, {
          kind: 'concession_approve',
          entityId: concession.id,
          invoiceId: null,
          amountCents: 0,
          beforeStatus: 'pending',
          afterStatus: 'approved',
        });
        return { concession: approved, invoice: null, discountCents: discount };
      });
    }
    return this.repository.withInvoiceLock(tenantId, target.id, async (tx, locked) => {
      const approved = await approveInTx(tx);
      return this.applyConcessionLocked(
        tx,
        locked,
        tenantId,
        actorId,
        approved,
        discount,
        'concession_approve',
        audit,
      );
    });
  }

  async rejectConcession(
    tenantId: string,
    actorId: string,
    concessionId: string,
    audit?: FeesMoneyAuditSink,
  ) {
    const concession = await this.repository.findConcessionById(concessionId, tenantId);
    if (!concession) {
      throw new NotFoundError(`Concession with id '${concessionId}' not found`);
    }
    if (concession.status !== 'pending') {
      throw new BusinessRuleError('Only pending concessions can be rejected');
    }
    if (concession.createdBy === actorId) {
      throw new BusinessRuleError('Concession creator cannot self-reject (four-eyes)');
    }
    // PRC-L306: status re-check + reject + audit in one transaction, under the same
    // invoice lock approve uses (when a target invoice exists) so they serialize.
    const rejectInTx = async (tx: FeesRepository, invoiceId: string | null) => {
      const fresh = await tx.findConcessionById(concession.id, tenantId);
      if (!fresh || fresh.status !== 'pending') {
        throw new BusinessRuleError('Only pending concessions can be rejected');
      }
      const rejected = await tx.updateConcession(concession.id, tenantId, {
        status: 'rejected',
        approverId: actorId,
      });
      await audit?.(tx, {
        kind: 'concession_reject',
        entityId: concession.id,
        invoiceId,
        amountCents: 0,
        beforeStatus: 'pending',
        afterStatus: 'rejected',
      });
      return {
        concession: rejected ?? { ...fresh, status: 'rejected' as const, approverId: actorId },
        invoice: null,
        discountCents: 0,
      };
    };
    const target = await this.resolveConcessionTarget(tenantId, concession);
    return target
      ? this.repository.withInvoiceLock(tenantId, target.id, (tx) => rejectInTx(tx, target.id))
      : this.repository.runInTransaction(tenantId, (tx) => rejectInTx(tx, null));
  }

  /** Invoice a concession applies to: its explicit invoice, else the structure/student invoice. */
  private async resolveConcessionTarget(
    tenantId: string,
    concession: Pick<FeeConcessionEntity, 'invoiceId' | 'structureId' | 'studentId'>,
  ): Promise<FeeInvoiceEntity | null> {
    return concession.invoiceId
      ? this.getInvoice(tenantId, concession.invoiceId)
      : this.repository.findInvoiceForStructureStudent(
          tenantId,
          concession.structureId,
          concession.studentId,
        );
  }

  /** Apply an approved concession to the locked invoice: journal + face + link + audit. */
  private async applyConcessionLocked(
    tx: FeesRepository,
    locked: LockedInvoiceBalance,
    tenantId: string,
    actorId: string,
    concession: FeeConcessionEntity,
    discount: number,
    auditKind: 'concession_approve' | 'scholarship_netting',
    audit?: FeesMoneyAuditSink,
  ) {
    const { invoice } = locked;
    if (invoice.status !== 'open') {
      throw new BusinessRuleError('Concession can only recompute dues on an open invoice');
    }
    // Never discount below cash already collected (negative AR).
    const unpaid = Math.max(0, invoice.amountCents - locked.paidCents);
    // PRC-M245: a manual concession larger than the unpaid balance is rejected;
    // scholarship netting (sourceDisbursementId) credits at most the unpaid balance.
    // Thrown inside the lock/transaction, so an auto-approved row created (PR #548)
    // or a pending row flipped to approved in this transaction is rolled back.
    if (discount > unpaid && concession.sourceDisbursementId == null) {
      throw new BusinessRuleError(`Concession ${discount} exceeds unpaid balance ${unpaid}`);
    }
    const applied = Math.min(discount, unpaid);
    const nextAmount = invoice.amountCents - applied;
    const journalId = applied > 0 ? uuidv4() : null;
    if (journalId) {
      await this.postJournal(
        tx,
        invoice,
        actorId,
        'concession applied',
        [
          ['fee_revenue', 'debit'],
          ['accounts_receivable', 'credit'],
        ],
        applied,
        { journalId },
      );
    }
    // PRC-M245: nothing left to collect -> settled.
    const updated = await tx.updateInvoice(invoice.id, tenantId, {
      amountCents: nextAmount,
      ...(nextAmount <= locked.paidCents ? { status: 'paid' as const } : {}),
    });
    await tx.updateConcession(concession.id, tenantId, {
      invoiceId: invoice.id,
      ...(journalId ? { journalId } : {}),
    });
    const refreshed = await tx.findConcessionById(concession.id, tenantId);
    await audit?.(tx, {
      kind: auditKind,
      entityId: concession.id,
      invoiceId: invoice.id,
      amountCents: applied,
      beforeStatus: invoice.status,
      afterStatus: updated?.status ?? invoice.status,
    });
    return { concession: refreshed ?? concession, invoice: updated, discountCents: applied };
  }

  async recordRefund(
    tenantId: string,
    actorId: string,
    input: RecordRefundInput,
    audit?: FeesMoneyAuditSink,
  ) {
    // PRC-H058: cap check (SQL SUM under FOR UPDATE) + refund row + journal in one txn,
    // so concurrent refunds serialize and cannot exceed collected cash.
    return this.repository.withInvoiceLock(tenantId, input.invoiceId, async (tx, locked) => {
      const { invoice } = locked;
      assertRefundWithinPaid(locked.paidCents, locked.refundedCents, input.amountCents);
      // PRC-M246: a refund targets one succeeded payment of THIS invoice and is capped
      // at what is still unrefunded on that payment. It never silently picks "the first"
      // payment of a multi-payment invoice.
      const succeeded = (await tx.listPaymentsForInvoice(tenantId, invoice.id)).filter(
        (p) => p.status === 'succeeded',
      );
      const target = input.paymentId
        ? succeeded.find((p) => p.id === input.paymentId)
        : succeeded.length === 1
          ? succeeded[0]
          : undefined;
      if (!target) {
        if (input.paymentId) {
          throw new NotFoundError(
            `Succeeded payment '${input.paymentId}' not found on invoice '${invoice.id}'`,
          );
        }
        throw new BusinessRuleError(
          'paymentId is required: this invoice has more than one payment to refund against',
        );
      }
      const refundedOnPayment = (await tx.listRefundsForInvoice(tenantId, invoice.id))
        .filter((r) => r.status === 'posted' && r.paymentId === target.id)
        .reduce((sum, r) => sum + r.amountCents, 0);
      if (refundedOnPayment + input.amountCents > target.amountCents) {
        throw new BusinessRuleError(
          `Refund cannot exceed the unrefunded amount of payment '${target.id}' ` +
            `(${target.amountCents - refundedOnPayment} cents)`,
        );
      }
      const paymentId = target.id;
      const journalId = uuidv4();
      const refund = await tx.createRefund({
        id: uuidv4(),
        tenantId,
        invoiceId: invoice.id,
        paymentId,
        amountCents: input.amountCents,
        reason: input.reason,
        status: 'posted',
        createdBy: actorId,
        journalId,
      });
      await this.postJournal(
        tx,
        invoice,
        actorId,
        'refund posted',
        [
          ['fee_revenue', 'debit'],
          ['cash', 'credit'],
        ],
        input.amountCents,
        { journalId },
      );
      await audit?.(tx, {
        kind: 'refund',
        entityId: refund.id,
        invoiceId: invoice.id,
        amountCents: input.amountCents,
        beforeStatus: invoice.status,
        afterStatus: invoice.status,
      });
      return refund;
    });
  }

  /**
   * W2-FIN-05: credit note reduces outstanding AR (unpaid face) without cash movement.
   * Journal: DR fee_revenue / CR accounts_receivable. Caps at unpaid balance.
   * Rejects paid/void/written_off invoices — post-payment cash return uses refunds.
   */
  async issueCreditNote(
    tenantId: string,
    actorId: string,
    input: IssueCreditNoteInput,
    audit?: FeesMoneyAuditSink,
  ) {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new BusinessRuleError('Credit note amountCents must be a positive integer');
    }
    const reason = input.reason.trim();
    if (reason.length === 0) {
      throw new BusinessRuleError('Credit note reason is required');
    }
    // PRC-H058: status + unpaid check, credit note row, face update and journal under
    // one invoice lock so a concurrent payment cannot make the unpaid balance stale.
    return this.repository.withInvoiceLock(tenantId, input.invoiceId, async (tx, locked) => {
      const { invoice } = locked;
      if (invoice.status === 'void' || invoice.status === 'written_off') {
        throw new BusinessRuleError(`Cannot credit-note a ${invoice.status} invoice`);
      }
      if (invoice.status === 'paid') {
        throw new BusinessRuleError(
          'Cannot credit-note a paid invoice — use refund for post-payment cash return',
        );
      }
      const unpaid = Math.max(0, invoice.amountCents - locked.paidCents);
      if (input.amountCents > unpaid) {
        throw new BusinessRuleError(
          `Credit note amountCents ${input.amountCents} exceeds unpaid balance ${unpaid}`,
        );
      }

      const journalId = uuidv4();
      const creditNote = await tx.createCreditNote({
        id: uuidv4(),
        tenantId,
        invoiceId: invoice.id,
        amountCents: input.amountCents,
        reason,
        status: 'posted',
        createdBy: actorId,
        journalId,
      });

      // PRC-M245: a credit note that clears the unpaid balance settles the invoice.
      const nextUnpaid = unpaid - input.amountCents;
      const updated = await tx.updateInvoice(invoice.id, tenantId, {
        amountCents: invoice.amountCents - input.amountCents,
        ...(nextUnpaid === 0 ? { status: 'paid' as const } : {}),
      });

      await this.postJournal(
        tx,
        invoice,
        actorId,
        'credit note posted',
        [
          ['fee_revenue', 'debit'],
          ['accounts_receivable', 'credit'],
        ],
        input.amountCents,
        { journalId },
      );
      await audit?.(tx, {
        kind: 'credit_note',
        entityId: creditNote.id,
        invoiceId: invoice.id,
        amountCents: input.amountCents,
        beforeStatus: invoice.status,
        afterStatus: updated!.status,
      });
      return { creditNote, invoice: updated! };
    });
  }

  /**
   * W2-FIN-05: write off uncollectible unpaid AR.
   * Journal: DR bad_debt_expense / CR accounts_receivable. Caps at unpaid balance.
   * When remaining unpaid hits zero, invoice status becomes written_off.
   */
  async writeOffInvoice(
    tenantId: string,
    actorId: string,
    input: WriteOffInvoiceInput,
    audit?: FeesMoneyAuditSink,
  ) {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new BusinessRuleError('Write-off amountCents must be a positive integer');
    }
    const reason = input.reason.trim();
    if (reason.length === 0) {
      throw new BusinessRuleError('Write-off reason is required');
    }
    // PRC-H058: locked read-check-write + journal in one transaction.
    return this.repository.withInvoiceLock(tenantId, input.invoiceId, async (tx, locked) => {
      const { invoice } = locked;
      if (invoice.status === 'void' || invoice.status === 'written_off') {
        throw new BusinessRuleError(`Cannot write off a ${invoice.status} invoice`);
      }
      if (invoice.status === 'paid') {
        throw new BusinessRuleError('Cannot write off a paid invoice — use refund if needed');
      }
      const unpaid = Math.max(0, invoice.amountCents - locked.paidCents);
      if (input.amountCents > unpaid) {
        throw new BusinessRuleError(
          `Write-off amountCents ${input.amountCents} exceeds unpaid balance ${unpaid}`,
        );
      }

      const journalId = uuidv4();
      const writeOff = await tx.createWriteOff({
        id: uuidv4(),
        tenantId,
        invoiceId: invoice.id,
        amountCents: input.amountCents,
        reason,
        status: 'posted',
        createdBy: actorId,
        journalId,
      });

      const nextUnpaid = unpaid - input.amountCents;
      const updated = await tx.updateInvoice(invoice.id, tenantId, {
        amountCents: invoice.amountCents - input.amountCents,
        ...(nextUnpaid === 0 ? { status: 'written_off' as const } : {}),
      });

      await this.postJournal(
        tx,
        invoice,
        actorId,
        'write-off posted',
        [
          ['bad_debt_expense', 'debit'],
          ['accounts_receivable', 'credit'],
        ],
        input.amountCents,
        { journalId },
      );
      await audit?.(tx, {
        kind: 'write_off',
        entityId: writeOff.id,
        invoiceId: invoice.id,
        amountCents: input.amountCents,
        beforeStatus: invoice.status,
        afterStatus: updated!.status,
      });
      return { writeOff, invoice: updated! };
    });
  }

  private isReminderSuppressedInRows(
    suppressions: ReminderSuppressionEntity[],
    studentId: string,
    invoiceId: string,
  ): boolean {
    return suppressions.some(
      (row) =>
        (row.invoiceId != null && row.invoiceId === invoiceId) ||
        (row.studentId != null && row.studentId === studentId),
    );
  }

  async listOverdueForReminder(tenantId: string, asOf: Date) {
    const [invoices, suppressions] = await Promise.all([
      this.repository.listInvoicesForTenant(tenantId),
      this.repository.listReminderSuppressions(tenantId),
    ]);
    const candidates = invoices.filter(
      (invoice) => isCollectible(invoice.status) && invoice.dueAt != null && invoice.dueAt < asOf,
    );
    // PRC-M249: remind for the outstanding balance (face − succeeded payments, SQL SUM).
    const paid = await this.repository.sumSucceededPaymentsByInvoice(
      tenantId,
      candidates.map((i) => i.id),
    );
    const openOverdue = candidates
      .map((invoice) => ({
        invoice,
        outstanding: Math.max(0, invoice.amountCents - (paid.get(invoice.id) ?? 0)),
      }))
      .filter((row) => row.outstanding > 0);
    return openOverdue.map(({ invoice, outstanding }) => ({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      studentId: invoice.studentId,
      classId: invoice.classId,
      amountCents: outstanding,
      invoiceAmountCents: invoice.amountCents,
      currency: invoice.currency,
      dueAt: invoice.dueAt!.toISOString(),
      overdueDays: Math.max(
        1,
        Math.floor((asOf.getTime() - invoice.dueAt!.getTime()) / 86_400_000),
      ),
      suppressed: this.isReminderSuppressedInRows(suppressions, invoice.studentId, invoice.id),
    }));
  }

  async listReminderSuppressions(tenantId: string): Promise<ReminderSuppressionEntity[]> {
    return this.repository.listReminderSuppressions(tenantId);
  }

  async addReminderSuppression(
    tenantId: string,
    actorId: string,
    input: AddReminderSuppressionInput,
  ): Promise<ReminderSuppressionEntity> {
    const studentId = input.studentId?.trim() || null;
    const invoiceId = input.invoiceId?.trim() || null;
    if (!studentId && !invoiceId) {
      throw new BusinessRuleError('studentId or invoiceId is required for a suppression');
    }
    if (!input.reason?.trim()) {
      throw new BusinessRuleError('reason is required');
    }
    const entity: ReminderSuppressionEntity = {
      id: uuidv4(),
      tenantId,
      studentId,
      invoiceId,
      reason: input.reason.trim(),
      createdBy: actorId,
      createdAt: new Date(),
    };
    return this.repository.createReminderSuppression(entity);
  }

  async removeReminderSuppression(tenantId: string, suppressionId: string): Promise<void> {
    const deleted = await this.repository.deleteReminderSuppression(tenantId, suppressionId);
    if (!deleted) {
      throw new NotFoundError(`Reminder suppression ${suppressionId} not found`);
    }
  }

  async listReminderSendAudits(tenantId: string): Promise<ReminderSendAuditEntity[]> {
    return this.repository.listReminderSendAudits(tenantId);
  }

  async sendReminders(
    tenantId: string,
    actorId: string,
    input: SendRemindersInput,
    asOf: Date = new Date(),
  ): Promise<{
    mode: ReminderSendMode;
    honestyNote: string;
    results: SendReminderResultRow[];
  }> {
    const delivery = this.reminderDelivery;
    const mode: ReminderSendMode = delivery ? 'live' : 'sandbox';
    const honestyNote = delivery
      ? FEES_REMINDER_LIVE_HONESTY_NOTE
      : FEES_REMINDER_SANDBOX_HONESTY_NOTE;
    const channels = [...new Set(input.channels)];
    if (channels.length === 0) {
      throw new BusinessRuleError('At least one channel (email or sms) is required');
    }
    if (!input.invoiceIds?.length) {
      throw new BusinessRuleError('invoiceIds is required');
    }
    const minOverdueDays = Math.max(1, input.minOverdueDays ?? 1);
    const cadenceDays = Math.max(0, input.cadenceDays ?? 0);
    const overdue = await this.listOverdueForReminder(tenantId, asOf);
    const byId = new Map(overdue.map((row) => [row.invoiceId, row]));
    const results: SendReminderResultRow[] = [];
    // PRC-L106: read the send audit once per run (was once per invoice x channel), and
    // index it by message id and by (invoice, channel) for the cadence check.
    const priorAudits = await this.repository.listReminderSendAudits(tenantId);
    const auditByMessageId = new Map<string, ReminderSendAuditEntity>();
    const lastSentAt = new Map<string, number>();
    const remember = (audit: ReminderSendAuditEntity) => {
      auditByMessageId.set(audit.messageId, audit);
      const key = `${audit.invoiceId}:${audit.channel}`;
      lastSentAt.set(key, Math.max(lastSentAt.get(key) ?? 0, audit.createdAt.getTime()));
    };
    priorAudits.forEach(remember);
    const sendDay = asOf.toISOString().slice(0, 10);

    for (const invoiceId of input.invoiceIds) {
      const row = byId.get(invoiceId);
      if (!row) {
        for (const channel of channels) {
          results.push({
            invoiceId,
            studentId: '',
            channel,
            messageId: null,
            suppressed: false,
            skippedReason: 'not_overdue_or_unknown',
          });
        }
        continue;
      }
      if (row.suppressed) {
        for (const channel of channels) {
          results.push({
            invoiceId,
            studentId: row.studentId,
            channel,
            messageId: null,
            suppressed: true,
            skippedReason: 'suppressed',
          });
        }
        continue;
      }
      if (row.overdueDays < minOverdueDays) {
        for (const channel of channels) {
          results.push({
            invoiceId,
            studentId: row.studentId,
            channel,
            messageId: null,
            suppressed: false,
            skippedReason: 'below_min_overdue_days',
          });
        }
        continue;
      }

      for (const channel of channels) {
        // PRC-L106: one reminder per (tenant, invoice, channel, day). The message id is
        // derived from those, so a retried or repeated run reuses it instead of minting
        // a new Date.now() id and a second audit row.
        const messageId = `${mode}-${channel}:fees:${tenantId}:${invoiceId}:${sendDay}`;
        if (cadenceDays > 0) {
          const cutoff = asOf.getTime() - cadenceDays * 86_400_000;
          const recent = (lastSentAt.get(`${invoiceId}:${channel}`) ?? -1) >= cutoff;
          if (recent) {
            results.push({
              invoiceId,
              studentId: row.studentId,
              channel,
              messageId: null,
              suppressed: false,
              skippedReason: 'within_cadence',
            });
            continue;
          }
        }
        const existing = auditByMessageId.get(messageId);
        if (existing) {
          results.push({
            invoiceId,
            studentId: row.studentId,
            channel,
            messageId,
            suppressed: false,
            skippedReason: 'already_sent',
            auditId: existing.id,
          });
          continue;
        }

        // PRC-L291: a live row carries the provider's own message id (db/sql/328).
        const sent = delivery
          ? await delivery.send({
              tenantId,
              invoiceId,
              studentId: row.studentId,
              channel,
              idempotencyKey: messageId,
            })
          : null;
        const audit: ReminderSendAuditEntity = {
          id: uuidv4(),
          tenantId,
          invoiceId,
          studentId: row.studentId,
          channel,
          messageId,
          mode,
          provider: sent?.provider ?? null,
          providerMessageId: sent?.providerMessageId ?? null,
          honestyNote,
          actorId,
          createdAt: new Date(),
        };
        await this.repository.createReminderSendAudit(audit);
        remember(audit);
        results.push({
          invoiceId,
          studentId: row.studentId,
          channel,
          messageId,
          suppressed: false,
          auditId: audit.id,
        });
      }
    }

    return {
      mode,
      honestyNote,
      results,
    };
  }

  async duesReport(tenantId: string, asOf: Date = new Date()) {
    const invoices = await this.repository.listInvoicesForTenant(tenantId);
    const byClass = new Map<
      string,
      {
        classId: string;
        openCount: number;
        overdueCount: number;
        openCents: number;
        overdueCents: number;
      }
    >();
    const byStatus = new Map<string, { status: string; count: number; amountCents: number }>();
    const overdue: Array<{
      invoiceId: string;
      invoiceNumber: string | null;
      studentId: string;
      classId: string | null;
      amountCents: number;
      overdueDays: number;
    }> = [];

    // PRC-M249: outstanding = face − succeeded payments (SQL aggregate), open + overdue alike.
    const paid = await this.repository.sumSucceededPaymentsByInvoice(
      tenantId,
      invoices.filter((i) => isCollectible(i.status)).map((i) => i.id),
    );
    for (const invoice of invoices) {
      const statusRow = byStatus.get(invoice.status) ?? {
        status: invoice.status,
        count: 0,
        amountCents: 0,
      };
      statusRow.count += 1;
      statusRow.amountCents += invoice.amountCents;
      byStatus.set(invoice.status, statusRow);

      if (!isCollectible(invoice.status)) continue;
      const outstanding = Math.max(0, invoice.amountCents - (paid.get(invoice.id) ?? 0));
      if (outstanding === 0) continue;
      const classKey = invoice.classId ?? 'unassigned';
      const classRow = byClass.get(classKey) ?? {
        classId: classKey,
        openCount: 0,
        overdueCount: 0,
        openCents: 0,
        overdueCents: 0,
      };
      classRow.openCount += 1;
      classRow.openCents += outstanding;
      if (invoice.dueAt && invoice.dueAt < asOf) {
        const overdueDays = Math.max(
          1,
          Math.floor((asOf.getTime() - invoice.dueAt.getTime()) / 86_400_000),
        );
        classRow.overdueCount += 1;
        classRow.overdueCents += outstanding;
        overdue.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          studentId: invoice.studentId,
          classId: invoice.classId,
          amountCents: outstanding,
          overdueDays,
        });
      }
      byClass.set(classKey, classRow);
    }

    return {
      asOf: asOf.toISOString(),
      byClass: [...byClass.values()],
      byStatus: [...byStatus.values()],
      overdue,
    };
  }

  /**
   * PRC-M251: a bank line reconciles one succeeded payment on the named invoice with the
   * same amount (not the invoice face), and the link is stored on the row (payment_id).
   * Matching key (owner topic 8): bank reference / UTR + amount in minor units + value
   * date; a line already reconciled under that key, or a payment already reconciled, is
   * an exception. Re-importing the same file content returns the existing batch.
   * A bank credit with no recorded payment stays an open exception (nothing is posted).
   */
  async importReconciliationCsv(
    tenantId: string,
    actorId: string,
    csv: string,
    filename = 'import.csv',
  ) {
    const contentHash = reconciliationContentHash(csv);
    const prior = await this.repository.findReconciliationBatchByContentHash(tenantId, contentHash);
    if (prior) return this.replayReconciliationBatch(tenantId, prior);
    const parsed = parseReconciliationCsv(csv);
    type ReconLine = {
      invoiceNumber: string;
      amountCents: number;
      bankReference: string | null;
      valueDate: string | null;
    };
    const matched: Array<ReconLine & { invoiceId: string; paymentId: string }> = [];
    const unmatched: Array<ReconLine & { note: string; invoiceId: string | null }> = [];
    const claimedPayments = new Set<string>();
    const claimedLines = new Set<string>();
    const lineKey = (l: ReconLine) =>
      l.bankReference && l.valueDate ? `${l.bankReference}|${l.amountCents}|${l.valueDate}` : null;
    for (const row of parsed) {
      const line: ReconLine = {
        invoiceNumber: row.invoiceNumber,
        amountCents: Number.isFinite(row.amountCents) ? row.amountCents : 0,
        bankReference: row.bankReference,
        valueDate: row.invalidValueDate ? null : row.valueDate,
      };
      const reject = (note: string, invoiceId: string | null = null) =>
        unmatched.push({ ...line, note, invoiceId });
      if (!Number.isFinite(row.amountCents)) {
        reject('invalid amount');
        continue;
      }
      if (row.invalidValueDate) {
        reject('invalid value date');
        continue;
      }
      const invoice = await this.repository.findInvoiceByNumber(tenantId, row.invoiceNumber);
      if (!invoice) {
        reject('invoice not found');
        continue;
      }
      const key = lineKey(line);
      const payments = (await this.repository.listPaymentsForInvoice(tenantId, invoice.id)).filter(
        (p) => p.status === 'succeeded',
      );
      const reconciled = await this.repository.listMatchedReconciliationRows(tenantId, {
        paymentIds: payments.map((p) => p.id),
        bankReferences: line.bankReference ? [line.bankReference] : [],
      });
      const lineTaken =
        key != null &&
        (claimedLines.has(key) || reconciled.some((r) => lineKey(r as ReconLine) === key));
      if (lineTaken) {
        reject('bank line already reconciled', invoice.id);
        continue;
      }
      const taken = new Set([
        ...claimedPayments,
        ...reconciled.map((r) => r.paymentId).filter((id): id is string => id != null),
      ]);
      const payment = payments.find((p) => p.amountCents === row.amountCents && !taken.has(p.id));
      if (!payment) {
        reject(
          payments.some((p) => p.amountCents === row.amountCents)
            ? 'payment already reconciled'
            : 'no recorded payment of this amount on the invoice',
          invoice.id,
        );
        continue;
      }
      claimedPayments.add(payment.id);
      if (key) claimedLines.add(key);
      matched.push({ ...line, invoiceId: invoice.id, paymentId: payment.id });
    }
    const toRow = (
      line: ReconLine & { invoiceId: string | null; paymentId?: string; note?: string },
      batchId: string,
    ) => ({
      id: uuidv4(),
      tenantId,
      batchId,
      invoiceNumber: line.invoiceNumber,
      amountCents: line.amountCents,
      matched: line.paymentId != null,
      invoiceId: line.invoiceId,
      note: line.note ?? null,
      exceptionStatus: (line.paymentId != null ? 'none' : 'open') as ReconExceptionStatus,
      resolvedBy: null as string | null,
      resolvedAt: null as Date | null,
      resolutionNote: null as string | null,
      bankReference: line.bankReference,
      valueDate: line.valueDate,
      paymentId: line.paymentId ?? null,
    });
    try {
      // Batch and rows commit together; the unique indexes (db/sql/331) are the backstop
      // for a concurrent import of the same file or of a line for the same payment.
      const batch = await this.repository.runInTransaction(tenantId, async (tx) => {
        const created = await tx.createReconciliationBatch({
          id: uuidv4(),
          tenantId,
          filename,
          matchedCount: matched.length,
          unmatchedCount: unmatched.length,
          createdBy: actorId,
          contentHash,
        });
        await tx.createReconciliationRows([
          ...matched.map((line) => toRow(line, created.id)),
          ...unmatched.map((line) => toRow(line, created.id)),
        ]);
        return created;
      });
      return { batch, matched, unmatched, idempotent: false as boolean };
    } catch (err) {
      const e = err as { code?: string; constraint?: string } | null;
      if (e?.code === '23505' && e.constraint === 'fee_reconciliation_batches_content_hash_uidx') {
        const winner = await this.repository.findReconciliationBatchByContentHash(
          tenantId,
          contentHash,
        );
        if (winner) return this.replayReconciliationBatch(tenantId, winner);
      }
      if (
        e?.code === '23505' &&
        String(e.constraint ?? '').startsWith('fee_reconciliation_rows_')
      ) {
        throw new ConflictError(
          'A payment or bank line in this file was reconciled by another import; retry the import',
        );
      }
      throw err;
    }
  }

  /** PRC-M251: the stored outcome of an already imported file. */
  private async replayReconciliationBatch(tenantId: string, batch: FeeReconciliationBatchEntity) {
    const rows = await this.repository.listReconciliationRows(tenantId, batch.id);
    const line = (r: FeeReconciliationRowEntity) => ({
      invoiceNumber: r.invoiceNumber,
      amountCents: r.amountCents,
      bankReference: r.bankReference ?? null,
      valueDate: r.valueDate ?? null,
    });
    return {
      batch,
      matched: rows
        .filter((r) => r.matched)
        .map((r) => ({ ...line(r), invoiceId: r.invoiceId ?? '', paymentId: r.paymentId ?? '' })),
      unmatched: rows
        .filter((r) => !r.matched)
        .map((r) => ({ ...line(r), note: r.note ?? '', invoiceId: r.invoiceId })),
      idempotent: true as boolean,
    };
  }

  async listReconciliationBatches(tenantId: string) {
    return this.repository.listReconciliationBatches(tenantId);
  }

  async listReconciliationRows(tenantId: string, batchId: string) {
    return this.repository.listReconciliationRows(tenantId, batchId);
  }

  async resolveReconciliationException(
    tenantId: string,
    actorId: string,
    input: { rowId: string; status: 'resolved' | 'ignored'; resolutionNote: string },
  ) {
    const row = await this.repository.findReconciliationRowById(tenantId, input.rowId);
    if (!row) {
      throw new NotFoundError(`Reconciliation row with id '${input.rowId}' not found`);
    }
    if (row.matched || row.exceptionStatus === 'none') {
      throw new BusinessRuleError('Matched reconciliation rows cannot be resolved as exceptions');
    }
    if (row.exceptionStatus === 'resolved' || row.exceptionStatus === 'ignored') {
      throw new BusinessRuleError('Exception already closed');
    }
    const note = input.resolutionNote.trim();
    if (note.length === 0) {
      throw new BusinessRuleError('resolutionNote is required');
    }
    const updated = await this.repository.updateReconciliationRow(tenantId, row.id, {
      exceptionStatus: input.status,
      resolvedBy: actorId,
      resolvedAt: new Date(),
      resolutionNote: note,
    });
    if (!updated) {
      throw new NotFoundError(`Reconciliation row with id '${input.rowId}' not found`);
    }
    return updated;
  }

  async listInvoicesForStudentIds(tenantId: string, studentIds: string[]) {
    return this.repository.listInvoicesForStudentIds(tenantId, studentIds);
  }

  async listReceiptsForInvoiceIds(tenantId: string, invoiceIds: string[]) {
    if (invoiceIds.length === 0) return [];
    return this.repository.listReceiptsForInvoiceIds(tenantId, [...new Set(invoiceIds)]);
  }

  /**
   * G-1 scholarship netting — credit open fee invoices from a paid disbursement.
   *
   * F-D1: the credit is the disbursement amount in exact integer paise, whatever the
   * invoice type (structure, plan or ad-hoc). It is never priced on a fee structure.
   * F-D2: one call credits at most the chosen invoice's open amount (face − collected).
   * Any remainder stays on the disbursement (`remainingCents`) and a later call credits it
   * to the student's next open invoice. A disbursement is netted only once its full amount
   * has been applied. Each credited invoice gets one netting row (unique per disbursement
   * and invoice, db/sql/305), and the read-check-write runs under a per-disbursement lock,
   * so double clicks, retries, outbox redelivery and concurrent calls never credit more
   * than the disbursement amount.
   */
  async applyScholarshipNetting(
    tenantId: string,
    actorId: string,
    input: {
      studentId: string;
      disbursementId: string;
      amountCents: number;
      invoiceId?: string;
      currency?: string;
    },
    audit?: FeesMoneyAuditSink,
  ): Promise<ScholarshipNettingResult> {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new BusinessRuleError('Scholarship netting amountCents must be a positive integer');
    }
    const isNettable = (row: FeeInvoiceEntity) => row.status === 'open' || row.status === 'overdue';
    // Netting rows need a structure FK. Ad-hoc and plan invoices have none, so their rows
    // reference the SCHOLARSHIP_NET structure (FK only; its price is never used). Resolved
    // before the lock so the locked transaction never waits on a second pool connection.
    const preview = await this.repository.listInvoicesForStudentIds(tenantId, [input.studentId]);
    const structureless = preview.find(
      (row) => row.structureId == null && (row.id === input.invoiceId || isNettable(row)),
    );
    const anchorId = structureless
      ? (
          await this.scholarshipNetStructure(
            tenantId,
            actorId,
            input.currency ?? structureless.currency,
          )
        ).id
      : null;

    return this.repository.withScholarshipDisbursementLock(
      tenantId,
      input.disbursementId,
      async (tx) => {
        const rows = await tx.listConcessionsBySourceDisbursementId(tenantId, input.disbursementId);
        const live = rows.filter((row) => row.status !== 'rejected');
        const nettedBefore = live.reduce((sum, row) => sum + (row.amountCents ?? 0), 0);
        const remainingBefore = Math.max(0, input.amountCents - nettedBefore);
        const totals = (appliedCents: number) => ({
          appliedCents,
          amountCents: input.amountCents,
          nettedCents: nettedBefore + appliedCents,
          remainingCents: Math.max(0, remainingBefore - appliedCents),
        });
        // Nothing credited by this call. With prior rows this is a replay: PRC-H020 reports
        // the stored credit, never the caller-supplied amount.
        const noCredit = async (): Promise<ScholarshipNettingResult> => {
          const last = rows.at(-1) ?? null;
          const invoice = last?.invoiceId
            ? await tx.findInvoiceById(last.invoiceId, tenantId)
            : null;
          return {
            concession: last,
            invoice,
            discountCents: nettedBefore,
            ...totals(0),
            idempotent: rows.length > 0,
          };
        };
        // W2-FIN-08: a reversed disbursement is never netted again; a fully netted one is a replay.
        if (rows.length > 0 && live.length === 0) return noCredit();
        if (remainingBefore === 0) return noCredit();

        const invoices = await tx.listInvoicesForStudentIds(tenantId, [input.studentId]);
        const credited = new Set(live.map((row) => row.invoiceId));
        const target =
          (input.invoiceId
            ? invoices.find((row) => row.id === input.invoiceId && !credited.has(row.id))
            : undefined) ??
          invoices.find((row) => isNettable(row) && !credited.has(row.id)) ??
          null;
        // No open invoice: the full remainder stays on the disbursement for the next one.
        if (!target) return noCredit();

        const structureId =
          target.structureId ??
          anchorId ??
          (await tx.listFeeStructures(tenantId)).find((s) => s.code === 'SCHOLARSHIP_NET')?.id;
        if (!structureId) {
          // The invoice appeared after the pre-lock read; a retry creates the anchor first.
          throw new BusinessRuleError('Scholarship netting structure is not ready; retry netting');
        }

        return tx.withInvoiceLock(tenantId, target.id, async (lockedTx, locked) => {
          if (locked.invoice.status !== 'open') {
            throw new BusinessRuleError('Concession can only recompute dues on an open invoice');
          }
          // Never credit more than is still open on the invoice (never below cash collected).
          const unpaid = Math.max(0, locked.invoice.amountCents - locked.paidCents);
          const credit = Math.min(remainingBefore, unpaid);
          if (credit === 0) return noCredit();
          const concession = await lockedTx.createConcession({
            id: uuidv4(),
            tenantId,
            studentId: input.studentId,
            structureId,
            invoiceId: target.id,
            kind: 'amount',
            percent: null,
            // The row records exactly the paise credited to this invoice.
            amountCents: credit,
            reason: `scholarship_netting:${input.disbursementId}`,
            sourceDisbursementId: input.disbursementId,
            approverId: actorId,
            status: 'approved',
            createdBy: actorId,
          });
          const applied = await this.applyConcessionLocked(
            lockedTx,
            locked,
            tenantId,
            actorId,
            concession,
            credit,
            'scholarship_netting',
            audit,
          );
          return {
            concession: applied.concession,
            invoice: applied.invoice,
            discountCents: applied.discountCents,
            ...totals(applied.discountCents),
            idempotent: false,
          };
        });
      },
    );
  }

  /** Anchor structure for netting rows on invoices that have no fee structure. */
  private async scholarshipNetStructure(tenantId: string, actorId: string, currency: string) {
    const find = async () =>
      (await this.repository.listFeeStructures(tenantId)).find((s) => s.code === 'SCHOLARSHIP_NET');
    const existing = await find();
    if (existing) return existing;
    try {
      return await this.createFeeStructure(tenantId, actorId, {
        code: 'SCHOLARSHIP_NET',
        name: 'Scholarship netting',
        category: 'scholarship',
        amountCents: 0,
        currency,
      });
    } catch (error) {
      // A concurrent netting created it first (code/validity overlap is rejected).
      const winner = await find();
      if (winner) return winner;
      throw error;
    }
  }

  /**
   * PRC-H020: HTTP-facing netting. The disbursement is loaded from the scholarship
   * domain (tenant-scoped) and must be `paid` for the same student; the credited
   * amount always comes from the disbursement, never from the operator.
   */
  async applyVerifiedScholarshipNetting(
    tenantId: string,
    actorId: string,
    lookup: ScholarshipDisbursementLookup,
    input: {
      studentId: string;
      disbursementId: string;
      amountCents?: number;
      invoiceId?: string;
      currency?: string;
    },
    audit?: FeesMoneyAuditSink,
  ) {
    const disbursement = await lookup.findDisbursement(tenantId, input.disbursementId);
    if (!disbursement || disbursement.tenantId !== tenantId) {
      throw new NotFoundError(`Scholarship disbursement '${input.disbursementId}' not found`);
    }
    if (disbursement.paymentStatus !== 'paid') {
      throw new BusinessRuleError('Only paid scholarship disbursements can be netted');
    }
    if (disbursement.studentId !== input.studentId) {
      throw new BusinessRuleError('Disbursement does not belong to the selected student');
    }
    if (
      input.amountCents !== undefined &&
      input.amountCents !== null &&
      input.amountCents !== disbursement.amountCents
    ) {
      throw new BusinessRuleError('Netting amount must equal the paid disbursement amount');
    }
    return this.applyScholarshipNetting(
      tenantId,
      actorId,
      {
        studentId: disbursement.studentId,
        disbursementId: disbursement.id,
        amountCents: disbursement.amountCents,
        invoiceId: input.invoiceId,
        currency: disbursement.currency ?? input.currency,
      },
      audit,
    );
  }
  /**
   * PRC-H020: paid disbursements for the tenant that still have paise to net.
   * F-D2: a partly netted disbursement stays listed with `nettedCents` / `remainingCents`;
   * fully netted and reversed (W2-FIN-08) disbursements are not listed.
   */
  async listNettableScholarshipDisbursements(
    tenantId: string,
    lookup: ScholarshipDisbursementLookup,
    filter: { studentId?: string } = {},
  ): Promise<NettableScholarshipDisbursement[]> {
    const rows = await lookup.listPaidDisbursements(tenantId, filter);
    const nettable: NettableScholarshipDisbursement[] = [];
    for (const row of rows) {
      if (row.tenantId !== tenantId || row.paymentStatus !== 'paid') continue;
      if (filter.studentId && row.studentId !== filter.studentId) continue;
      const netting = await this.repository.listConcessionsBySourceDisbursementId(tenantId, row.id);
      const live = netting.filter((c) => c.status !== 'rejected');
      if (netting.length > 0 && live.length === 0) continue;
      const nettedCents = live.reduce((sum, c) => sum + (c.amountCents ?? 0), 0);
      const remainingCents = Math.max(0, row.amountCents - nettedCents);
      if (remainingCents > 0) nettable.push({ ...row, nettedCents, remainingCents });
    }
    return nettable;
  }

  /**
   * W2-FIN-08: reverse a prior scholarship netting when a paid disbursement is cancelled/failed.
   * F-D2: every invoice the disbursement credited is restored by the paise it received, with
   * the inverse journal (DR AR / CR fee_revenue); an invoice settled by the credit reopens.
   */
  async reverseScholarshipNetting(
    tenantId: string,
    actorId: string,
    input: { disbursementId: string },
    audit?: FeesMoneyAuditSink,
  ) {
    // PRC-H058: per-disbursement lock, then each invoice lock; face restore + journal +
    // concession rejection + audit for every row commit together.
    return this.repository.withScholarshipDisbursementLock(
      tenantId,
      input.disbursementId,
      async (tx) => {
        const rows = await tx.listConcessionsBySourceDisbursementId(tenantId, input.disbursementId);
        if (rows.length === 0) {
          return { reversed: false as const, concession: null, invoice: null };
        }
        const live = rows.filter((row) => row.status !== 'rejected');
        if (live.length === 0) {
          return {
            reversed: true as const,
            concession: rows.at(-1) ?? null,
            invoice: null,
            idempotent: true as const,
          };
        }
        let concession: FeeConcessionEntity | null = null;
        let invoice: FeeInvoiceEntity | null = null;
        let discountCents = 0;
        for (const row of live) {
          const amount = row.kind === 'amount' ? (row.amountCents ?? 0) : 0;
          if (!Number.isInteger(amount) || amount <= 0) {
            throw new BusinessRuleError(
              'Cannot reverse scholarship netting without a positive amount',
            );
          }
          if (!row.invoiceId) {
            // Legacy reserved row: no invoice was credited, nothing to restore.
            const rejected = await tx.updateConcession(row.id, tenantId, { status: 'rejected' });
            await audit?.(tx, {
              kind: 'scholarship_netting_reversal',
              entityId: row.id,
              invoiceId: null,
              amountCents: 0,
              beforeStatus: row.status,
              afterStatus: 'rejected',
            });
            concession = rejected ?? concession;
            continue;
          }
          const reversed = await tx.withInvoiceLock(
            tenantId,
            row.invoiceId,
            async (lockedTx, locked) => {
              const nextAmount = locked.invoice.amountCents + amount;
              const reopen =
                locked.invoice.status === 'written_off' ||
                (locked.invoice.status === 'paid' && nextAmount > locked.paidCents);
              const restored = await lockedTx.updateInvoice(locked.invoice.id, tenantId, {
                amountCents: nextAmount,
                ...(reopen ? { status: 'open' as const } : {}),
              });
              await this.postJournal(
                lockedTx,
                restored!,
                actorId,
                'scholarship netting reversed',
                [
                  ['accounts_receivable', 'debit'],
                  ['fee_revenue', 'credit'],
                ],
                amount,
              );
              const rejected = await lockedTx.updateConcession(row.id, tenantId, {
                status: 'rejected',
              });
              // PRC-L306: reversal audit commits or rolls back with the face restore + journal.
              await audit?.(lockedTx, {
                kind: 'scholarship_netting_reversal',
                entityId: row.id,
                invoiceId: locked.invoice.id,
                amountCents: amount,
                beforeStatus: row.status,
                afterStatus: 'rejected',
              });
              return { restored, rejected };
            },
          );
          concession = reversed.rejected ?? concession;
          invoice = reversed.restored ?? invoice;
          discountCents += amount;
        }
        return {
          reversed: true as const,
          concession,
          invoice,
          discountCents,
          idempotent: false as const,
        };
      },
    );
  }

  /** G-5 — clone fee structures (+ instalments) into a target academic period. */
  async cloneStructuresForPeriod(
    tenantId: string,
    actorId: string,
    sourcePeriodId: string,
    targetPeriodId: string,
    options: { dryRun?: boolean } = {},
  ) {
    if (sourcePeriodId === targetPeriodId) {
      throw new BusinessRuleError('Source and target academic periods must differ');
    }
    const source = (await this.repository.listFeeStructures(tenantId)).filter(
      (s) => s.academicPeriodId === sourcePeriodId && s.status === 'active',
    );
    const targetExisting = await this.repository.listFeeStructures(tenantId);
    if (options.dryRun) {
      let planned = 0;
      for (const row of source) {
        const code = `${row.code}`.slice(0, 24) + '_R';
        if (!targetExisting.some((x) => x.academicPeriodId === targetPeriodId && x.code === code)) {
          planned += 1;
        }
      }
      return { cloned: planned, source: source.length };
    }
    const created = [];
    for (const row of source) {
      const code = `${row.code}`.slice(0, 24) + '_R';
      if (targetExisting.some((t) => t.academicPeriodId === targetPeriodId && t.code === code)) {
        continue;
      }
      const cloned = await this.createFeeStructure(tenantId, actorId, {
        code,
        name: row.name,
        category: row.category,
        term: row.term ?? undefined,
        amountCents: row.amountCents,
        currency: row.currency,
        institutionId: row.institutionId ?? undefined,
        academicPeriodId: targetPeriodId,
        gradeId: row.gradeId ?? undefined,
        classId: row.classId ?? undefined,
      });
      const instalments = await this.repository.listStructureInstalments(tenantId, row.id);
      if (instalments.length > 0) {
        await this.repository.replaceStructureInstalments(
          tenantId,
          cloned.id,
          instalments.map((inst, index) => ({
            id: uuidv4(),
            tenantId,
            structureId: cloned.id,
            sequence: inst.sequence ?? index + 1,
            amountCents: inst.amountCents,
            dueOffsetDays: inst.dueOffsetDays,
            label: inst.label,
          })),
        );
      }
      created.push(cloned);
    }
    return { cloned: created.length, source: source.length };
  }
}
