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
    return Array.isArray(res) ? res : (res.data ?? []);
  } catch {
    return [];
  }
}
