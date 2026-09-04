/** Payroll repository ports (P24). */

export interface PayStructureEntity {
  id: string;
  tenantId: string;
  name: string;
  currency: string;
  components: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollRunEntity {
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

export interface PayslipEntity {
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

export interface PayrollRepository {
  listPayStructures(tenantId: string): Promise<PayStructureEntity[]>;
  getPayStructure(tenantId: string, id: string): Promise<PayStructureEntity | null>;
  createPayStructure(row: PayStructureEntity): Promise<PayStructureEntity>;
  updatePayStructure(tenantId: string, id: string, patch: Partial<PayStructureEntity>): Promise<PayStructureEntity | null>;
  listPayrollRuns(tenantId: string): Promise<PayrollRunEntity[]>;
  getPayrollRun(tenantId: string, id: string): Promise<PayrollRunEntity | null>;
  createPayrollRun(row: PayrollRunEntity): Promise<PayrollRunEntity>;
  updatePayrollRun(tenantId: string, id: string, patch: Partial<PayrollRunEntity>): Promise<PayrollRunEntity | null>;
  listPayslips(tenantId: string): Promise<PayslipEntity[]>;
  getPayslip(tenantId: string, id: string): Promise<PayslipEntity | null>;
  createPayslip(row: PayslipEntity): Promise<PayslipEntity>;
  updatePayslip(tenantId: string, id: string, patch: Partial<PayslipEntity>): Promise<PayslipEntity | null>;
}
