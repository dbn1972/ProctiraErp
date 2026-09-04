/** Finance / Fees repository ports (P18) — production fee cycle. */

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

export interface FeeAssignmentEntity {
  id: string;
  tenantId: string;
  feeStructureId: string;
  studentId: string;
  enrollmentId: string | null;
  institutionId: string | null;
  concessionAmount: number;
  status: string;
  academicYear: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceEntity {
  id: string;
  tenantId: string;
  studentId: string;
  enrollmentId: string | null;
  feeStructureId: string | null;
  feeAssignmentId: string | null;
  institutionId: string | null;
  invoiceNumber: string;
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
  receiptNumber: string;
  paidAt: string;
  recordedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceRepository {
  listFeeStructures(tenantId: string): Promise<FeeStructureEntity[]>;
  getFeeStructure(tenantId: string, id: string): Promise<FeeStructureEntity | null>;
  createFeeStructure(row: FeeStructureEntity): Promise<FeeStructureEntity>;
  updateFeeStructure(
    tenantId: string,
    id: string,
    patch: Partial<FeeStructureEntity>,
  ): Promise<FeeStructureEntity | null>;

  listFeeAssignments(tenantId: string): Promise<FeeAssignmentEntity[]>;
  getFeeAssignment(tenantId: string, id: string): Promise<FeeAssignmentEntity | null>;
  createFeeAssignment(row: FeeAssignmentEntity): Promise<FeeAssignmentEntity>;
  updateFeeAssignment(
    tenantId: string,
    id: string,
    patch: Partial<FeeAssignmentEntity>,
  ): Promise<FeeAssignmentEntity | null>;
  listFeeAssignmentsByStructure(
    tenantId: string,
    feeStructureId: string,
  ): Promise<FeeAssignmentEntity[]>;

  listInvoices(tenantId: string): Promise<InvoiceEntity[]>;
  getInvoice(tenantId: string, id: string): Promise<InvoiceEntity | null>;
  createInvoice(row: InvoiceEntity): Promise<InvoiceEntity>;
  updateInvoice(
    tenantId: string,
    id: string,
    patch: Partial<InvoiceEntity>,
  ): Promise<InvoiceEntity | null>;
  findOpenInvoiceForAssignment(
    tenantId: string,
    feeAssignmentId: string,
  ): Promise<InvoiceEntity | null>; // open | partial

  listPayments(tenantId: string): Promise<PaymentEntity[]>;
  getPayment(tenantId: string, id: string): Promise<PaymentEntity | null>;
  createPayment(row: PaymentEntity): Promise<PaymentEntity>;
  updatePayment(
    tenantId: string,
    id: string,
    patch: Partial<PaymentEntity>,
  ): Promise<PaymentEntity | null>;
  countPayments(tenantId: string): Promise<number>;
  countInvoices(tenantId: string): Promise<number>;
}
