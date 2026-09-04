import type { PrismaClient } from '@proctira/database';
import type {
  FeeAssignmentEntity,
  FeeStructureEntity,
  FinanceRepository,
  InvoiceEntity,
  PaymentEntity,
} from './finance-repository.js';

function iso(v: Date | string) {
  return v instanceof Date ? v.toISOString() : v;
}

export class PrismaFinanceRepository implements FinanceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listFeeStructures(tenantId: string) {
    const rows = await (this.prisma as any).feeStructure.findMany({ where: { tenantId } });
    return rows.map(mapFeeStructure);
  }
  async getFeeStructure(tenantId: string, id: string) {
    const row = await (this.prisma as any).feeStructure.findFirst({ where: { id, tenantId } });
    return row ? mapFeeStructure(row) : null;
  }
  async createFeeStructure(row: FeeStructureEntity) {
    const created = await (this.prisma as any).feeStructure.create({ data: toFeeStructure(row) });
    return mapFeeStructure(created);
  }
  async updateFeeStructure(tenantId: string, id: string, patch: Partial<FeeStructureEntity>) {
    const existing = await this.getFeeStructure(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).feeStructure.update({
      where: { id },
      data: toFeeStructure({ ...existing, ...patch, id, tenantId }),
    });
    return mapFeeStructure(updated);
  }

  async listFeeAssignments(tenantId: string) {
    const rows = await (this.prisma as any).feeAssignment.findMany({ where: { tenantId } });
    return rows.map(mapFeeAssignment);
  }
  async getFeeAssignment(tenantId: string, id: string) {
    const row = await (this.prisma as any).feeAssignment.findFirst({ where: { id, tenantId } });
    return row ? mapFeeAssignment(row) : null;
  }
  async createFeeAssignment(row: FeeAssignmentEntity) {
    const created = await (this.prisma as any).feeAssignment.create({
      data: toFeeAssignment(row),
    });
    return mapFeeAssignment(created);
  }
  async updateFeeAssignment(
    tenantId: string,
    id: string,
    patch: Partial<FeeAssignmentEntity>,
  ) {
    const existing = await this.getFeeAssignment(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).feeAssignment.update({
      where: { id },
      data: toFeeAssignment({ ...existing, ...patch, id, tenantId }),
    });
    return mapFeeAssignment(updated);
  }
  async listFeeAssignmentsByStructure(tenantId: string, feeStructureId: string) {
    const rows = await (this.prisma as any).feeAssignment.findMany({
      where: { tenantId, feeStructureId, status: 'active' },
    });
    return rows.map(mapFeeAssignment);
  }

  async listInvoices(tenantId: string) {
    const rows = await (this.prisma as any).invoice.findMany({ where: { tenantId } });
    return rows.map(mapInvoice);
  }
  async getInvoice(tenantId: string, id: string) {
    const row = await (this.prisma as any).invoice.findFirst({ where: { id, tenantId } });
    return row ? mapInvoice(row) : null;
  }
  async createInvoice(row: InvoiceEntity) {
    const created = await (this.prisma as any).invoice.create({ data: toInvoice(row) });
    return mapInvoice(created);
  }
  async updateInvoice(tenantId: string, id: string, patch: Partial<InvoiceEntity>) {
    const existing = await this.getInvoice(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).invoice.update({
      where: { id },
      data: toInvoice({ ...existing, ...patch, id, tenantId }),
    });
    return mapInvoice(updated);
  }
  async findOpenInvoiceForAssignment(tenantId: string, feeAssignmentId: string) {
    const row = await (this.prisma as any).invoice.findFirst({
      where: {
        tenantId,
        feeAssignmentId,
        status: { in: ['open', 'partial'] },
      },
    });
    return row ? mapInvoice(row) : null;
  }
  async countInvoices(tenantId: string) {
    return (this.prisma as any).invoice.count({ where: { tenantId } });
  }

  async listPayments(tenantId: string) {
    const rows = await (this.prisma as any).payment.findMany({ where: { tenantId } });
    return rows.map(mapPayment);
  }
  async getPayment(tenantId: string, id: string) {
    const row = await (this.prisma as any).payment.findFirst({ where: { id, tenantId } });
    return row ? mapPayment(row) : null;
  }
  async createPayment(row: PaymentEntity) {
    const created = await (this.prisma as any).payment.create({ data: toPayment(row) });
    return mapPayment(created);
  }
  async updatePayment(tenantId: string, id: string, patch: Partial<PaymentEntity>) {
    const existing = await this.getPayment(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).payment.update({
      where: { id },
      data: toPayment({ ...existing, ...patch, id, tenantId }),
    });
    return mapPayment(updated);
  }
  async countPayments(tenantId: string) {
    return (this.prisma as any).payment.count({ where: { tenantId } });
  }
}

function mapFeeStructure(row: any): FeeStructureEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    academicYear: row.academicYear,
    amount: row.amount,
    currency: row.currency,
    frequency: row.frequency,
    status: row.status,
    institutionId: row.institutionId ?? null,
    gradeId: row.gradeId ?? null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toFeeStructure(row: FeeStructureEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    academicYear: row.academicYear,
    amount: row.amount,
    currency: row.currency,
    frequency: row.frequency,
    status: row.status,
    institutionId: row.institutionId ?? null,
    gradeId: row.gradeId ?? null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
function mapFeeAssignment(row: any): FeeAssignmentEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    feeStructureId: row.feeStructureId,
    studentId: row.studentId,
    enrollmentId: row.enrollmentId ?? null,
    institutionId: row.institutionId ?? null,
    concessionAmount: row.concessionAmount ?? 0,
    status: row.status,
    academicYear: row.academicYear,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toFeeAssignment(row: FeeAssignmentEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    feeStructureId: row.feeStructureId,
    studentId: row.studentId,
    enrollmentId: row.enrollmentId ?? null,
    institutionId: row.institutionId ?? null,
    concessionAmount: row.concessionAmount,
    status: row.status,
    academicYear: row.academicYear,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
function mapInvoice(row: any): InvoiceEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    enrollmentId: row.enrollmentId ?? null,
    feeStructureId: row.feeStructureId ?? null,
    feeAssignmentId: row.feeAssignmentId ?? null,
    institutionId: row.institutionId ?? null,
    invoiceNumber: row.invoiceNumber,
    amountDue: row.amountDue,
    amountPaid: row.amountPaid,
    currency: row.currency,
    dueDate: row.dueDate,
    status: row.status,
    notes: row.notes ?? null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toInvoice(row: InvoiceEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    enrollmentId: row.enrollmentId ?? null,
    feeStructureId: row.feeStructureId ?? null,
    feeAssignmentId: row.feeAssignmentId ?? null,
    institutionId: row.institutionId ?? null,
    invoiceNumber: row.invoiceNumber,
    amountDue: row.amountDue,
    amountPaid: row.amountPaid,
    currency: row.currency,
    dueDate: row.dueDate,
    status: row.status,
    notes: row.notes ?? null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
function mapPayment(row: any): PaymentEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    invoiceId: row.invoiceId,
    studentId: row.studentId,
    amount: row.amount,
    method: row.method,
    reference: row.reference ?? null,
    receiptNumber: row.receiptNumber,
    paidAt: row.paidAt,
    recordedByUserId: row.recordedByUserId ?? null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toPayment(row: PaymentEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    invoiceId: row.invoiceId,
    studentId: row.studentId,
    amount: row.amount,
    method: row.method,
    reference: row.reference ?? null,
    receiptNumber: row.receiptNumber,
    paidAt: row.paidAt,
    recordedByUserId: row.recordedByUserId ?? null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
