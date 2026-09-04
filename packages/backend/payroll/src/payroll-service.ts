import { randomUUID } from 'node:crypto';
import type {
  PayStructureEntity,
  PayrollRunEntity,
  PayslipEntity,
  PayrollRepository,
} from './payroll-repository.js';

export class PayrollService {
  constructor(private readonly repo: PayrollRepository) {}

  listPayStructures(tenantId: string) {
    return this.repo.listPayStructures(tenantId);
  }
  getPayStructure(tenantId: string, id: string) {
    return this.repo.getPayStructure(tenantId, id);
  }
  createPayStructure(
    tenantId: string,
    input: Omit<PayStructureEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createPayStructure({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as PayStructureEntity);
  }
  updatePayStructure(tenantId: string, id: string, patch: Partial<PayStructureEntity>) {
    return this.repo.updatePayStructure(tenantId, id, patch);
  }
  listPayrollRuns(tenantId: string) {
    return this.repo.listPayrollRuns(tenantId);
  }
  getPayrollRun(tenantId: string, id: string) {
    return this.repo.getPayrollRun(tenantId, id);
  }
  createPayrollRun(
    tenantId: string,
    input: Omit<PayrollRunEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createPayrollRun({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as PayrollRunEntity);
  }
  updatePayrollRun(tenantId: string, id: string, patch: Partial<PayrollRunEntity>) {
    return this.repo.updatePayrollRun(tenantId, id, patch);
  }
  listPayslips(tenantId: string) {
    return this.repo.listPayslips(tenantId);
  }
  getPayslip(tenantId: string, id: string) {
    return this.repo.getPayslip(tenantId, id);
  }
  createPayslip(
    tenantId: string,
    input: Omit<PayslipEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createPayslip({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as PayslipEntity);
  }
  updatePayslip(tenantId: string, id: string, patch: Partial<PayslipEntity>) {
    return this.repo.updatePayslip(tenantId, id, patch);
  }
}
