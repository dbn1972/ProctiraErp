/**
 * PRC-L552 (review follow-up): GISService and PublishingService are exported
 * and take a WarehouseRepository directly, so they must apply the same
 * tenant re-check wrapper as DataWarehouseService. A repository whose
 * lookups ignore the tenant argument must not let tenant B reach tenant A's
 * warehouse or area through either service.
 */
import { NotFoundError } from '@proctira/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { DataWarehouseService } from './data-warehouse-service.js';
import { GISService } from './gis-service.js';
import { InMemoryGISRepository } from './in-memory-gis-repository.js';
import { InMemoryWarehouseRepository } from './in-memory-repository.js';
import { PublishingService } from './publishing-service.js';
import type { Area, Warehouse } from './schemas.js';
const OWNER = 'tenant-a';
const OTHER = 'tenant-b';
/** Lookups ignore the caller tenant and always answer as the owning tenant. */
class LeakyRepository extends InMemoryWarehouseRepository {
  override async findWarehouseById(id: string): Promise<Warehouse | null> {
    return super.findWarehouseById(id, OWNER);
  }
  override async findAreaById(id: string, warehouseId: string): Promise<Area | null> {
    return super.findAreaById(id, warehouseId, OWNER);
  }
}
describe('PRC-L552 GIS and publishing services re-check the repository tenant', () => {
  let repo: LeakyRepository;
  let warehouseId: string;
  let areaId: string;
  beforeEach(async () => {
    repo = new LeakyRepository();
    const owner = new DataWarehouseService(repo, { maxImportBatchSize: 10 });
    warehouseId = (await owner.createWarehouse(OWNER, { name: 'A-DW' })).id;
    areaId = (
      await owner.createArea(OWNER, warehouseId, {
        name: 'India',
        areaId: 'IND',
        gid: 'AREA_IND',
        level: 0,
      })
    ).id;
  });
  it('GISService treats a foreign-tenant area as not found', async () => {
    const gis = new GISService(new InMemoryGISRepository(repo), repo, {
      maxLayerFileSize: 1024 * 1024,
      supportedCRS: ['EPSG:4326'],
    });
    await expect(gis.getLayersByAreaHierarchy(OTHER, warehouseId, areaId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(gis.getLayersByAreaHierarchy(OWNER, warehouseId, areaId)).resolves.toEqual([]);
  });
  it('PublishingService treats a foreign-tenant warehouse as not found', async () => {
    const publishing = new PublishingService(repo, null, null, {
      apiBaseUrl: 'https://api.example.test',
      webBaseUrl: 'https://web.example.test',
      mobileBaseUrl: 'https://mobile.example.test',
    });
    await expect(
      publishing.publishData(OTHER, warehouseId, { target: 'api' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
