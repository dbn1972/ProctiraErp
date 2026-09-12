/**
 * Fees service — plans, invoices, sandbox payments, receipts.
 * recordPayment enforces receipt.amountCents === payment.amountCents === invoice.amountCents.
 */
import { BusinessRuleError, NotFoundError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  FeeInvoiceEntity,
  FeeLedgerEntryEntity,
  FeePaymentEntity,
  FeePlanEntity,
  FeeReceiptEntity,
  FeesRepository,
  LedgerAccount,
  PaymentMethod,
} from './fees-repository.js';
import {
  allocateByShares,
  allocateInstalments,
  assertRefundWithinPaid,
  concessionDiscountCents,
} from './instalment-schedule.js';
import { SandboxPaymentAdapter, type PaymentAdapter } from './payment-adapter.js';
import {
  FEES_REMINDER_SANDBOX_HONESTY_NOTE,
  type ReminderChannel,
  type ReminderSendAuditEntity,
  type ReminderSuppressionEntity,
  type SendReminderResultRow,
} from './reminder-sandbox.js';

export type { ReminderChannel, ReminderSendAuditEntity, ReminderSuppressionEntity };
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
}

export interface ApplyConcessionInput {
  studentId: string;
  structureId: string;
  invoiceId?: string;
  kind: 'percent' | 'amount';
  percent?: number;
  amountCents?: number;
  reason: string;
  approverId?: string;
}

export interface RecordRefundInput {
  invoiceId: string;
  paymentId?: string;
  amountCents: number;
  reason: string;
}

export interface ReconciliationCsvRow {
  invoiceNumber: string;
  amountCents: number;
}

