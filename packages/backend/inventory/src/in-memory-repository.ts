import type {
  InventoryItemEntity,
  StockMovementEntity,
  InventoryRepository,
} from './inventory-repository.js';

export class InMemoryInventoryRepository implements InventoryRepository {
  private readonly inventoryItems = new Map<string, InventoryItemEntity>();
  private readonly stockMovements = new Map<string, StockMovementEntity>();

  async listInventoryItems(tenantId: string) {
    return [...this.inventoryItems.values()].filter((x) => x.tenantId === tenantId);
  }
  async getInventoryItem(tenantId: string, id: string) {
    const row = this.inventoryItems.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createInventoryItem(row: InventoryItemEntity) {
    this.inventoryItems.set(row.id, row);
    return row;
  }
  async updateInventoryItem(tenantId: string, id: string, patch: Partial<InventoryItemEntity>) {
    const cur = await this.getInventoryItem(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.inventoryItems.set(id, next);
    return next;
  }
  async listStockMovements(tenantId: string) {
    return [...this.stockMovements.values()].filter((x) => x.tenantId === tenantId);
  }
  async getStockMovement(tenantId: string, id: string) {
    const row = this.stockMovements.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createStockMovement(row: StockMovementEntity) {
    this.stockMovements.set(row.id, row);
    return row;
  }
  async updateStockMovement(tenantId: string, id: string, patch: Partial<StockMovementEntity>) {
    const cur = await this.getStockMovement(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.stockMovements.set(id, next);
    return next;
  }
}
