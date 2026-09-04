import { randomUUID } from 'node:crypto';
import type {
  MealMenuEntity,
  MealServingEntity,
  CanteenRepository,
} from './canteen-repository.js';

export class CanteenService {
  constructor(private readonly repo: CanteenRepository) {}

  listMealMenus(tenantId: string) {
    return this.repo.listMealMenus(tenantId);
  }
  getMealMenu(tenantId: string, id: string) {
    return this.repo.getMealMenu(tenantId, id);
  }
  createMealMenu(
    tenantId: string,
    input: Omit<MealMenuEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createMealMenu({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as MealMenuEntity);
  }
  updateMealMenu(tenantId: string, id: string, patch: Partial<MealMenuEntity>) {
    return this.repo.updateMealMenu(tenantId, id, patch);
  }
  listMealServings(tenantId: string) {
    return this.repo.listMealServings(tenantId);
  }
  getMealServing(tenantId: string, id: string) {
    return this.repo.getMealServing(tenantId, id);
  }
  createMealServing(
    tenantId: string,
    input: Omit<MealServingEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createMealServing({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as MealServingEntity);
  }
  updateMealServing(tenantId: string, id: string, patch: Partial<MealServingEntity>) {
    return this.repo.updateMealServing(tenantId, id, patch);
  }
}
