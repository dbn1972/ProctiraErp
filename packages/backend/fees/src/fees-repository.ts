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

export interface FeesRepository {
  createFeePlan(data: Omit<FeePlanEntity, 'createdAt' | 'updatedAt'>): Promise<FeePlanEntity>;
  listFeePlans(tenantId: string): Promise<FeePlanEntity[]>;
  findFeePlanById(id: string, tenantId: string): Promise<FeePlanEntity | null>;

  createInvoice(data: Omit<FeeInvoiceEntity, 'createdAt' | 'updatedAt'>): Promise<FeeInvoiceEntity>;
  listInvoicesForTenant(tenantId: string): Promise<FeeInvoiceEntity[]>;
  findInvoiceById(id: string, tenantId: string): Promise<FeeInvoiceEntity | null>;
  updateInvoice(
    id: string,
    tenantId: string,
    data: Partial<Pick<FeeInvoiceEntity, 'status'>>,
  ): Promise<FeeInvoiceEntity | null>;

  createPayment(data: Omit<FeePaymentEntity, 'createdAt'>): Promise<FeePaymentEntity>;
  listPaymentsForTenant(tenantId: string): Promise<FeePaymentEntity[]>;
  findPaymentById(id: string, tenantId: string): Promise<FeePaymentEntity | null>;

  createReceipt(data: Omit<FeeReceiptEntity, 'createdAt'>): Promise<FeeReceiptEntity>;
  listReceiptsForTenant(tenantId: string): Promise<FeeReceiptEntity[]>;
  findReceiptById(id: string, tenantId: string): Promise<FeeReceiptEntity | null>;
}
