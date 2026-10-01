/**
 * Area hierarchy integrity (PRC-L550): no self-parent, no cycles, consistent levels,
 * and hierarchy traversal terminates even on corrupt data.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { DataWarehouseService } from './data-warehouse-service.js';
import { InMemoryGISRepository } from './in-memory-gis-repository.js';
import { InMemoryWarehouseRepository } from './in-memory-repository.js';

const T = 'tenant-1';

describe('area hierarchy integrity (PRC-L550)', () => {
  let repo: InMemoryWarehouseRepository;
  let service: DataWarehouseService;
  let wh: string;

  beforeEach(async () => {
    repo = new InMemoryWarehouseRepository();
    service = new DataWarehouseService(repo, { maxImportBatchSize: 100 });
    wh = (await service.createWarehouse(T, { name: 'DW' })).id;
  });

  async function chain() {
    const root = await service.createArea(T, wh, { name: 'IN', areaId: 'IN', gid: 'IN', level: 0 });
    const mid = await service.createArea(T, wh, {
      name: 'MH',
      areaId: 'MH',
      gid: 'MH',
      level: 1,
      parentId: root.id,
    });
    const leaf = await service.createArea(T, wh, {
      name: 'PUN',
      areaId: 'PUN',
      gid: 'PUN',
      level: 2,
      parentId: mid.id,
    });
    return { root, mid, leaf };
  }

  it('rejects self-parent with 409', async () => {
    const { mid } = await chain();
    await expect(service.updateArea(T, wh, mid.id, { parentId: mid.id })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('rejects making a descendant the parent (cycle) with 409', async () => {
    const { root, leaf } = await chain();
    await expect(
      service.updateArea(T, wh, root.id, { parentId: leaf.id, level: 3 }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects a child level that is not parent.level + 1', async () => {
    const { root } = await chain();
    await expect(
      service.createArea(T, wh, { name: 'X', areaId: 'X', gid: 'X', level: 3, parentId: root.id }),
    ).rejects.toMatchObject({ statusCode: 400 });
    const { leaf } = { leaf: (await repo.findAreaByExternalId('PUN', wh, T))! };
    await expect(service.updateArea(T, wh, leaf.id, { level: 5 })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('allows a valid re-parent', async () => {
    const { root, leaf } = await chain();
    const updated = await service.updateArea(T, wh, leaf.id, { parentId: root.id, level: 1 });
    expect(updated.parentId).toBe(root.id);
  });

  it('hierarchy traversal terminates on a corrupt cycle', async () => {
    const { root, leaf } = await chain();
    // Simulate pre-existing corrupt data written directly to the repository.
    await repo.updateArea(root.id, wh, T, { parentId: leaf.id });
    const gis = new InMemoryGISRepository(repo);
    const layers = await gis.findLayersByAreaHierarchy(wh, T, root.id);
    expect(layers).toEqual([]);
  });
});
