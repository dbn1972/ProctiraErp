import type {
  MealMenuEntity,
  MealServingEntity,
  CanteenRepository,
} from './canteen-repository.js';

export class InMemoryCanteenRepository implements CanteenRepository {
  private readonly mealMenus = new Map<string, MealMenuEntity>();
  private readonly mealServings = new Map<string, MealServingEntity>();

  async listMealMenus(tenantId: string) {
    return [...this.mealMenus.values()].filter((x) => x.tenantId === tenantId);
  }
  async getMealMenu(tenantId: string, id: string) {
    const row = this.mealMenus.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createMealMenu(row: MealMenuEntity) {
    this.mealMenus.set(row.id, row);
    return row;
  }
  async updateMealMenu(tenantId: string, id: string, patch: Partial<MealMenuEntity>) {
    const cur = await this.getMealMenu(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.mealMenus.set(id, next);
    return next;
  }
  async listMealServings(tenantId: string) {
    return [...this.mealServings.values()].filter((x) => x.tenantId === tenantId);
  }
  async getMealServing(tenantId: string, id: string) {
    const row = this.mealServings.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createMealServing(row: MealServingEntity) {
    this.mealServings.set(row.id, row);
    return row;
  }
  async updateMealServing(tenantId: string, id: string, patch: Partial<MealServingEntity>) {
    const cur = await this.getMealServing(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.mealServings.set(id, next);
    return next;
  }
}