function receiptNumberFor(paymentId: string): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `RCP-${stamp}-${paymentId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function invoiceNumberFor(invoiceId: string): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `INV-${stamp}-${invoiceId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export function parseReconciliationCsv(csv: string): ReconciliationCsvRow[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const start = /invoice/i.test(lines[0]!) ? 1 : 0;
  const rows: ReconciliationCsvRow[] = [];
  for (const line of lines.slice(start)) {
    const [invoiceNumber, amountRaw] = line.split(',').map((part) => part.trim());
    if (!invoiceNumber) continue;
    const amountCents = Number(amountRaw);
    if (!Number.isFinite(amountCents)) {
      rows.push({ invoiceNumber, amountCents: Number.NaN });
      continue;
    }
    rows.push({ invoiceNumber, amountCents: Math.round(amountCents) });
  }
  return rows;
}

export class FeesService {
  private readonly paymentAdapter: PaymentAdapter;
  /** F2 — process-local suppressions (sandbox console; not durable SQL). */
  private readonly reminderSuppressions: ReminderSuppressionEntity[] = [];
  /** F2 — process-local send audit trail (sandbox honesty). */
  private readonly reminderSendAudits: ReminderSendAuditEntity[] = [];

  constructor(
    private readonly repository: FeesRepository,
    paymentAdapter?: PaymentAdapter,
  ) {
    this.paymentAdapter = paymentAdapter ?? new SandboxPaymentAdapter();
  }

  async createFeePlan(tenantId: string, actorId: string, input: CreateFeePlanInput) {
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
    if (amountCents == null || amountCents < 0) {
      throw new BusinessRuleError('Invoice amountCents is required');
    }

    const invoiceId = uuidv4();
    const invoice = await this.repository.createInvoice({
      id: invoiceId,
      tenantId,
      studentId: input.studentId,
      planId,
      title,
      description,
      amountCents,
      currency,
      status: 'open',
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      createdBy: actorId,
      invoiceNumber: invoiceNumberFor(invoiceId),
      structureId: null,
      classId: null,
      gradeId: null,
    });

    // G-718: DR accounts_receivable / CR fee_revenue
    if (amountCents > 0) {
      await this.postJournal(invoice, actorId, 'invoice issued', [
        ['accounts_receivable', 'debit'],
        ['fee_revenue', 'credit'],
      ]);
    }
    return invoice;
  }

  /**
   * Post one balanced journal for an invoice-scoped financial event (G-718).
   * Both legs carry the same amount so the journal is balanced by construction;
   * the repository still rejects unbalanced journals defensively.
   */
  private async postJournal(
    invoice: FeeInvoiceEntity,
    actorId: string | null,
    memo: string,
    legs: ReadonlyArray<readonly [LedgerAccount, 'debit' | 'credit']>,
    refs: { paymentId?: string; receiptId?: string } = {},
  ): Promise<FeeLedgerEntryEntity[]> {
    const journalId = uuidv4();
    const postedAt = new Date();
    return this.repository.postLedgerEntries(
      legs.map(([account, side]) => ({
        id: uuidv4(),
        tenantId: invoice.tenantId,
        journalId,
        invoiceId: invoice.id,
        paymentId: refs.paymentId ?? null,
        receiptId: refs.receiptId ?? null,
        account,
        side,
        amountCents: invoice.amountCents,
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

  async voidInvoice(tenantId: string, invoiceId: string) {
    const invoice = await this.getInvoice(tenantId, invoiceId);
    if (invoice.status === 'paid') {
      throw new BusinessRuleError('Cannot void a paid invoice');
    }
    if (invoice.status === 'void') {
      return invoice;
    }
    const updated = await this.repository.updateInvoice(invoiceId, tenantId, { status: 'void' });
    // G-718: reverse the issuance — DR fee_revenue / CR accounts_receivable
    if (invoice.amountCents > 0) {
      await this.postJournal(invoice, null, 'invoice voided', [
        ['fee_revenue', 'debit'],
        ['accounts_receivable', 'credit'],
      ]);
    }
    return updated!;
  }

  async listPayments(tenantId: string) {
    return this.repository.listPaymentsForTenant(tenantId);
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
   * Charge via payment adapter, persist payment + receipt, mark invoice paid.
   * Enforces: receipt.amountCents === payment.amountCents === invoice.amountCents.
   */
  async recordPayment(
    tenantId: string,
    actorId: string,
    input: RecordPaymentInput,
  ): Promise<{
    invoice: FeeInvoiceEntity;
    payment: FeePaymentEntity;
    receipt: FeeReceiptEntity;
  }> {
    const invoice = await this.getInvoice(tenantId, input.invoiceId);

    if (invoice.status !== 'open') {
      throw new BusinessRuleError('Invoice is not open for payment');
    }

    if (input.amountCents != null && input.amountCents !== invoice.amountCents) {
      throw new BusinessRuleError('Payment amountCents must equal invoice.amountCents');
    }

    const charge = await this.paymentAdapter.charge({
      tenantId,
      invoiceId: invoice.id,
      payerUserId: input.payerUserId ?? actorId,
      amountCents: invoice.amountCents,
      currency: invoice.currency,
      method: input.method ?? 'sandbox',
    });

    if (charge.status !== 'succeeded') {
      throw new BusinessRuleError(`Payment charge failed with status '${charge.status}'`);
    }

    if (charge.amountCents !== invoice.amountCents) {
      throw new BusinessRuleError('Charge amountCents must equal invoice.amountCents');
    }

    const paidAt = new Date();
    const payment = await this.repository.createPayment({
      id: uuidv4(),
      invoiceId: invoice.id,
      tenantId,
      payerUserId: input.payerUserId ?? actorId,
      amountCents: invoice.amountCents,
      method: charge.method,
      status: 'succeeded',
      paidAt,
    });

    if (payment.amountCents !== invoice.amountCents) {
      throw new BusinessRuleError('payment.amountCents must equal invoice.amountCents');
    }

    const receipt = await this.repository.createReceipt({
      id: uuidv4(),
      tenantId,
      paymentId: payment.id,
      invoiceId: invoice.id,
      receiptNumber: receiptNumberFor(payment.id),
      amountCents: invoice.amountCents,
      currency: invoice.currency,
      issuedAt: paidAt,
    });

    if (
      receipt.amountCents !== payment.amountCents ||
      payment.amountCents !== invoice.amountCents ||
      receipt.amountCents !== invoice.amountCents
    ) {
      throw new BusinessRuleError(
        'receipt.amountCents === payment.amountCents === invoice.amountCents invariant violated',
      );
    }

    // G-718: DR cash / CR accounts_receivable — the receivable opened at
    // issuance is cleared by exactly the invoice amount.
    await this.postJournal(
      invoice,
      actorId,
      'payment received',
      [
        ['cash', 'debit'],
        ['accounts_receivable', 'credit'],
      ],
      { paymentId: payment.id, receiptId: receipt.id },
    );

    const updatedInvoice = await this.repository.updateInvoice(invoice.id, tenantId, {
      status: 'paid',
    });

    return { invoice: updatedInvoice!, payment, receipt };
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
    return this.repository.createFeeStructure({
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
      createdBy: actorId,
    });
  }

  async listFeeStructures(tenantId: string) {
    return this.repository.listFeeStructures(tenantId);
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
    return this.repository.replaceStructureInstalments(tenantId, structure.id, rows);
  }

  async listInstalments(tenantId: string, structureId: string) {
    await this.getFeeStructure(tenantId, structureId);
    return this.repository.listStructureInstalments(tenantId, structureId);
  }

  async bulkInvoiceClass(tenantId: string, actorId: string, input: BulkInvoiceInput) {
    const structure = await this.getFeeStructure(tenantId, input.structureId);
    if (structure.status !== 'active') {
      throw new NotFoundError(`Fee structure with id '${input.structureId}' not found`);
    }
    const classId = input.classId ?? structure.classId;
    const gradeId = input.gradeId ?? structure.gradeId;
    const fromInput = (input.studentIds ?? []).filter((id) => id.length > 0);
    const roster =
      fromInput.length > 0
        ? fromInput
        : await this.repository.listStudentIdsForScope(tenantId, { classId, gradeId });
    const unique = [...new Set(roster)];
    if (unique.length === 0) {
      throw new BusinessRuleError('No students found to invoice for this class/grade');
    }

    const created: FeeInvoiceEntity[] = [];
    const skipped: string[] = [];
    for (const studentId of unique) {
      const existing = await this.repository.findInvoiceForStructureStudent(
        tenantId,
        structure.id,
        studentId,
      );
      if (existing) {
        skipped.push(studentId);
        continue;
      }
      const concession = await this.repository.findConcessionForStudentStructure(
        tenantId,
        studentId,
        structure.id,
      );
      const discount =
        concession && concession.status === 'approved'
          ? concessionDiscountCents(structure.amountCents, concession)
          : 0;
      const amountCents = Math.max(0, structure.amountCents - discount);
      const invoiceId = uuidv4();
      const invoice = await this.repository.createInvoice({
        id: invoiceId,
        tenantId,
        studentId,
        planId: null,
        title: structure.name,
        description: structure.category,
        amountCents,
        currency: structure.currency,
        status: 'open',
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        createdBy: actorId,
        invoiceNumber: invoiceNumberFor(invoiceId),
        structureId: structure.id,
        classId: classId ?? null,
        gradeId: gradeId ?? null,
      });
      if (amountCents > 0) {
        await this.postJournal(invoice, actorId, 'invoice issued', [
          ['accounts_receivable', 'debit'],
          ['fee_revenue', 'credit'],
        ]);
      }
      if (concession) {
        await this.repository.updateConcession(concession.id, tenantId, { invoiceId: invoice.id });
      }
      created.push(invoice);
    }
    return { created, skipped, structureId: structure.id };
  }

  async applyConcession(tenantId: string, actorId: string, input: ApplyConcessionInput) {
    const structure = await this.getFeeStructure(tenantId, input.structureId);
    const discount = concessionDiscountCents(structure.amountCents, input);
    const existing = await this.repository.findConcessionForStudentStructure(
      tenantId,
      input.studentId,
      input.structureId,
    );
    if (existing) {
      throw new BusinessRuleError('A concession already exists for this student and structure');
    }
    const concession = await this.repository.createConcession({
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      structureId: input.structureId,
      invoiceId: input.invoiceId ?? null,
      kind: input.kind,
      percent: input.kind === 'percent' ? (input.percent ?? 0) : null,
      amountCents: input.kind === 'amount' ? (input.amountCents ?? 0) : null,
      reason: input.reason,
      approverId: input.approverId ?? actorId,
      status: 'approved',
      createdBy: actorId,
    });

    const invoice = input.invoiceId
      ? await this.getInvoice(tenantId, input.invoiceId)
      : await this.repository.findInvoiceForStructureStudent(
          tenantId,
          input.structureId,
          input.studentId,
        );
    if (!invoice) {
      return { concession, invoice: null, discountCents: discount };
    }
    if (invoice.status !== 'open') {
      throw new BusinessRuleError('Concession can only recompute dues on an open invoice');
    }
    const nextAmount = Math.max(0, invoice.amountCents - discount);
    if (discount > 0 && invoice.amountCents > 0) {
      const adjustment = {
        ...invoice,
        amountCents: discount,
      };
      await this.postJournal(adjustment, actorId, 'concession applied', [
        ['fee_revenue', 'debit'],
        ['accounts_receivable', 'credit'],
      ]);
    }
    const updated = await this.repository.updateInvoice(invoice.id, tenantId, {
      amountCents: nextAmount,
    });
    await this.repository.updateConcession(concession.id, tenantId, { invoiceId: invoice.id });
    return { concession, invoice: updated, discountCents: discount };
  }

  async recordRefund(tenantId: string, actorId: string, input: RecordRefundInput) {
    const invoice = await this.getInvoice(tenantId, input.invoiceId);
    const payments = (await this.repository.listPaymentsForTenant(tenantId)).filter(
      (p) => p.invoiceId === invoice.id && p.status === 'succeeded',
    );
    const paidCents = payments.reduce((sum, p) => sum + p.amountCents, 0);
    const refunds = await this.repository.listRefundsForInvoice(tenantId, invoice.id);
    const alreadyRefunded = refunds
      .filter((r) => r.status === 'posted')
      .reduce((sum, r) => sum + r.amountCents, 0);
    assertRefundWithinPaid(paidCents, alreadyRefunded, input.amountCents);

    const refund = await this.repository.createRefund({
      id: uuidv4(),
      tenantId,
      invoiceId: invoice.id,
      paymentId: input.paymentId ?? payments[0]?.id ?? null,
      amountCents: input.amountCents,
      reason: input.reason,
      status: 'posted',
      createdBy: actorId,
    });
    const refundInvoice = { ...invoice, amountCents: input.amountCents };
    await this.postJournal(refundInvoice, actorId, 'refund posted', [
      ['fee_revenue', 'debit'],
      ['cash', 'credit'],
    ]);
    return refund;
  }

  private isReminderSuppressed(tenantId: string, studentId: string, invoiceId: string): boolean {
    return this.reminderSuppressions.some(
      (row) =>
        row.tenantId === tenantId &&
        ((row.invoiceId != null && row.invoiceId === invoiceId) ||
          (row.studentId != null && row.studentId === studentId)),
    );
  }

  async listOverdueForReminder(tenantId: string, asOf: Date) {
    const invoices = await this.repository.listInvoicesForTenant(tenantId);
    return invoices
      .filter(
        (invoice) => invoice.status === 'open' && invoice.dueAt != null && invoice.dueAt < asOf,
      )
      .map((invoice) => ({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        studentId: invoice.studentId,
        classId: invoice.classId,
        amountCents: invoice.amountCents,
        currency: invoice.currency,
        dueAt: invoice.dueAt!.toISOString(),
        overdueDays: Math.max(
          1,
          Math.floor((asOf.getTime() - invoice.dueAt!.getTime()) / 86_400_000),
        ),
        suppressed: this.isReminderSuppressed(tenantId, invoice.studentId, invoice.id),
      }));
  }

  async listReminderSuppressions(tenantId: string): Promise<ReminderSuppressionEntity[]> {
    return this.reminderSuppressions
      .filter((row) => row.tenantId === tenantId)
      .map((row) => ({ ...row }));
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
    this.reminderSuppressions.push(entity);
    return { ...entity };
  }

  async removeReminderSuppression(tenantId: string, suppressionId: string): Promise<void> {
    const index = this.reminderSuppressions.findIndex(
      (row) => row.tenantId === tenantId && row.id === suppressionId,
    );
    if (index < 0) {
      throw new NotFoundError(`Reminder suppression ${suppressionId} not found`);
    }
    this.reminderSuppressions.splice(index, 1);
  }

  async listReminderSendAudits(tenantId: string): Promise<ReminderSendAuditEntity[]> {
    return this.reminderSendAudits
      .filter((row) => row.tenantId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((row) => ({ ...row }));
  }

  async sendReminders(
    tenantId: string,
    actorId: string,
    input: SendRemindersInput,
    asOf: Date = new Date(),
  ): Promise<{
    mode: 'sandbox';
    honestyNote: string;
    results: SendReminderResultRow[];
  }> {
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
        if (cadenceDays > 0) {
          const cutoff = asOf.getTime() - cadenceDays * 86_400_000;
          const recent = this.reminderSendAudits.some(
            (audit) =>
              audit.tenantId === tenantId &&
              audit.invoiceId === invoiceId &&
              audit.channel === channel &&
              audit.createdAt.getTime() >= cutoff,
          );
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

        const messageId = `sandbox-${channel}:fees:${tenantId}:${invoiceId}:${Date.now()}`;
        const audit: ReminderSendAuditEntity = {
          id: uuidv4(),
          tenantId,
          invoiceId,
          studentId: row.studentId,
          channel,
          messageId,
          mode: 'sandbox',
          honestyNote: FEES_REMINDER_SANDBOX_HONESTY_NOTE,
          actorId,
          createdAt: new Date(),
        };
        this.reminderSendAudits.push(audit);
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
      mode: 'sandbox',
      honestyNote: FEES_REMINDER_SANDBOX_HONESTY_NOTE,
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

    for (const invoice of invoices) {
      const statusRow = byStatus.get(invoice.status) ?? {
        status: invoice.status,
        count: 0,
        amountCents: 0,
      };
      statusRow.count += 1;
      statusRow.amountCents += invoice.amountCents;
      byStatus.set(invoice.status, statusRow);

      if (invoice.status !== 'open') continue;
      const classKey = invoice.classId ?? 'unassigned';
      const classRow = byClass.get(classKey) ?? {
        classId: classKey,
        openCount: 0,
        overdueCount: 0,
        openCents: 0,
        overdueCents: 0,
      };
      classRow.openCount += 1;
      classRow.openCents += invoice.amountCents;
      if (invoice.dueAt && invoice.dueAt < asOf) {
        const overdueDays = Math.max(
          1,
          Math.floor((asOf.getTime() - invoice.dueAt.getTime()) / 86_400_000),
        );
        classRow.overdueCount += 1;
        classRow.overdueCents += invoice.amountCents;
        overdue.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          studentId: invoice.studentId,
          classId: invoice.classId,
          amountCents: invoice.amountCents,
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

  async importReconciliationCsv(
    tenantId: string,
    actorId: string,
    csv: string,
    filename = 'import.csv',
  ) {
    const parsed = parseReconciliationCsv(csv);
    const matched: Array<{ invoiceNumber: string; amountCents: number; invoiceId: string }> = [];
    const unmatched: Array<{ invoiceNumber: string; amountCents: number; note: string }> = [];

    for (const row of parsed) {
      if (!Number.isFinite(row.amountCents)) {
        unmatched.push({
          invoiceNumber: row.invoiceNumber,
          amountCents: 0,
          note: 'invalid amount',
        });
        continue;
      }
      const invoice = await this.repository.findInvoiceByNumber(tenantId, row.invoiceNumber);
      if (!invoice) {
        unmatched.push({
          invoiceNumber: row.invoiceNumber,
          amountCents: row.amountCents,
          note: 'invoice not found',
        });
        continue;
      }
      if (invoice.amountCents !== row.amountCents) {
        unmatched.push({
          invoiceNumber: row.invoiceNumber,
          amountCents: row.amountCents,
          note: `amount mismatch (invoice ${invoice.amountCents})`,
        });
        continue;
      }
      matched.push({
        invoiceNumber: row.invoiceNumber,
        amountCents: row.amountCents,
        invoiceId: invoice.id,
      });
    }

    const batch = await this.repository.createReconciliationBatch({
      id: uuidv4(),
      tenantId,
      filename,
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
      createdBy: actorId,
    });
    const rows = [
      ...matched.map((row) => ({
        id: uuidv4(),
        tenantId,
        batchId: batch.id,
        invoiceNumber: row.invoiceNumber,
        amountCents: row.amountCents,
        matched: true,
        invoiceId: row.invoiceId,
        note: null as string | null,
        exceptionStatus: 'none' as const,
        resolvedBy: null as string | null,
        resolvedAt: null as Date | null,
        resolutionNote: null as string | null,
      })),
      ...unmatched.map((row) => ({
        id: uuidv4(),
        tenantId,
        batchId: batch.id,
        invoiceNumber: row.invoiceNumber,
        amountCents: row.amountCents,
        matched: false,
        invoiceId: null as string | null,
        note: row.note,
        exceptionStatus: 'open' as const,
        resolvedBy: null as string | null,
        resolvedAt: null as Date | null,
        resolutionNote: null as string | null,
      })),
    ];
    await this.repository.createReconciliationRows(rows);
    return { batch, matched, unmatched };
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
    const idSet = new Set(invoiceIds);
    const receipts = await this.repository.listReceiptsForTenant(tenantId);
    return receipts.filter((receipt) => idSet.has(receipt.invoiceId));
  }

  /**
   * G-1 scholarship netting — credit an open fee invoice from a paid disbursement.
   * Idempotent on `disbursementId` (reason marker).
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
  ) {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new BusinessRuleError('Scholarship netting amountCents must be a positive integer');
    }
    const marker = `scholarship_netting:${input.disbursementId}`;
    const prior = (await this.repository.listConcessions(tenantId)).find((c) =>
      c.reason.includes(marker),
    );
    if (prior) {
      const invoice = prior.invoiceId
        ? await this.repository.findInvoiceById(prior.invoiceId, tenantId)
        : null;
      return {
        concession: prior,
        invoice,
        discountCents: input.amountCents,
        idempotent: true as const,
      };
    }

    const invoices = await this.repository.listInvoicesForStudentIds(tenantId, [input.studentId]);
    const invoice =
      (input.invoiceId ? invoices.find((row) => row.id === input.invoiceId) : undefined) ??
      invoices.find((row) => row.status === 'open' || row.status === 'overdue') ??
      null;

    let structureId = invoice?.structureId ?? null;
    if (!structureId) {
      const existing = (await this.repository.listFeeStructures(tenantId)).find(
        (s) => s.code === 'SCHOLARSHIP_NET',
      );
      const structure =
        existing ??
        (await this.createFeeStructure(tenantId, actorId, {
          code: 'SCHOLARSHIP_NET',
          name: 'Scholarship netting',
          category: 'scholarship',
          amountCents: 0,
          currency: input.currency ?? invoice?.currency ?? 'INR',
        }));
      structureId = structure.id;
    }

    if (!invoice) {
      const concession = await this.applyConcession(tenantId, actorId, {
        studentId: input.studentId,
        structureId,
        kind: 'amount',
        amountCents: input.amountCents,
        reason: `${marker} (no open invoice — credit reserved)`,
      });
      return { ...concession, idempotent: false as const };
    }

    return {
      ...(await this.applyConcession(tenantId, actorId, {
        studentId: input.studentId,
        structureId,
        invoiceId: invoice.id,
        kind: 'amount',
        amountCents: Math.min(input.amountCents, invoice.amountCents),
        reason: marker,
      })),
      idempotent: false as const,
    };
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
