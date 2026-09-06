import { gatewayFetch } from './gateway';

export interface InventoryItem {
  id: string;
  tenantId: string;
  institutionId: string | null;
  sku: string;
  name: string;
  unit: string;
  quantityOnHand: number;
  reorderLevel: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export async function listInventoryItems(): Promise<InventoryItem[]> {
  try {
    const res = await gatewayFetch<{ data: InventoryItem[] }>('/inventory/items');
    if (Array.isArray(res.data)) return res.data;
    if (res.data && typeof res.data === 'object' && Array.isArray(res.data.data)) {
      return res.data.data;
    }
    return [];
  } catch {
    return [];
  }
}
