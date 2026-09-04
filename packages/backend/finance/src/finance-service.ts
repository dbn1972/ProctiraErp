import { randomUUID } from 'node:crypto';
import { FinanceDomainError } from './finance-errors.js';
import type {
  FeeAssignmentEntity,
  FeeStructureEntity,
  FinanceRepository,
  InvoiceEntity,
  PaymentEntity,
} from './finance-repository.js';

function invoiceStatus(amountDue: number, amountPaid: number): string {
  if (amountPaid <= 0) return 'open';
  if (amountPaid + 0.0001 >= amountDue) return 'paid';
  return 'partial';
}

function padSeq(n: number): string {
  return String(n).padStart(6, '0');
}

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
      name: input.name,
      academicYear: input.academicYear,
      amount: input.amount,
      currency: input.currency ?? 'INR',
      frequency: input.frequency ?? 'annual',
      status: input.status ?? 'active',
      institutionId: input.institutionId ?? null,
      gradeId: input.gradeId ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }
  updateFeeStructure(tenantId: string, id: string, patch: Partial<FeeStructureEntity>) {
    return this.repo.updateFeeStructure(tenantId, id, patch);
  }

  listFeeAssignments(tenantId: string) {
    return this.repo.listFeeAssignments(tenantId);
  }

  async assignFee(
    tenantId: string,
    input: {
      feeStructureId: string;
      studentId: string;
      enrollmentId?: string | null;
      institutionId?: string | null;
      concessionAmount?: number;
      academicYear?: string;
    },
  ): Promise<FeeAssignmentEntity> {
    const structure = await this.repo.getFeeStructure(tenantId, input.feeStructureId);
    if (!structure) {
      throw new FinanceDomainError('FEE_STRUCTURE_NOT_FOUND', 'Fee structure not found', 404);
    }
    if (structure.status !== 'active') {
      throw new FinanceDomainError('FEE_STRUCTURE_INACTIVE', 'Fee structure is not active');
    }
    const concession = Math.max(0, input.concessionAmount ?? 0);
    if (concession > structure.amount) {
      throw new FinanceDomainError(
        'CONCESSION_EXCEEDS_AMOUNT',
        'Concession cannot exceed fee amount',
      );
    }
    const now = new Date().toISOString();
    return this.repo.createFeeAssignment({
      id: randomUUID(),
      tenantId,
      feeStructureId: structure.id,
      studentId: input.studentId,
      enrollmentId: input.enrollmentId ?? null,
      institutionId: input.institutionId ?? structure.institutionId,
      concessionAmount: concession,
      status: 'active',
      academicYear: input.academicYear ?? structure.academicYear,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Generate open invoices for active assignments of a fee structure.
   * Skips assignments that already have an open/partial invoice.
   */
  async generateInvoices(
    tenantId: string,
    input: { feeStructureId: string; dueDate: string },
  ): Promise<{ created: InvoiceEntity[]; skipped: number }> {
    const structure = await this.repo.getFeeStructure(tenantId, input.feeStructureId);
    if (!structure) {
      throw new FinanceDomainError('FEE_STRUCTURE_NOT_FOUND', 'Fee structure not found', 404);
    }
    const assignments = await this.repo.listFeeAssignmentsByStructure(
      tenantId,
      input.feeStructureId,
    );
    const created: InvoiceEntity[] = [];
    let skipped = 0;
    let seq = (await this.repo.countInvoices(tenantId)) + 1;
    const year = new Date().getFullYear();

    for (const assignment of assignments) {
      const existing = await this.repo.findOpenInvoiceForAssignment(
        tenantId,
        assignment.id,
      );
      if (existing) {
        skipped += 1;
        continue;
      }
      const amountDue = Math.max(0, structure.amount - assignment.concessionAmount);
      const now = new Date().toISOString();
      const invoice = await this.repo.createInvoice({
        id: randomUUID(),
        tenantId,
        studentId: assignment.studentId,
        enrollmentId: assignment.enrollmentId,
        feeStructureId: structure.id,
        feeAssignmentId: assignment.id,
        institutionId: assignment.institutionId,
        invoiceNumber: `INV-${year}-${padSeq(seq++)}`,
        amountDue,
        amountPaid: 0,
        currency: structure.currency,
        dueDate: input.dueDate,
        status: 'open',
        notes: null,
        createdAt: now,
        updatedAt: now,
      });
      created.push(invoice);
    }
    return { created, skipped };
  }

  listInvoices(tenantId: string) {
    return this.repo.listInvoices(tenantId);
  }
  getInvoice(tenantId: string, id: string) {
    return this.repo.getInvoice(tenantId, id);
  }
  createInvoice(
    tenantId: string,
    input: Omit<
      InvoiceEntity,
      'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'invoiceNumber' | 'amountPaid' | 'status'
    > & { invoiceNumber?: string; amountPaid?: number; status?: string },
  ) {
    const now = new Date().toISOString();
    return this.repo.countInvoices(tenantId).then(async (count) => {
      const amountPaid = input.amountPaid ?? 0;
      const amountDue = input.amountDue;
      return this.repo.createInvoice({
        id: randomUUID(),
        tenantId,
        studentId: input.studentId,
        enrollmentId: input.enrollmentId ?? null,
        feeStructureId: input.feeStructureId ?? null,
        feeAssignmentId: input.feeAssignmentId ?? null,
        institutionId: input.institutionId ?? null,
        invoiceNumber:
          input.invoiceNumber ?? `INV-${new Date().getFullYear()}-${padSeq(count + 1)}`,
        amountDue,
        amountPaid,
        currency: input.currency ?? 'INR',
        dueDate: input.dueDate,
        status: input.status ?? invoiceStatus(amountDue, amountPaid),
        notes: input.notes ?? null,
        createdAt: now,
        updatedAt: now,
      });
    });
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

  /**
   * Record a payment against an invoice and advance invoice status.
   * Idempotent on (tenantId, reference) is left to gateway idempotency keys;
   * rejects overpayment and payments on void/paid invoices.
   */
  async recordPayment(
    tenantId: string,
    input: {
      invoiceId: string;
      amount: number;
      method?: string;
      reference?: string | null;
      paidAt?: string;
      recordedByUserId?: string | null;
    },
  ): Promise<{ payment: PaymentEntity; invoice: InvoiceEntity }> {
    if (!(input.amount > 0)) {
      throw new FinanceDomainError('INVALID_PAYMENT_AMOUNT', 'Payment amount must be positive');
    }
    const invoice = await this.repo.getInvoice(tenantId, input.invoiceId);
    if (!invoice) {
      throw new FinanceDomainError('INVOICE_NOT_FOUND', 'Invoice not found', 404);
    }
    if (invoice.status === 'void') {
      throw new FinanceDomainError('INVOICE_VOID', 'Cannot pay a void invoice');
    }
    if (invoice.status === 'paid') {
      throw new FinanceDomainError('INVOICE_ALREADY_PAID', 'Invoice is already paid');
    }
    const remaining = invoice.amountDue - invoice.amountPaid;
    if (input.amount > remaining + 0.0001) {
      throw new FinanceDomainError(
        'PAYMENT_EXCEEDS_BALANCE',
        `Payment ${input.amount} exceeds remaining balance ${remaining}`,
      );
    }

    const now = new Date().toISOString();
    const seq = (await this.repo.countPayments(tenantId)) + 1;
    const payment = await this.repo.createPayment({
      id: randomUUID(),
      tenantId,
      invoiceId: invoice.id,
      studentId: invoice.studentId,
      amount: input.amount,
      method: input.method ?? 'cash',
      reference: input.reference ?? null,
      receiptNumber: `RCPT-${new Date().getFullYear()}-${padSeq(seq)}`,
      paidAt: input.paidAt ?? now.slice(0, 10),
      recordedByUserId: input.recordedByUserId ?? null,
      createdAt: now,
      updatedAt: now,
    });

    const amountPaid = invoice.amountPaid + input.amount;
    const updated = await this.repo.updateInvoice(tenantId, invoice.id, {
      amountPaid,
      status: invoiceStatus(invoice.amountDue, amountPaid),
    });
    if (!updated) {
      throw new FinanceDomainError('INVOICE_UPDATE_FAILED', 'Failed to update invoice', 500);
    }
    return { payment, invoice: updated };
  }

  /** @deprecated Prefer recordPayment — kept for raw CRUD compat. */
  createPayment(
    tenantId: string,
    input: Omit<PaymentEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'receiptNumber'> & {
      receiptNumber?: string;
    },
  ) {
    return this.recordPayment(tenantId, {
      invoiceId: input.invoiceId,
      amount: input.amount,
      method: input.method,
      reference: input.reference,
      paidAt: input.paidAt,
      recordedByUserId: input.recordedByUserId,
    }).then((r) => r.payment);
  }

  updatePayment(tenantId: string, id: string, patch: Partial<PaymentEntity>) {
    return this.repo.updatePayment(tenantId, id, patch);
  }
}
