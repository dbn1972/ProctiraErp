import type { PrismaClient } from '@proctira/database';
import type {
  MealMenuEntity,
  MealServingEntity,
  CanteenRepository,
} from './canteen-repository.js';

function iso(v: Date | string) {
  return v instanceof Date ? v.toISOString() : v;
}

export class PrismaCanteenRepository implements CanteenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listMealMenus(tenantId: string) {
    const rows = await (this.prisma as any).mealMenu.findMany({ where: { tenantId } });
    return rows.map(mapMealMenu);
  }
  async getMealMenu(tenantId: string, id: string) {
    const row = await (this.prisma as any).mealMenu.findFirst({ where: { id, tenantId } });
    return row ? mapMealMenu(row) : null;
  }
  async createMealMenu(row: MealMenuEntity) {
    const created = await (this.prisma as any).mealMenu.create({ data: toMealMenu(row) });
    return mapMealMenu(created);
  }
  async updateMealMenu(tenantId: string, id: string, patch: Partial<MealMenuEntity>) {
    const existing = await this.getMealMenu(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).mealMenu.update({
      where: { id },
      data: toMealMenu({ ...existing, ...patch, id, tenantId }),
    });
    return mapMealMenu(updated);
  }
  async listMealServings(tenantId: string) {
    const rows = await (this.prisma as any).mealServing.findMany({ where: { tenantId } });
    return rows.map(mapMealServing);
  }
  async getMealServing(tenantId: string, id: string) {
    const row = await (this.prisma as any).mealServing.findFirst({ where: { id, tenantId } });
    return row ? mapMealServing(row) : null;
  }
  async createMealServing(row: MealServingEntity) {
    const created = await (this.prisma as any).mealServing.create({ data: toMealServing(row) });
    return mapMealServing(created);
  }
  async updateMealServing(tenantId: string, id: string, patch: Partial<MealServingEntity>) {
    const existing = await this.getMealServing(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).mealServing.update({
      where: { id },
      data: toMealServing({ ...existing, ...patch, id, tenantId }),
    });
    return mapMealServing(updated);
  }
}

function mapMealMenu(row: any): MealMenuEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    institutionId: row.institutionId,
    date: row.date,
    mealType: row.mealType,
    items: row.items,
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toMealMenu(row: MealMenuEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    institutionId: row.institutionId,
    date: row.date,
    mealType: row.mealType,
    items: row.items,
    status: row.status,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
function mapMealServing(row: any): MealServingEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    menuId: row.menuId,
    institutionId: row.institutionId,
    servedCount: row.servedCount,
    wastageCount: row.wastageCount,
    servedAt: row.servedAt,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toMealServing(row: MealServingEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    menuId: row.menuId,
    institutionId: row.institutionId,
    servedCount: row.servedCount,
    wastageCount: row.wastageCount,
    servedAt: row.servedAt,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
