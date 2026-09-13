/**
 * In-memory fees repository (unit tests / gateway without DATABASE_URL).
 */
import {
  assertJournalBalanced,
  type FeeConcessionEntity,
  type FeeInvoiceEntity,
  type FeeLedgerEntryEntity,
  type FeePaymentEntity,
  type FeePlanEntity,
  type FeeReceiptEntity,
  type FeeReconciliationBatchEntity,
  type FeeReconciliationRowEntity,
  type FeeRefundEntity,
  type FeeStructureComponentEntity,
  type FeeStructureEntity,
  type FeeStructureInstalmentEntity,
  type FeesRepository,
  type LedgerAccount,
  type LedgerTrialBalance,
} from './fees-repository.js';
import type { ReminderSendAuditEntity, ReminderSuppressionEntity } from './reminder-sandbox.js';

export class InMemoryFeesRepository implements FeesRepository {
  private readonly reminderSuppressions: ReminderSuppressionEntity[] = [];
  private readonly reminderSendAudits: ReminderSendAuditEntity[] = [];
  private plans: FeePlanEntity[] = [];
  private invoices: FeeInvoiceEntity[] = [];
  private payments: FeePaymentEntity[] = [];
  private receipts: FeeReceiptEntity[] = [];
  private ledger: FeeLedgerEntryEntity[] = [];
  private structures: FeeStructureEntity[] = [];
  private components: FeeStructureComponentEntity[] = [];
  private instalments: FeeStructureInstalmentEntity[] = [];
  private concessions: FeeConcessionEntity[] = [];
  private refunds: FeeRefundEntity[] = [];
  private reconBatches: FeeReconciliationBatchEntity[] = [];
  private reconRows: FeeReconciliationRowEntity[] = [];
  private classRoster = new Map<string, string[]>();

  /** Test helper — students billed when bulk-invoicing a class/grade. */
  seedClassRoster(
    tenantId: string,
    scope: { classId?: string | null; gradeId?: string | null },
    studentIds: string[],
  ): void {
    this.classRoster.set(`${tenantId}:${scope.classId ?? ''}:${scope.gradeId ?? ''}`, [
      ...studentIds,
    ]);
  }

  // ─── Double-entry ledger (G-718) ──────────────────────────────────────────

  async postLedgerEntries(
    entries: Omit<FeeLedgerEntryEntity, 'createdAt'>[],
  ): Promise<FeeLedgerEntryEntity[]> {
    assertJournalBalanced(entries);
    const now = new Date();
    const rows = entries.map((e) => ({ ...e, createdAt: now }));
    this.ledger.push(...rows);
    return rows.map((r) => ({ ...r }));
  }

  async listLedgerForInvoice(tenantId: string, invoiceId: string): Promise<FeeLedgerEntryEntity[]> {
    return this.ledger
      .filter((e) => e.tenantId === tenantId && e.invoiceId === invoiceId)
      .sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
  }

  async trialBalance(tenantId: string): Promise<LedgerTrialBalance> {
    const accounts: Record<LedgerAccount, number> = {
      accounts_receivable: 0,
      cash: 0,
      fee_revenue: 0,
    };
    let debitCents = 0;
    let creditCents = 0;
    for (const e of this.ledger) {
      if (e.tenantId !== tenantId) continue;
      if (e.side === 'debit') {
        debitCents += e.amountCents;
        accounts[e.account] += e.amountCents;
      } else {
        creditCents += e.amountCents;
        accounts[e.account] -= e.amountCents;
      }
    }
    return { tenantId, debitCents, creditCents, accounts };
  }

