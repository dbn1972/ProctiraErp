/** Canteen / MDM repository ports (P23). */

export interface MealMenuEntity {
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

export interface MealServingEntity {
  id: string;
  tenantId: string;
  menuId: string;
  institutionId: string;
  servedCount: number;
  wastageCount: number;
  servedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CanteenRepository {
  listMealMenus(tenantId: string): Promise<MealMenuEntity[]>;
  getMealMenu(tenantId: string, id: string): Promise<MealMenuEntity | null>;
  createMealMenu(row: MealMenuEntity): Promise<MealMenuEntity>;
  updateMealMenu(tenantId: string, id: string, patch: Partial<MealMenuEntity>): Promise<MealMenuEntity | null>;
  listMealServings(tenantId: string): Promise<MealServingEntity[]>;
  getMealServing(tenantId: string, id: string): Promise<MealServingEntity | null>;
  createMealServing(row: MealServingEntity): Promise<MealServingEntity>;
  updateMealServing(tenantId: string, id: string, patch: Partial<MealServingEntity>): Promise<MealServingEntity | null>;
}
