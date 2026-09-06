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
    if (Array.isArray(res.data)) return res.data;
    if (res.data && typeof res.data === 'object' && Array.isArray(res.data.data)) {
      return res.data.data;
    }
    return [];
  } catch {
    return [];
  }
}
