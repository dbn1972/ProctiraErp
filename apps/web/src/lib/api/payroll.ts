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

export async function listPayStructures(): Promise<PayStructure[]> {
  try {
    const res = await gatewayFetch<{ data: PayStructure[] }>('/payroll/structures');
    return Array.isArray(res) ? res : (res.data ?? []);
  } catch {
    return [];
  }
}
