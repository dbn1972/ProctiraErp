import { gatewayFetch } from './gateway';

export interface FeeStructure {
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

export interface FeeAssignment {
  id: string;
  feeStructureId: string;
  studentId: string;
  concessionAmount: number;
  status: string;
  academicYear: string;
}

export interface Invoice {
  id: string;
  studentId: string;
  feeStructureId: string | null;
  invoiceNumber: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  dueDate: string;
  status: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  studentId: string;
  amount: number;
  method: string;
  receiptNumber: string;
  paidAt: string;
}

async function unwrapList<T>(path: string): Promise<T[]> {
  try {
    const res = await gatewayFetch<{ data: T[] } | T[]>(path, { throwOnError: false });
    if (Array.isArray(res.data)) return res.data;
    if (res.data && typeof res.data === 'object' && Array.isArray((res.data as { data: T[] }).data)) {
      return (res.data as { data: T[] }).data;
    }
    return [];
  } catch {
    return [];
  }
}

export function listFeeStructures() {
  return unwrapList<FeeStructure>('/fees/structures');
}
export function listFeeAssignments() {
  return unwrapList<FeeAssignment>('/fees/assignments');
}
export function listInvoices() {
  return unwrapList<Invoice>('/fees/invoices');
}
export function listPayments() {
  return unwrapList<Payment>('/fees/payments');
}
