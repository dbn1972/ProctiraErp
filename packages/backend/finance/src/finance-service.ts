import { randomUUID } from 'node:crypto';
import type {
  FeeStructureEntity,
  InvoiceEntity,
  PaymentEntity,
  FinanceRepository,
} from './finance-repository.js';

export class FinanceService {
  constructor(private readonly repo: FinanceRepository) {}

  listFeeStructures(tenantId: string) {
    return this.repo.listFeeStructures(tenantId);
  }
  getFeeStructure(tenantId: string, id: string) {
    return this.repo.getFeeStructure(tenantId, id);
  }
  createFeeStructure(
    tenantId: string,
    input: Omit<FeeStructureEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createFeeStructure({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as FeeStructureEntity);
  }
  updateFeeStructure(tenantId: string, id: string, patch: Partial<FeeStructureEntity>) {
    return this.repo.updateFeeStructure(tenantId, id, patch);
  }
  listInvoices(tenantId: string) {
    return this.repo.listInvoices(tenantId);
  }
  getInvoice(tenantId: string, id: string) {
    return this.repo.getInvoice(tenantId, id);
  }
  createInvoice(
    tenantId: string,
    input: Omit<InvoiceEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createInvoice({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as InvoiceEntity);
  }
  updateInvoice(tenantId: string, id: string, patch: Partial<InvoiceEntity>) {
    return this.repo.updateInvoice(tenantId, id, patch);
  }
  listPayments(tenantId: string) {
    return this.repo.listPayments(tenantId);
  }
  getPayment(tenantId: string, id: string) {
    return this.repo.getPayment(tenantId, id);
  }
  createPayment(
    tenantId: string,
    input: Omit<PaymentEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createPayment({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as PaymentEntity);
  }
  updatePayment(tenantId: string, id: string, patch: Partial<PaymentEntity>) {
    return this.repo.updatePayment(tenantId, id, patch);
  }
}
