/**
 * Fees / finance repository interfaces (plans, invoices, payments, receipts).
 * Tables: parent_fee_* from db/sql/010 + 011.
 */

export type InvoiceStatus = 'open' | 'paid' | 'void' | 'overdue';
export type PaymentMethod = 'sandbox' | 'upi' | 'card' | 'cash';
export type PaymentStatus = 'pending' | 'succeeded' | 'failed';
export type FeePlanFrequency = 'once' | 'term' | 'month' | 'year';
export type FeePlanStatus = 'active' | 'archived';

export interface FeePlanEntity {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string;
  amountCents: number;
  currency: string;
  frequency: FeePlanFrequency;
  status: FeePlanStatus;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeeInvoiceEntity {
  id: string;
  tenantId: string;
  studentId: string;
  planId: string | null;
  title: string;
  description: string;
  amountCents: number;
  currency: string;
  status: InvoiceStatus;
  dueAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  invoiceNumber: string | null;
  structureId: string | null;
  classId: string | null;
  gradeId: string | null;
}

export interface FeePaymentEntity {
  id: string;
  invoiceId: string;
  tenantId: string;
  payerUserId: string;
  amountCents: number;
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt: Date;
  createdAt: Date;
}

export interface FeeReceiptEntity {
  id: string;
  tenantId: string;
  paymentId: string;
  invoiceId: string;
  receiptNumber: string;
  amountCents: number;
  currency: string;
  issuedAt: Date;
  createdAt: Date;
}

// ─── Double-entry ledger (G-718) ─────────────────────────────────────────────

export type LedgerAccount = 'accounts_receivable' | 'cash' | 'fee_revenue';
export type LedgerSide = 'debit' | 'credit';

export interface FeeLedgerEntryEntity {
  id: string;
  tenantId: string;
  /** Groups the balanced legs of one financial event. */
  journalId: string;
  invoiceId: string;
  paymentId: string | null;
  receiptId: string | null;
  account: LedgerAccount;
  side: LedgerSide;
  amountCents: number;
  currency: string;
  memo: string | null;
  postedBy: string | null;
  postedAt: Date;
  createdAt: Date;
}

export interface LedgerTrialBalance {
  tenantId: string;
  debitCents: number;
  creditCents: number;
  /** Per-account net (debit − credit). */
  accounts: Record<LedgerAccount, number>;
}

/** Thrown when a journal's debits and credits do not balance. */
export class UnbalancedJournalError extends Error {
  constructor(journalId: string, debitCents: number, creditCents: number) {
    super(
      `Fee ledger journal ${journalId} is unbalanced (debit ${debitCents} <> credit ${creditCents})`,
    );
    this.name = 'UnbalancedJournalError';
  }
}

export function assertJournalBalanced(
  entries: ReadonlyArray<Pick<FeeLedgerEntryEntity, 'journalId' | 'side' | 'amountCents'>>,
): void {
  const byJournal = new Map<string, { debit: number; credit: number }>();
  for (const e of entries) {
    const acc = byJournal.get(e.journalId) ?? { debit: 0, credit: 0 };
    if (e.amountCents <= 0) throw new Error('Ledger amountCents must be > 0');
    acc[e.side] += e.amountCents;
    byJournal.set(e.journalId, acc);
  }
  for (const [journalId, { debit, credit }] of byJournal) {
    if (debit !== credit) throw new UnbalancedJournalError(journalId, debit, credit);
  }
}

export type FeeStructureStatus = 'active' | 'archived';
export type ConcessionKind = 'percent' | 'amount';
export type ConcessionStatus = 'pending' | 'approved' | 'rejected';
export type RefundStatus = 'pending' | 'posted' | 'rejected';

export interface FeeStructureEntity {
  id: string;
  tenantId: string;
  institutionId: string | null;
  academicPeriodId: string | null;
  gradeId: string | null;
  classId: string | null;
  category: string;
  term: string | null;
  code: string;
  name: string;
  amountCents: number;
  currency: string;
  status: FeeStructureStatus;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeeStructureComponentEntity {
  id: string;
  tenantId: string;
  structureId: string;
  name: string;
  amountCents: number;
  createdAt: Date;
}

export interface FeeStructureInstalmentEntity {
  id: string;
  tenantId: string;
  structureId: string;
  sequence: number;
  amountCents: number;
  dueOffsetDays: number;
  label: string;
  createdAt: Date;
}

export interface FeeConcessionEntity {
  id: string;
  tenantId: string;
  studentId: string;
  structureId: string;
  invoiceId: string | null;
  kind: ConcessionKind;
  percent: number | null;
  amountCents: number | null;
  reason: string;
  approverId: string | null;
  status: ConcessionStatus;
  createdBy: string | null;
  createdAt: Date;
}

export interface FeeRefundEntity {
  id: string;
  tenantId: string;
  invoiceId: string;
  paymentId: string | null;
  amountCents: number;
  reason: string;
  status: RefundStatus;
  createdBy: string | null;
  createdAt: Date;
}

export interface FeeReconciliationBatchEntity {
  id: string;
  tenantId: string;
  filename: string;
  matchedCount: number;
  unmatchedCount: number;
  createdBy: string | null;
  createdAt: Date;
}

export interface FeeReconciliationRowEntity {
  id: string;
  tenantId: string;
  batchId: string;
  invoiceNumber: string;
  amountCents: number;
  matched: boolean;
  invoiceId: string | null;
  note: string | null;
  createdAt: Date;
}

export interface FeesRepository {
  /**
   * Post one or more balanced journals atomically. Implementations MUST
   * reject unbalanced journals (in-memory: {@link assertJournalBalanced};
   * Postgres: deferred constraint trigger at COMMIT).
   */
  postLedgerEntries(
    entries: Omit<FeeLedgerEntryEntity, 'createdAt'>[],
  ): Promise<FeeLedgerEntryEntity[]>;
  listLedgerForInvoice(tenantId: string, invoiceId: string): Promise<FeeLedgerEntryEntity[]>;
  trialBalance(tenantId: string): Promise<LedgerTrialBalance>;

