/**
 * In-memory fees repository (unit tests / gateway without DATABASE_URL).
 */
import {
  assertJournalBalanced,
  type FeeInvoiceEntity,
  type FeeLedgerEntryEntity,
  type FeePaymentEntity,
  type FeePlanEntity,
  type FeeReceiptEntity,
  type FeesRepository,
  type LedgerAccount,
  type LedgerTrialBalance,
} from './fees-repository.js';

export class InMemoryFeesRepository implements FeesRepository {
  private plans: FeePlanEntity[] = [];
  private invoices: FeeInvoiceEntity[] = [];
  private payments: FeePaymentEntity[] = [];
  private receipts: FeeReceiptEntity[] = [];
  private ledger: FeeLedgerEntryEntity[] = [];

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
    const entity: FeeInvoiceEntity = { ...data, createdAt: now, updatedAt: now };
    this.invoices.push(entity);
    return entity;
  }

  async listInvoicesForTenant(tenantId: string): Promise<FeeInvoiceEntity[]> {
    return this.invoices.filter((invoice) => invoice.tenantId === tenantId);
  }

  async findInvoiceById(id: string, tenantId: string): Promise<FeeInvoiceEntity | null> {
    return (
      this.invoices.find((invoice) => invoice.id === id && invoice.tenantId === tenantId) ?? null
    );
  }

  async updateInvoice(
    id: string,
    tenantId: string,
    data: Partial<Pick<FeeInvoiceEntity, 'status'>>,
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
}
