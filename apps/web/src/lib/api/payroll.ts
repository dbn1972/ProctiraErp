import { gatewayFetch } from './gateway';

export interface PayStructure {
  id: string;
  tenantId: string;
  name: string;
  currency: string;
  components: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollRun {
  id: string;
  tenantId: string;
  payStructureId: string | null;
  periodYear: number;
  periodMonth: number;
  status: string;
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Payslip {
  id: string;
  tenantId: string;
  payrollRunId: string;
  staffId: string;
  grossAmount: number;
  netAmount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

async function unwrapList<T>(path: string): Promise<T[]> {
  try {
    const result = await gatewayFetch<{ data: T[] }>(path);
    return result.data?.data ?? [];
  } catch {
    return [];
  }
}

export function listPayStructures() {
  return unwrapList<PayStructure>('/payroll/structures');
}

export function listPayrollRuns() {
  return unwrapList<PayrollRun>('/payroll/runs');
}

export function listPayslips() {
  return unwrapList<Payslip>('/payroll/payslips');
}
