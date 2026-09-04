import type {
  FeeStructureEntity,
  InvoiceEntity,
  PaymentEntity,
  FinanceRepository,
} from './finance-repository.js';

export class InMemoryFinanceRepository implements FinanceRepository {
  private readonly feeStructures = new Map<string, FeeStructureEntity>();
  private readonly invoices = new Map<string, InvoiceEntity>();
  private readonly payments = new Map<string, PaymentEntity>();

  async listFeeStructures(tenantId: string) {
    return [...this.feeStructures.values()].filter((x) => x.tenantId === tenantId);
  }
  async getFeeStructure(tenantId: string, id: string) {
    const row = this.feeStructures.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createFeeStructure(row: FeeStructureEntity) {
    this.feeStructures.set(row.id, row);
    return row;
  }
  async updateFeeStructure(tenantId: string, id: string, patch: Partial<FeeStructureEntity>) {
    const cur = await this.getFeeStructure(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.feeStructures.set(id, next);
    return next;
  }
  async listInvoices(tenantId: string) {
    return [...this.invoices.values()].filter((x) => x.tenantId === tenantId);
  }
  async getInvoice(tenantId: string, id: string) {
    const row = this.invoices.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createInvoice(row: InvoiceEntity) {
    this.invoices.set(row.id, row);
    return row;
  }
  async updateInvoice(tenantId: string, id: string, patch: Partial<InvoiceEntity>) {
    const cur = await this.getInvoice(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.invoices.set(id, next);
    return next;
  }
  async listPayments(tenantId: string) {
    return [...this.payments.values()].filter((x) => x.tenantId === tenantId);
  }
  async getPayment(tenantId: string, id: string) {
    const row = this.payments.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createPayment(row: PaymentEntity) {
    this.payments.set(row.id, row);
    return row;
  }
  async updatePayment(tenantId: string, id: string, patch: Partial<PaymentEntity>) {
    const cur = await this.getPayment(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.payments.set(id, next);
    return next;
  }
}
