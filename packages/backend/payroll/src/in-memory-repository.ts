import type {
  PayStructureEntity,
  PayrollRunEntity,
  PayslipEntity,
  PayrollRepository,
} from './payroll-repository.js';

export class InMemoryPayrollRepository implements PayrollRepository {
  private readonly payStructures = new Map<string, PayStructureEntity>();
  private readonly payrollRuns = new Map<string, PayrollRunEntity>();
  private readonly payslips = new Map<string, PayslipEntity>();

  async listPayStructures(tenantId: string) {
    return [...this.payStructures.values()].filter((x) => x.tenantId === tenantId);
  }
  async getPayStructure(tenantId: string, id: string) {
    const row = this.payStructures.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createPayStructure(row: PayStructureEntity) {
    this.payStructures.set(row.id, row);
    return row;
  }
  async updatePayStructure(tenantId: string, id: string, patch: Partial<PayStructureEntity>) {
    const cur = await this.getPayStructure(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.payStructures.set(id, next);
    return next;
  }
  async listPayrollRuns(tenantId: string) {
    return [...this.payrollRuns.values()].filter((x) => x.tenantId === tenantId);
  }
  async getPayrollRun(tenantId: string, id: string) {
    const row = this.payrollRuns.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createPayrollRun(row: PayrollRunEntity) {
    this.payrollRuns.set(row.id, row);
    return row;
  }
  async updatePayrollRun(tenantId: string, id: string, patch: Partial<PayrollRunEntity>) {
    const cur = await this.getPayrollRun(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.payrollRuns.set(id, next);
    return next;
  }
  async listPayslips(tenantId: string) {
    return [...this.payslips.values()].filter((x) => x.tenantId === tenantId);
  }
  async getPayslip(tenantId: string, id: string) {
    const row = this.payslips.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createPayslip(row: PayslipEntity) {
    this.payslips.set(row.id, row);
    return row;
  }
  async updatePayslip(tenantId: string, id: string, patch: Partial<PayslipEntity>) {
    const cur = await this.getPayslip(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.payslips.set(id, next);
    return next;
  }
}
