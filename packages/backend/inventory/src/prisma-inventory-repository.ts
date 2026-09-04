import type { PrismaClient } from '@proctira/database';
import type {
  InventoryItemEntity,
  StockMovementEntity,
  InventoryRepository,
} from './inventory-repository.js';

function iso(v: Date | string) {
  return v instanceof Date ? v.toISOString() : v;
}

export class PrismaInventoryRepository implements InventoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listInventoryItems(tenantId: string) {
    const rows = await (this.prisma as any).inventoryItem.findMany({ where: { tenantId } });
    return rows.map(mapInventoryItem);
  }
  async getInventoryItem(tenantId: string, id: string) {
    const row = await (this.prisma as any).inventoryItem.findFirst({ where: { id, tenantId } });
    return row ? mapInventoryItem(row) : null;
  }
  async createInventoryItem(row: InventoryItemEntity) {
    const created = await (this.prisma as any).inventoryItem.create({ data: toInventoryItem(row) });
    return mapInventoryItem(created);
  }
  async updateInventoryItem(tenantId: string, id: string, patch: Partial<InventoryItemEntity>) {
    const existing = await this.getInventoryItem(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).inventoryItem.update({
      where: { id },
      data: toInventoryItem({ ...existing, ...patch, id, tenantId }),
    });
    return mapInventoryItem(updated);
  }
  async listStockMovements(tenantId: string) {
    const rows = await (this.prisma as any).stockMovement.findMany({ where: { tenantId } });
    return rows.map(mapStockMovement);
  }
  async getStockMovement(tenantId: string, id: string) {
    const row = await (this.prisma as any).stockMovement.findFirst({ where: { id, tenantId } });
    return row ? mapStockMovement(row) : null;
  }
  async createStockMovement(row: StockMovementEntity) {
    const created = await (this.prisma as any).stockMovement.create({ data: toStockMovement(row) });
    return mapStockMovement(created);
  }
  async updateStockMovement(tenantId: string, id: string, patch: Partial<StockMovementEntity>) {
    const existing = await this.getStockMovement(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).stockMovement.update({
      where: { id },
      data: toStockMovement({ ...existing, ...patch, id, tenantId }),
    });
    return mapStockMovement(updated);
  }
}

function mapInventoryItem(row: any): InventoryItemEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    institutionId: row.institutionId ?? null,
    sku: row.sku,
    name: row.name,
    unit: row.unit,
    quantityOnHand: row.quantityOnHand,
    reorderLevel: row.reorderLevel,
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toInventoryItem(row: InventoryItemEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    institutionId: row.institutionId ?? null,
    sku: row.sku,
    name: row.name,
    unit: row.unit,
    quantityOnHand: row.quantityOnHand,
    reorderLevel: row.reorderLevel,
    status: row.status,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
function mapStockMovement(row: any): StockMovementEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    itemId: row.itemId,
    movementType: row.movementType,
    quantity: row.quantity,
    issuedToStaffId: row.issuedToStaffId ?? null,
    notes: row.notes ?? null,
    movedAt: row.movedAt,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toStockMovement(row: StockMovementEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    itemId: row.itemId,
    movementType: row.movementType,
    quantity: row.quantity,
    issuedToStaffId: row.issuedToStaffId ?? null,
    notes: row.notes ?? null,
    movedAt: row.movedAt,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
