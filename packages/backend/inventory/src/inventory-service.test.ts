import { describe, expect, it } from 'vitest';
import { InMemoryInventoryRepository } from './in-memory-repository.js';
import { InventoryService } from './inventory-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('InventoryService', () => {
  it('creates and lists InventoryItem', async () => {
    const service = new InventoryService(new InMemoryInventoryRepository());
    const created = await service.createInventoryItem(tenantId, {
      sku: 'sample',
      name: 'sample',
      unit: 'ea',
      quantityOnHand: 0,
      reorderLevel: 0,
      status: 'active',
    } as any);
    expect(created.id).toBeTruthy();
    const rows = await service.listInventoryItems(tenantId);
    expect(rows).toHaveLength(1);
  });
});
