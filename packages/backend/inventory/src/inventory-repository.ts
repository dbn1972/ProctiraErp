/** Inventory repository ports (P22). */

export interface InventoryItemEntity {
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

export interface StockMovementEntity {
  id: string;
  tenantId: string;
  itemId: string;
  movementType: string;
  quantity: number;
  issuedToStaffId: string | null;
  notes: string | null;
  movedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryRepository {
  listInventoryItems(tenantId: string): Promise<InventoryItemEntity[]>;
  getInventoryItem(tenantId: string, id: string): Promise<InventoryItemEntity | null>;
  createInventoryItem(row: InventoryItemEntity): Promise<InventoryItemEntity>;
  updateInventoryItem(tenantId: string, id: string, patch: Partial<InventoryItemEntity>): Promise<InventoryItemEntity | null>;
  listStockMovements(tenantId: string): Promise<StockMovementEntity[]>;
  getStockMovement(tenantId: string, id: string): Promise<StockMovementEntity | null>;
  createStockMovement(row: StockMovementEntity): Promise<StockMovementEntity>;
  updateStockMovement(tenantId: string, id: string, patch: Partial<StockMovementEntity>): Promise<StockMovementEntity | null>;
}
