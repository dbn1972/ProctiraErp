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

export async function listFeeStructures(): Promise<FeeStructure[]> {
  try {
    const res = await gatewayFetch<{ data: FeeStructure[] }>('/fees/structures');
    return Array.isArray(res) ? res : (res.data ?? []);
  } catch {
    return [];
  }
}
