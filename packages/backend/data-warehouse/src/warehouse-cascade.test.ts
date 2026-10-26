/**
 * PRC-L453 — deleting a warehouse removes its children (dimensions, data records, GIS layers,
 * translations) and leaves other warehouses' / tenants' children intact.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { DataWarehouseService } from './data-warehouse-service.js';
import { GISService } from './gis-service.js';
import { InMemoryGISRepository } from './in-memory-gis-repository.js';
import { InMemoryWarehouseRepository } from './in-memory-repository.js';
import { InMemoryTranslationRepository } from './in-memory-translation-repository.js';
import { TranslationService } from './translation-service.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const geojson = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: {},
    },
  ],
});

describe('deleteWarehouse cascades to children (PRC-L453)', () => {
  let repo: InMemoryWarehouseRepository;
  let gisRepo: InMemoryGISRepository;
  let translationRepo: InMemoryTranslationRepository;
  let dw: DataWarehouseService;
  let gis: GISService;
  let translations: TranslationService;

  beforeEach(() => {
    repo = new InMemoryWarehouseRepository();
    gisRepo = new InMemoryGISRepository(repo);
    translationRepo = new InMemoryTranslationRepository();
    dw = new DataWarehouseService(
      repo,
      { maxImportBatchSize: 100 },
      { gisRepository: gisRepo, translationRepository: translationRepo },
    );
    gis = new GISService(gisRepo, repo, {
      maxLayerFileSize: 1024 * 1024,
      supportedCRS: ['EPSG:4326'],
    });
    translations = new TranslationService(translationRepo, repo, {
      supportedLanguages: ['en', 'fr'],
      maxImportBatchSize: 100,
    });
  });

  async function seed(tenantId: string, name: string) {
    const warehouseId = (await dw.createWarehouse(tenantId, { name })).id;
    const indicator = await dw.createIndicator(tenantId, warehouseId, { name: 'I', gid: 'I1' });
    const unit = await dw.createUnit(tenantId, warehouseId, { name: 'U', gid: 'U1' });
    const subgroup = await dw.createSubgroup(tenantId, warehouseId, { name: 'S', gid: 'S1' });
    const period = await dw.createTimePeriod(tenantId, warehouseId, { timePeriod: '2024' });
    const area = await dw.createArea(tenantId, warehouseId, {
      name: 'A',
      areaId: 'A1',
      gid: 'A1',
      level: 0,
    });
    const imported = await dw.importData(tenantId, warehouseId, 'csv', {
      records: [
        {
          indicatorGid: 'I1',
          unitGid: 'U1',
          subgroupGid: 'S1',
          areaId: 'A1',
          timePeriod: '2024',
          dataValue: 1,
        },
      ],
    });
    expect(imported.successCount).toBe(1);
    const layer = await gis.createLayer(tenantId, warehouseId, {
      areaId: area.id,
      name: 'L',
      layerType: 'geojson',
      data: geojson,
      crs: 'EPSG:4326',
    });
    await translations.setTranslation(tenantId, warehouseId, {
      entityType: 'indicator',
      entityId: indicator.id,
      language: 'fr',
      field: 'name',
      value: 'Indicateur',
    });
    return { tenantId, warehouseId, indicator, unit, subgroup, period, area, layer };
  }

  async function children(s: Awaited<ReturnType<typeof seed>>) {
    const { tenantId: t, warehouseId: w } = s;
    return {
      indicator: await repo.findIndicatorById(s.indicator.id, w, t),
      unit: await repo.findUnitById(s.unit.id, w, t),
      subgroup: await repo.findSubgroupById(s.subgroup.id, w, t),
      period: await repo.findTimePeriodById(s.period.id, w, t),
      area: await repo.findAreaById(s.area.id, w, t),
      records: (await repo.queryData(w, t, {}, 1, 100)).total,
      layer: await gisRepo.findLayerById(s.layer.id, w, t),
      translations: (
        await translationRepo.getTranslationsForEntity(w, t, 'indicator', s.indicator.id)
      ).length,
    };
  }

  it('removes every child of the deleted warehouse', async () => {
    const target = await seed(TENANT_A, 'target');
    expect(await children(target)).toMatchObject({ records: 1, translations: 1 });

    await dw.deleteWarehouse(TENANT_A, target.warehouseId);

    expect(await children(target)).toEqual({
      indicator: null,
      unit: null,
      subgroup: null,
      period: null,
      area: null,
      records: 0,
      layer: null,
      translations: 0,
    });
  });

  it("keeps another warehouse's and another tenant's children", async () => {
    const target = await seed(TENANT_A, 'target');
    const sibling = await seed(TENANT_A, 'sibling');
    const otherTenant = await seed(TENANT_B, 'other');

    await dw.deleteWarehouse(TENANT_A, target.warehouseId);

    for (const kept of [sibling, otherTenant]) {
      const c = await children(kept);
      expect(c.indicator).not.toBeNull();
      expect(c.unit).not.toBeNull();
      expect(c.subgroup).not.toBeNull();
      expect(c.period).not.toBeNull();
      expect(c.area).not.toBeNull();
      expect(c.records).toBe(1);
      expect(c.layer).not.toBeNull();
      expect(c.translations).toBe(1);
    }
  });

  it('only removes children of the deleting tenant', async () => {
    const target = await seed(TENANT_A, 'target');
    // A tenant-B row that (incorrectly) carries tenant A's warehouse id must survive.
    const now = new Date();
    await repo.createIndicator({
      id: 'foreign-indicator',
      warehouseId: target.warehouseId,
      tenantId: TENANT_B,
      name: 'X',
      gid: 'X1',
      shortName: null,
      keywords: null,
      info: null,
      highIsGood: true,
      createdAt: now,
      updatedAt: now,
    });

    await dw.deleteWarehouse(TENANT_A, target.warehouseId);

    expect(
      await repo.findIndicatorById('foreign-indicator', target.warehouseId, TENANT_B),
    ).not.toBeNull();
  });
});
