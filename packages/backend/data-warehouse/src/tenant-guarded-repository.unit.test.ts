/**
 * PRC-L552: unit checks of the tenant guard itself (re-parenting updates and
 * creates without an owning tenant are refused).
 */
import { describe, expect, it } from 'vitest';
import { InMemoryWarehouseRepository } from './in-memory-repository.js';
import { guardWarehouseRepository } from './tenant-guarded-repository.js';
describe('PRC-L552 guardWarehouseRepository', () => {
  it('an update cannot re-parent a row to another tenant', async () => {
    const guarded = guardWarehouseRepository(new InMemoryWarehouseRepository());
    const now = new Date();
    await guarded.createWarehouse({
      id: 'w-1',
      tenantId: 'tenant-a',
      name: 'A',
      description: null,
      defaultLanguage: 'en',
      createdAt: now,
      updatedAt: now,
    });
    await expect(
      guarded.updateWarehouse('w-1', 'tenant-a', { tenantId: 'tenant-b' }),
    ).rejects.toThrow(/tenant/i);
    expect((await guarded.findWarehouseById('w-1', 'tenant-a'))?.tenantId).toBe('tenant-a');
  });
  it('refuses to create a row without an owning tenant', async () => {
    const guarded = guardWarehouseRepository(new InMemoryWarehouseRepository());
    const now = new Date();
    await expect(
      guarded.createIndicator({
        id: 'i-1',
        warehouseId: 'w-1',
        tenantId: '',
        gid: 'g',
        name: 'n',
        createdAt: now,
        updatedAt: now,
      } as never),
    ).rejects.toThrow(/tenant/i);
  });
});
