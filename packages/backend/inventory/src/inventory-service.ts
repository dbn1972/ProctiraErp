import { randomUUID } from 'node:crypto';
import type {
  InventoryItemEntity,
  StockMovementEntity,
  InventoryRepository,
} from './inventory-repository.js';

export class InventoryService {
  constructor(private readonly repo: InventoryRepository) {}

  listInventoryItems(tenantId: string) {
    return this.repo.listInventoryItems(tenantId);
  }
  getInventoryItem(tenantId: string, id: string) {
    return this.repo.getInventoryItem(tenantId, id);
  }
  createInventoryItem(
    tenantId: string,
    input: Omit<InventoryItemEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createInventoryItem({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as InventoryItemEntity);
  }
  updateInventoryItem(tenantId: string, id: string, patch: Partial<InventoryItemEntity>) {
    return this.repo.updateInventoryItem(tenantId, id, patch);
  }
  listStockMovements(tenantId: string) {
    return this.repo.listStockMovements(tenantId);
  }
  getStockMovement(tenantId: string, id: string) {
    return this.repo.getStockMovement(tenantId, id);
  }
  createStockMovement(
    tenantId: string,
    input: Omit<StockMovementEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createStockMovement({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as StockMovementEntity);
  }
  updateStockMovement(tenantId: string, id: string, patch: Partial<StockMovementEntity>) {
    return this.repo.updateStockMovement(tenantId, id, patch);
  }
}
