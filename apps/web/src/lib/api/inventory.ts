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
    return Array.isArray(res) ? res : (res.data ?? []);
  } catch {
    return [];
  }
}