  async createFeePlan(
    data: Omit<FeePlanEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<FeePlanEntity> {
    const now = new Date();
    const entity: FeePlanEntity = { ...data, createdAt: now, updatedAt: now };
    this.plans.push(entity);
    return entity;
  }

  async listFeePlans(tenantId: string): Promise<FeePlanEntity[]> {
    return this.plans.filter((plan) => plan.tenantId === tenantId);
  }

  async findFeePlanById(id: string, tenantId: string): Promise<FeePlanEntity | null> {
    return this.plans.find((plan) => plan.id === id && plan.tenantId === tenantId) ?? null;
  }

  async createInvoice(
    data: Omit<FeeInvoiceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<FeeInvoiceEntity> {
    const now = new Date();
    const entity: FeeInvoiceEntity = {
      ...data,
      invoiceNumber: data.invoiceNumber ?? null,
      structureId: data.structureId ?? null,
      classId: data.classId ?? null,
      gradeId: data.gradeId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.invoices.push(entity);
    return entity;
  }

  async listInvoicesForTenant(tenantId: string): Promise<FeeInvoiceEntity[]> {
    return this.invoices.filter((invoice) => invoice.tenantId === tenantId);
  }

  async listInvoicesForStudentIds(
    tenantId: string,
    studentIds: string[],
  ): Promise<FeeInvoiceEntity[]> {
    if (studentIds.length === 0) return [];
    const idSet = new Set(studentIds);
    return this.invoices.filter(
      (invoice) => invoice.tenantId === tenantId && idSet.has(invoice.studentId),
    );
  }

  async findInvoiceById(id: string, tenantId: string): Promise<FeeInvoiceEntity | null> {
    return (
      this.invoices.find((invoice) => invoice.id === id && invoice.tenantId === tenantId) ?? null
    );
  }

  async findInvoiceByNumber(
    tenantId: string,
    invoiceNumber: string,
  ): Promise<FeeInvoiceEntity | null> {
    return (
      this.invoices.find(
        (invoice) => invoice.tenantId === tenantId && invoice.invoiceNumber === invoiceNumber,
      ) ?? null
    );
  }

  async findInvoiceForStructureStudent(
    tenantId: string,
    structureId: string,
    studentId: string,
  ): Promise<FeeInvoiceEntity | null> {
    return (
      this.invoices.find(
        (invoice) =>
          invoice.tenantId === tenantId &&
          invoice.structureId === structureId &&
          invoice.studentId === studentId &&
          invoice.status !== 'void',
      ) ?? null
    );
  }

  async updateInvoice(
    id: string,
    tenantId: string,
    data: Partial<Pick<FeeInvoiceEntity, 'status' | 'amountCents'>>,
  ): Promise<FeeInvoiceEntity | null> {
    const index = this.invoices.findIndex(
      (invoice) => invoice.id === id && invoice.tenantId === tenantId,
    );
    if (index === -1) return null;
    const updated: FeeInvoiceEntity = {
      ...this.invoices[index]!,
      ...data,
      updatedAt: new Date(),
    };
    this.invoices[index] = updated;
    return updated;
  }

  async listStudentIdsForScope(
    tenantId: string,
    scope: { classId?: string | null; gradeId?: string | null },
  ): Promise<string[]> {
    return this.classRoster.get(`${tenantId}:${scope.classId ?? ''}:${scope.gradeId ?? ''}`) ?? [];
  }

  async createFeeStructure(
    data: Omit<FeeStructureEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<FeeStructureEntity> {
    const now = new Date();
    const entity: FeeStructureEntity = { ...data, createdAt: now, updatedAt: now };
    this.structures.push(entity);
    return entity;
  }

  async listFeeStructures(tenantId: string): Promise<FeeStructureEntity[]> {
    return this.structures.filter((row) => row.tenantId === tenantId);
  }

  async findFeeStructureById(id: string, tenantId: string): Promise<FeeStructureEntity | null> {
    return this.structures.find((row) => row.id === id && row.tenantId === tenantId) ?? null;
  }

  async replaceStructureInstalments(
    tenantId: string,
    structureId: string,
    rows: Omit<FeeStructureInstalmentEntity, 'createdAt'>[],
  ): Promise<FeeStructureInstalmentEntity[]> {
    this.instalments = this.instalments.filter(
      (row) => !(row.tenantId === tenantId && row.structureId === structureId),
    );
    const now = new Date();
    const created = rows.map((row) => ({ ...row, createdAt: now }));
    this.instalments.push(...created);
    return created.map((row) => ({ ...row }));
  }

  async listStructureInstalments(
    tenantId: string,
    structureId: string,
  ): Promise<FeeStructureInstalmentEntity[]> {
    return this.instalments
      .filter((row) => row.tenantId === tenantId && row.structureId === structureId)
      .sort((a, b) => a.sequence - b.sequence);
  }

  async replaceStructureComponents(
    tenantId: string,
    structureId: string,
    rows: Omit<FeeStructureComponentEntity, 'createdAt'>[],
  ): Promise<FeeStructureComponentEntity[]> {
    this.components = this.components.filter(
      (row) => !(row.tenantId === tenantId && row.structureId === structureId),
    );
    const now = new Date();
    const created = rows.map((row) => ({ ...row, createdAt: now }));
    this.components.push(...created);
    return created.map((row) => ({ ...row }));
  }

  async listStructureComponents(
    tenantId: string,
    structureId: string,
  ): Promise<FeeStructureComponentEntity[]> {
    return this.components.filter(
      (row) => row.tenantId === tenantId && row.structureId === structureId,
    );
  }

  async createConcession(
    data: Omit<FeeConcessionEntity, 'createdAt'>,
  ): Promise<FeeConcessionEntity> {
    const entity: FeeConcessionEntity = { ...data, createdAt: new Date() };
    this.concessions.push(entity);
    return entity;
  }

  async findConcessionForStudentStructure(
    tenantId: string,
    studentId: string,
    structureId: string,
  ): Promise<FeeConcessionEntity | null> {
    return (
      this.concessions.find(
        (row) =>
          row.tenantId === tenantId &&
          row.studentId === studentId &&
          row.structureId === structureId &&
          row.status !== 'rejected',
      ) ?? null
    );
  }

  async listConcessions(tenantId: string): Promise<FeeConcessionEntity[]> {
    return this.concessions.filter((row) => row.tenantId === tenantId);
  }

  async findConcessionById(id: string, tenantId: string): Promise<FeeConcessionEntity | null> {
    return this.concessions.find((row) => row.id === id && row.tenantId === tenantId) ?? null;
  }

  async updateConcession(
    id: string,
    tenantId: string,
    data: Partial<Pick<FeeConcessionEntity, 'invoiceId' | 'status' | 'approverId'>>,
  ): Promise<FeeConcessionEntity | null> {
    const index = this.concessions.findIndex((row) => row.id === id && row.tenantId === tenantId);
    if (index === -1) return null;
    const updated = { ...this.concessions[index]!, ...data };
    this.concessions[index] = updated;
    return updated;
  }

  async createRefund(data: Omit<FeeRefundEntity, 'createdAt'>): Promise<FeeRefundEntity> {
    const entity: FeeRefundEntity = { ...data, createdAt: new Date() };
    this.refunds.push(entity);
    return entity;
  }

  async listRefundsForInvoice(tenantId: string, invoiceId: string): Promise<FeeRefundEntity[]> {
    return this.refunds.filter((row) => row.tenantId === tenantId && row.invoiceId === invoiceId);
  }

  async listRefundsForTenant(tenantId: string): Promise<FeeRefundEntity[]> {
    return this.refunds.filter((row) => row.tenantId === tenantId);
  }

  async createReconciliationBatch(
    data: Omit<FeeReconciliationBatchEntity, 'createdAt'>,
  ): Promise<FeeReconciliationBatchEntity> {
    const entity: FeeReconciliationBatchEntity = { ...data, createdAt: new Date() };
    this.reconBatches.push(entity);
    return entity;
  }

  async createReconciliationRows(
    rows: Omit<FeeReconciliationRowEntity, 'createdAt'>[],
  ): Promise<FeeReconciliationRowEntity[]> {
    const now = new Date();
    const created = rows.map((row) => ({ ...row, createdAt: now }));
    this.reconRows.push(...created);
    return created.map((row) => ({ ...row }));
  }

  async listReconciliationBatches(tenantId: string): Promise<FeeReconciliationBatchEntity[]> {
    return this.reconBatches
      .filter((row) => row.tenantId === tenantId)
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async listReconciliationRows(
    tenantId: string,
    batchId: string,
  ): Promise<FeeReconciliationRowEntity[]> {
    return this.reconRows.filter((row) => row.tenantId === tenantId && row.batchId === batchId);
  }

  async findReconciliationRowById(
    tenantId: string,
    rowId: string,
  ): Promise<FeeReconciliationRowEntity | null> {
    return this.reconRows.find((row) => row.tenantId === tenantId && row.id === rowId) ?? null;
  }

  async updateReconciliationRow(
    tenantId: string,
    rowId: string,
    data: Partial<
      Pick<
        FeeReconciliationRowEntity,
        'exceptionStatus' | 'resolvedBy' | 'resolvedAt' | 'resolutionNote' | 'note'
      >
    >,
  ): Promise<FeeReconciliationRowEntity | null> {
    const idx = this.reconRows.findIndex((row) => row.tenantId === tenantId && row.id === rowId);
    if (idx < 0) return null;
    const current = this.reconRows[idx]!;
    const next = { ...current, ...data };
    this.reconRows[idx] = next;
    return { ...next };
  }

  async createPayment(data: Omit<FeePaymentEntity, 'createdAt'>): Promise<FeePaymentEntity> {
    const entity: FeePaymentEntity = { ...data, createdAt: new Date() };
    this.payments.push(entity);
    return entity;
  }

  async listPaymentsForTenant(tenantId: string): Promise<FeePaymentEntity[]> {
    return this.payments.filter((payment) => payment.tenantId === tenantId);
  }

  async findPaymentById(id: string, tenantId: string): Promise<FeePaymentEntity | null> {
    return (
      this.payments.find((payment) => payment.id === id && payment.tenantId === tenantId) ?? null
    );
  }

  async findPaymentByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<FeePaymentEntity | null> {
    return (
      this.payments.find(
        (payment) =>
          payment.tenantId === tenantId && payment.idempotencyKey === idempotencyKey,
      ) ?? null
    );
  }

  async createReceipt(data: Omit<FeeReceiptEntity, 'createdAt'>): Promise<FeeReceiptEntity> {
    const entity: FeeReceiptEntity = { ...data, createdAt: new Date() };
    this.receipts.push(entity);
    return entity;
  }

  async listReceiptsForTenant(tenantId: string): Promise<FeeReceiptEntity[]> {
    return this.receipts.filter((receipt) => receipt.tenantId === tenantId);
  }

  async findReceiptById(id: string, tenantId: string): Promise<FeeReceiptEntity | null> {
    return (
      this.receipts.find((receipt) => receipt.id === id && receipt.tenantId === tenantId) ?? null
    );
  }

  async listReminderSuppressions(tenantId: string): Promise<ReminderSuppressionEntity[]> {
    return this.reminderSuppressions
      .filter((row) => row.tenantId === tenantId)
      .map((row) => ({ ...row }));
  }

  async createReminderSuppression(
    data: ReminderSuppressionEntity,
  ): Promise<ReminderSuppressionEntity> {
    this.reminderSuppressions.push(data);
    return { ...data };
  }

  async deleteReminderSuppression(tenantId: string, suppressionId: string): Promise<boolean> {
    const index = this.reminderSuppressions.findIndex(
      (row) => row.tenantId === tenantId && row.id === suppressionId,
    );
    if (index < 0) return false;
    this.reminderSuppressions.splice(index, 1);
    return true;
  }

  async listReminderSendAudits(tenantId: string): Promise<ReminderSendAuditEntity[]> {
    return this.reminderSendAudits
      .filter((row) => row.tenantId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((row) => ({ ...row }));
  }

  async createReminderSendAudit(
    data: ReminderSendAuditEntity,
  ): Promise<ReminderSendAuditEntity> {
    this.reminderSendAudits.push(data);
    return { ...data };
  }
}
