/**
 * Parse failures must surface as validation errors (PRC-L456).
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { DataWarehouseService } from './data-warehouse-service.js';
import { GISService } from './gis-service.js';
import { InMemoryGISRepository } from './in-memory-gis-repository.js';
import { InMemoryWarehouseRepository } from './in-memory-repository.js';
import { InMemoryTranslationRepository } from './in-memory-translation-repository.js';
import { TranslationService } from './translation-service.js';

const T = 'tenant-1';

describe('GIS / translation parse failures (PRC-L456)', () => {
  let repo: InMemoryWarehouseRepository;
  let gis: GISService;
  let tr: TranslationService;
  let wh: string;
  let areaId: string;

  beforeEach(async () => {
    repo = new InMemoryWarehouseRepository();
    const dw = new DataWarehouseService(repo, { maxImportBatchSize: 100 });
    wh = (await dw.createWarehouse(T, { name: 'DW' })).id;
    areaId = (await dw.createArea(T, wh, { name: 'A', areaId: 'A', gid: 'A', level: 0 })).id;
    gis = new GISService(new InMemoryGISRepository(repo), repo, {
      maxLayerFileSize: 1_000_000,
      supportedCRS: ['EPSG:4326'],
    });
    tr = new TranslationService(new InMemoryTranslationRepository(), repo, {
      supportedLanguages: ['en', 'fr'],
      maxImportBatchSize: 100,
    });
  });

  it('rejects unparseable GeoJSON with 400', async () => {
    await expect(
      gis.createLayer(T, wh, { areaId, name: 'x', layerType: 'geojson', data: '{not json' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects features lacking geometry with 400', async () => {
    const data = JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: null, properties: {} }],
    });
    await expect(
      gis.createLayer(T, wh, { areaId, name: 'x', layerType: 'geojson', data }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects unparseable shapefile payload with 400', async () => {
    await expect(
      gis.createLayer(T, wh, {
        areaId,
        name: 'x',
        layerType: 'shapefile',
        data: Buffer.from('garbage').toString('base64'),
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('still accepts a valid FeatureCollection', async () => {
    const data = JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] } }],
    });
    const layer = await gis.createLayer(T, wh, { areaId, name: 'ok', layerType: 'geojson', data });
    expect(layer.featureCount).toBe(1);
  });

  it('reports a CSV translation row with a blank value as a row error', async () => {
    const content = [
      'entityType,entityId,language,field,value',
      `area,${areaId},fr,name,Zone`,
      `area,${areaId},fr,description,`,
    ].join('\r\n');
    const result = await tr.importTranslations(T, wh, { format: 'csv', content });
    expect(result.totalRows).toBe(2);
    expect(result.successCount).toBe(1);
    expect(result.errorCount).toBe(1);
    expect(result.errors[0]).toMatchObject({ row: 2 });
  });
});

describe('GIS CRS validation (PRC-L457, partial)', () => {
  it('rejects a CRS outside supportedCRS with 400 on create and update', async () => {
    const repo = new InMemoryWarehouseRepository();
    const dw = new DataWarehouseService(repo, { maxImportBatchSize: 100 });
    const wh = (await dw.createWarehouse(T, { name: 'DW' })).id;
    const areaId = (await dw.createArea(T, wh, { name: 'A', areaId: 'A', gid: 'A', level: 0 })).id;
    const gis = new GISService(new InMemoryGISRepository(repo), repo, {
      maxLayerFileSize: 1_000_000,
      supportedCRS: ['EPSG:4326', 'EPSG:3857'],
    });
    await expect(
      gis.createLayer(T, wh, { areaId, name: 'x', layerType: 'geojson', crs: 'EPSG:9999' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    const layer = await gis.createLayer(T, wh, {
      areaId,
      name: 'ok',
      layerType: 'geojson',
      crs: 'EPSG:3857',
    });
    expect(layer.crs).toBe('EPSG:3857');
    await expect(gis.updateLayer(T, wh, layer.id, { crs: 'BOGUS' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