  createFeePlan(data: Omit<FeePlanEntity, 'createdAt' | 'updatedAt'>): Promise<FeePlanEntity>;
  listFeePlans(tenantId: string): Promise<FeePlanEntity[]>;
  findFeePlanById(id: string, tenantId: string): Promise<FeePlanEntity | null>;

  createInvoice(data: Omit<FeeInvoiceEntity, 'createdAt' | 'updatedAt'>): Promise<FeeInvoiceEntity>;
  listInvoicesForTenant(tenantId: string): Promise<FeeInvoiceEntity[]>;
  listInvoicesForStudentIds(tenantId: string, studentIds: string[]): Promise<FeeInvoiceEntity[]>;
  findInvoiceById(id: string, tenantId: string): Promise<FeeInvoiceEntity | null>;
  findInvoiceByNumber(tenantId: string, invoiceNumber: string): Promise<FeeInvoiceEntity | null>;
  findInvoiceForStructureStudent(
    tenantId: string,
    structureId: string,
    studentId: string,
  ): Promise<FeeInvoiceEntity | null>;
  updateInvoice(
    id: string,
    tenantId: string,
    data: Partial<Pick<FeeInvoiceEntity, 'status' | 'amountCents'>>,
  ): Promise<FeeInvoiceEntity | null>;
  listStudentIdsForScope(
    tenantId: string,
    scope: { classId?: string | null; gradeId?: string | null },
  ): Promise<string[]>;

  createFeeStructure(
    data: Omit<FeeStructureEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<FeeStructureEntity>;
  listFeeStructures(tenantId: string): Promise<FeeStructureEntity[]>;
  findFeeStructureById(id: string, tenantId: string): Promise<FeeStructureEntity | null>;
  replaceStructureInstalments(
    tenantId: string,
    structureId: string,
    rows: Omit<FeeStructureInstalmentEntity, 'createdAt'>[],
  ): Promise<FeeStructureInstalmentEntity[]>;
  listStructureInstalments(
    tenantId: string,
    structureId: string,
  ): Promise<FeeStructureInstalmentEntity[]>;
  replaceStructureComponents(
    tenantId: string,
    structureId: string,
    rows: Omit<FeeStructureComponentEntity, 'createdAt'>[],
  ): Promise<FeeStructureComponentEntity[]>;
  listStructureComponents(
    tenantId: string,
    structureId: string,
  ): Promise<FeeStructureComponentEntity[]>;

  createConcession(data: Omit<FeeConcessionEntity, 'createdAt'>): Promise<FeeConcessionEntity>;
  findConcessionForStudentStructure(
    tenantId: string,
    studentId: string,
    structureId: string,
  ): Promise<FeeConcessionEntity | null>;
  listConcessions(tenantId: string): Promise<FeeConcessionEntity[]>;
  updateConcession(
    id: string,
    tenantId: string,
    data: Partial<Pick<FeeConcessionEntity, 'invoiceId' | 'status'>>,
  ): Promise<FeeConcessionEntity | null>;

  createRefund(data: Omit<FeeRefundEntity, 'createdAt'>): Promise<FeeRefundEntity>;
  listRefundsForInvoice(tenantId: string, invoiceId: string): Promise<FeeRefundEntity[]>;
  listRefundsForTenant(tenantId: string): Promise<FeeRefundEntity[]>;

  createReconciliationBatch(
    data: Omit<FeeReconciliationBatchEntity, 'createdAt'>,
  ): Promise<FeeReconciliationBatchEntity>;
  createReconciliationRows(
    rows: Omit<FeeReconciliationRowEntity, 'createdAt'>[],
  ): Promise<FeeReconciliationRowEntity[]>;
  listReconciliationBatches(tenantId: string): Promise<FeeReconciliationBatchEntity[]>;
  listReconciliationRows(
    tenantId: string,
    batchId: string,
  ): Promise<FeeReconciliationRowEntity[]>;

  createPayment(data: Omit<FeePaymentEntity, 'createdAt'>): Promise<FeePaymentEntity>;
  listPaymentsForTenant(tenantId: string): Promise<FeePaymentEntity[]>;
  findPaymentById(id: string, tenantId: string): Promise<FeePaymentEntity | null>;

  createReceipt(data: Omit<FeeReceiptEntity, 'createdAt'>): Promise<FeeReceiptEntity>;
  listReceiptsForTenant(tenantId: string): Promise<FeeReceiptEntity[]>;
  findReceiptById(id: string, tenantId: string): Promise<FeeReceiptEntity | null>;
}
