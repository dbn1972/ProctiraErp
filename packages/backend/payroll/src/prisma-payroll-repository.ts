import type { PrismaClient } from '@proctira/database';
import type {
  PayStructureEntity,
  PayrollRunEntity,
  PayslipEntity,
  PayrollRepository,
} from './payroll-repository.js';

function iso(v: Date | string) {
  return v instanceof Date ? v.toISOString() : v;
}

export class PrismaPayrollRepository implements PayrollRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listPayStructures(tenantId: string) {
    const rows = await (this.prisma as any).payStructure.findMany({ where: { tenantId } });
    return rows.map(mapPayStructure);
  }
  async getPayStructure(tenantId: string, id: string) {
    const row = await (this.prisma as any).payStructure.findFirst({ where: { id, tenantId } });
    return row ? mapPayStructure(row) : null;
  }
  async createPayStructure(row: PayStructureEntity) {
    const created = await (this.prisma as any).payStructure.create({ data: toPayStructure(row) });
    return mapPayStructure(created);
  }
  async updatePayStructure(tenantId: string, id: string, patch: Partial<PayStructureEntity>) {
    const existing = await this.getPayStructure(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).payStructure.update({
      where: { id },
      data: toPayStructure({ ...existing, ...patch, id, tenantId }),
    });
    return mapPayStructure(updated);
  }
  async listPayrollRuns(tenantId: string) {
    const rows = await (this.prisma as any).payrollRun.findMany({ where: { tenantId } });
    return rows.map(mapPayrollRun);
  }
  async getPayrollRun(tenantId: string, id: string) {
    const row = await (this.prisma as any).payrollRun.findFirst({ where: { id, tenantId } });
    return row ? mapPayrollRun(row) : null;
  }
  async createPayrollRun(row: PayrollRunEntity) {
    const created = await (this.prisma as any).payrollRun.create({ data: toPayrollRun(row) });
    return mapPayrollRun(created);
  }
  async updatePayrollRun(tenantId: string, id: string, patch: Partial<PayrollRunEntity>) {
    const existing = await this.getPayrollRun(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).payrollRun.update({
      where: { id },
      data: toPayrollRun({ ...existing, ...patch, id, tenantId }),
    });
    return mapPayrollRun(updated);
  }
  async listPayslips(tenantId: string) {
    const rows = await (this.prisma as any).payslip.findMany({ where: { tenantId } });
    return rows.map(mapPayslip);
  }
  async getPayslip(tenantId: string, id: string) {
    const row = await (this.prisma as any).payslip.findFirst({ where: { id, tenantId } });
    return row ? mapPayslip(row) : null;
  }
  async createPayslip(row: PayslipEntity) {
    const created = await (this.prisma as any).payslip.create({ data: toPayslip(row) });
    return mapPayslip(created);
  }
  async updatePayslip(tenantId: string, id: string, patch: Partial<PayslipEntity>) {
    const existing = await this.getPayslip(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).payslip.update({
      where: { id },
      data: toPayslip({ ...existing, ...patch, id, tenantId }),
    });
    return mapPayslip(updated);
  }
}

function mapPayStructure(row: any): PayStructureEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    currency: row.currency,
    components: row.components,
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toPayStructure(row: PayStructureEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    currency: row.currency,
    components: row.components,
    status: row.status,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
function mapPayrollRun(row: any): PayrollRunEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    payStructureId: row.payStructureId ?? null,
    periodYear: row.periodYear,
    periodMonth: row.periodMonth,
    status: row.status,
    totalAmount: row.totalAmount,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toPayrollRun(row: PayrollRunEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    payStructureId: row.payStructureId ?? null,
    periodYear: row.periodYear,
    periodMonth: row.periodMonth,
    status: row.status,
    totalAmount: row.totalAmount,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
function mapPayslip(row: any): PayslipEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    payrollRunId: row.payrollRunId,
    staffId: row.staffId,
    grossAmount: row.grossAmount,
    netAmount: row.netAmount,
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toPayslip(row: PayslipEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    payrollRunId: row.payrollRunId,
    staffId: row.staffId,
    grossAmount: row.grossAmount,
    netAmount: row.netAmount,
    status: row.status,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
