import { gatewayFetch } from './gateway';

export interface Hostel {
  id: string;
  tenantId: string;
  institutionId: string;
  name: string;
  gender: string;
  capacity: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export async function listHostels(): Promise<Hostel[]> {
  try {
    const res = await gatewayFetch<{ data: Hostel[] }>('/hostels');
    if (Array.isArray(res.data)) return res.data;
    if (res.data && typeof res.data === 'object' && Array.isArray(res.data.data)) {
      return res.data.data;
    }
    return [];
  } catch {
    return [];
  }
}
