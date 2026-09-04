import { randomUUID } from 'node:crypto';
import { NotFoundError } from '@proctira/common';
import type {
  PayStructureEntity,
  PayrollRunEntity,
  PayslipEntity,
  PayrollRepository,
} from './payroll-repository.js';

export interface GeneratePayrollRunInput {
  periodYear: number;
  periodMonth: number;
  payStructureId: string;
  staffIds: string[];
}

export interface GeneratePayrollRunResult {
  run: PayrollRunEntity;
  payslips: PayslipEntity[];
}

/** Optional base amount when components are empty (not on Prisma model; allowed on in-memory patches). */
type StructureWithBase = PayStructureEntity & { baseAmount?: number };

function parseComponents(raw: unknown): unknown[] {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Derive gross/net from pay structure components.
 * Component shape: `{ amount: number, type?: 'earning' | 'deduction' }`.
 * Empty components → use `baseAmount` if present, else gross/net = 0.
 */
export function deriveAmountsFromStructure(structure: StructureWithBase): {
  grossAmount: number;
  netAmount: number;
} {
  const components = parseComponents(structure.components);
  if (components.length === 0) {
    const base =
      typeof structure.baseAmount === 'number' && Number.isFinite(structure.baseAmount)
        ? structure.baseAmount
        : 0;
    return { grossAmount: base, netAmount: base };
  }

  let earnings = 0;
  let deductions = 0;
  for (const item of components) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const amount = Number(row.amount ?? 0);
    if (!Number.isFinite(amount)) continue;
    const type = String(row.type ?? 'earning').toLowerCase();
    if (type === 'deduction' || type === 'deduct') {
      deductions += amount;
    } else {
      earnings += amount;
    }
  }

  return { grossAmount: earnings, netAmount: earnings - deductions };
}

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

  /**
   * Generate a payroll run and one payslip per staff from the given pay structure.
   */
  async generateRun(
    tenantId: string,
    input: GeneratePayrollRunInput,
  ): Promise<GeneratePayrollRunResult> {
    const structure = await this.repo.getPayStructure(tenantId, input.payStructureId);
    if (!structure) {
      throw new NotFoundError(`Pay structure ${input.payStructureId} not found`);
    }

    const { grossAmount, netAmount } = deriveAmountsFromStructure(structure);
    const now = new Date().toISOString();
    const runId = randomUUID();
    const staffIds = input.staffIds ?? [];
    const totalAmount = netAmount * staffIds.length;

    const run = await this.repo.createPayrollRun({
      id: runId,
      tenantId,
      payStructureId: input.payStructureId,
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      status: 'generated',
      totalAmount,
      createdAt: now,
      updatedAt: now,
    });

    const payslips: PayslipEntity[] = [];
    for (const staffId of staffIds) {
      const payslip = await this.repo.createPayslip({
        id: randomUUID(),
        tenantId,
        payrollRunId: run.id,
        staffId,
        grossAmount,
        netAmount,
        status: 'generated',
        createdAt: now,
        updatedAt: now,
      });
      payslips.push(payslip);
    }

    return { run, payslips };
  }
}
