import { gatewayFetch } from './gateway';

export interface MealMenu {
  id: string;
  tenantId: string;
  institutionId: string;
  date: string;
  mealType: string;
  items: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export async function listMealMenus(): Promise<MealMenu[]> {
  try {
    const res = await gatewayFetch<{ data: MealMenu[] }>('/canteen/menus');
    return Array.isArray(res) ? res : (res.data ?? []);
  } catch {
    return [];
  }
}
