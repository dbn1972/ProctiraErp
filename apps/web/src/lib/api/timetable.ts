import { gatewayFetch } from './gateway';

export interface BellPeriod {
  id: string;
  tenantId: string;
  institutionId: string;
  name: string;
  periodOrder: number;
  startTime: string;
  endTime: string;
  createdAt: string;
  updatedAt: string;
}

export async function listBellPeriods(): Promise<BellPeriod[]> {
  try {
    const res = await gatewayFetch<{ data: BellPeriod[] }>('/timetables/periods');
    return Array.isArray(res) ? res : (res.data ?? []);
  } catch {
    return [];
  }
}
