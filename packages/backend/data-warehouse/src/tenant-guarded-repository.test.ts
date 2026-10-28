/**
 * PRC-L552 (topic 4 Option A: repositories check the caller tenant):
 * the service no longer trusts a repository implementation to honour the
 * tenant argument. A repository that ignores `tenantId` (a buggy or future
 * SQL adapter missing its predicate) must not leak another tenant's rows, and
 * a missing tenant or a re-parenting update fails closed.
 */
import { NotFoundError } from '@proctira/common';
import { describe, expect, it } from 'vitest';
import { DataWarehouseService } from './data-warehouse-service.js';
import { InMemoryWarehouseRepository } from './in-memory-repository.js';
import type { Warehouse } from './schemas.js';
/** A repository whose lookups ignore the tenant argument entirely. */
class LeakyRepository extends InMemoryWarehouseRepository {
  private readonly rows = new Map<string, Warehouse>();
  override async createWarehouse(w: Warehouse): Promise<Warehouse> {
    this.rows.set(w.id, { ...w });
    return { ...w };
  }
  override async findWarehouseById(id: string): Promise<Warehouse | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }
  override async listWarehouses(): Promise<{ data: Warehouse[]; total: number }> {
    const data = [...this.rows.values()];
    return { data, total: data.length };
  }
  override async updateWarehouse(
    id: string,
    _tenantId: string,
    updates: Partial<Warehouse>,
  ): Promise<Warehouse> {
    const row = { ...this.rows.get(id)!, ...updates };
    this.rows.set(id, row);
    return { ...row };
  }
}
const CFG = { maxImportBatchSize: 10 };
describe('PRC-L552 data-warehouse repository tenant defence in depth', () => {
  it('a foreign-tenant row returned by a leaky repository is treated as not found', async () => {
    const service = new DataWarehouseService(new LeakyRepository(), CFG);
    const a = await service.createWarehouse('tenant-a', { name: 'A' });
    await expect(service.getWarehouse('tenant-b', a.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.updateWarehouse('tenant-b', a.id, { name: 'pwned' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await service.getWarehouse('tenant-a', a.id)).name).toBe('A');
  });
  it('a list containing a foreign-tenant row fails closed instead of returning it', async () => {
    const service = new DataWarehouseService(new LeakyRepository(), CFG);
    await service.createWarehouse('tenant-a', { name: 'A' });
    await expect(service.listWarehouses('tenant-b', {}, 1, 20)).rejects.toThrow(/tenant/i);
  });
  it('missing tenant fails closed before the repository is called', async () => {
    const service = new DataWarehouseService(new InMemoryWarehouseRepository(), CFG);
    await expect(service.listWarehouses('', {}, 1, 20)).rejects.toThrow(/tenant/i);
    await expect(service.createWarehouse('  ', { name: 'X' })).rejects.toThrow(/tenant/i);
  });
  it('the in-memory repository keeps working through the guard (same-tenant path)', async () => {
    const service = new DataWarehouseService(new InMemoryWarehouseRepository(), CFG);
    const a = await service.createWarehouse('tenant-a', { name: 'A' });
    const list = await service.listWarehouses('tenant-a', {}, 1, 20);
    expect(list.data.map((w) => w.id)).toEqual([a.id]);
    expect((await service.listWarehouses('tenant-b', {}, 1, 20)).data).toHaveLength(0);
  });
});
