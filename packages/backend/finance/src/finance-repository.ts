/** Finance / Fees repository ports (P18). */

export interface FeeStructureEntity {
  id: string;
  tenantId: string;
  name: string;
  academicYear: string;
  amount: number;
  currency: string;
  frequency: string;
  status: string;
  institutionId: string | null;
  gradeId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceEntity {
  id: string;
  tenantId: string;
  studentId: string;
  enrollmentId: string | null;
  feeStructureId: string | null;
  institutionId: string | null;
  amountDue: number;
  amountPaid: number;
  currency: string;
  dueDate: string;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentEntity {
  id: string;
  tenantId: string;
  invoiceId: string;
  studentId: string;
  amount: number;
  method: string;
  reference: string | null;
  paidAt: string;
  recordedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceRepository {
  listFeeStructures(tenantId: string): Promise<FeeStructureEntity[]>;
  getFeeStructure(tenantId: string, id: string): Promise<FeeStructureEntity | null>;
  createFeeStructure(row: FeeStructureEntity): Promise<FeeStructureEntity>;
  updateFeeStructure(tenantId: string, id: string, patch: Partial<FeeStructureEntity>): Promise<FeeStructureEntity | null>;
  listInvoices(tenantId: string): Promise<InvoiceEntity[]>;
  getInvoice(tenantId: string, id: string): Promise<InvoiceEntity | null>;
  createInvoice(row: InvoiceEntity): Promise<InvoiceEntity>;
  updateInvoice(tenantId: string, id: string, patch: Partial<InvoiceEntity>): Promise<InvoiceEntity | null>;
  listPayments(tenantId: string): Promise<PaymentEntity[]>;
  getPayment(tenantId: string, id: string): Promise<PaymentEntity | null>;
  createPayment(row: PaymentEntity): Promise<PaymentEntity>;
  updatePayment(tenantId: string, id: string, patch: Partial<PaymentEntity>): Promise<PaymentEntity | null>;
}
