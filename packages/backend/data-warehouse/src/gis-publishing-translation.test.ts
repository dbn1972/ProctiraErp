/**
 * GIS, Publishing, and Translation Service Tests
 *
 * Tests for:
 * - GIS layer management (Shapefile/GeoJSON) linked to area hierarchies [Req 15.3]
 * - Data publishing to mobile, web, and API endpoints [Req 15.4]
 * - Multi-language metadata with translation import/export [Req 15.5]
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundError } from '@proctira/common';

import { DataWarehouseService } from './data-warehouse-service.js';
import { GISService } from './gis-service.js';
import { PublishingService } from './publishing-service.js';
import { TranslationService } from './translation-service.js';
import { InMemoryWarehouseRepository } from './in-memory-repository.js';
import { InMemoryGISRepository } from './in-memory-gis-repository.js';
import { InMemoryTranslationRepository } from './in-memory-translation-repository.js';

const tenantId = 'tenant-001';

describe('GIS Service (Requirement 15.3)', () => {
  let warehouseService: DataWarehouseService;
  let gisService: GISService;
  let warehouseRepo: InMemoryWarehouseRepository;
  let gisRepo: InMemoryGISRepository;
  let warehouseId: string;
  let areaId: string;

  beforeEach(async () => {
    warehouseRepo = new InMemoryWarehouseRepository();
    gisRepo = new InMemoryGISRepository(warehouseRepo);
    warehouseService = new DataWarehouseService(warehouseRepo, { maxImportBatchSize: 10000 });
    gisService = new GISService(gisRepo, warehouseRepo, {
      maxLayerFileSize: 50 * 1024 * 1024,
      supportedCRS: ['EPSG:4326', 'EPSG:3857'],
    });

    const wh = await warehouseService.createWarehouse(tenantId, { name: 'GIS Test DW' });
    warehouseId = wh.id;

    const area = await warehouseService.createArea(tenantId, warehouseId, {
      name: 'India',
      areaId: 'IND',
      gid: 'AREA_IND',
      level: 0,
    });
    areaId = area.id;
  });

  describe('GeoJSON Layer Management', () => {
    it('should create a GeoJSON layer linked to an area', async () => {
      const geojson = JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                  [0, 0],
                ],
              ],
            },
            properties: { name: 'District A' },
          },
        ],
      });

      const layer = await gisService.createLayer(tenantId, warehouseId, {
        areaId,
        name: 'India Districts',
        layerType: 'geojson',
        data: geojson,
        crs: 'EPSG:4326',
        metadata: { source: 'Census 2021' },
      });

      expect(layer.id).toBeDefined();
      expect(layer.name).toBe('India Districts');
      expect(layer.layerType).toBe('geojson');
      expect(layer.areaId).toBe(areaId);
      expect(layer.crs).toBe('EPSG:4326');
      expect(layer.featureCount).toBe(1);
      expect(layer.features.length).toBe(1);
      expect(layer.features[0]!.type).toBe('Polygon');
      expect(layer.isActive).toBe(true);
      expect(layer.metadata).toEqual({ source: 'Census 2021' });
    });

    it('should create a GeoJSON layer from base64-encoded data', async () => {
      const geojson = JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [77.5, 12.9] },
            properties: { name: 'Bangalore' },
          },
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [72.8, 19.0] },
            properties: { name: 'Mumbai' },
          },
        ],
      });
      const base64Data = Buffer.from(geojson).toString('base64');

      const layer = await gisService.createLayer(tenantId, warehouseId, {
        areaId,
        name: 'Cities',
        layerType: 'geojson',
        data: base64Data,
      });

      expect(layer.featureCount).toBe(2);
      expect(layer.features[0]!.type).toBe('Point');
    });

    it('should reject layer creation for non-existent warehouse', async () => {
      await expect(
        gisService.createLayer(tenantId, '00000000-0000-4000-8000-000000000000', {
          areaId,
          name: 'Test',
          layerType: 'geojson',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('should reject layer creation for non-existent area', async () => {
      await expect(
        gisService.createLayer(tenantId, warehouseId, {
          areaId: '00000000-0000-4000-8000-000000000000',
          name: 'Test',
          layerType: 'geojson',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('should handle empty GeoJSON data gracefully', async () => {
      const layer = await gisService.createLayer(tenantId, warehouseId, {
        areaId,
        name: 'Empty Layer',
        layerType: 'geojson',
      });

      expect(layer.featureCount).toBe(0);
      expect(layer.features).toEqual([]);
    });
  });

  describe('Shapefile Layer Management', () => {
    it('should create a Shapefile layer from base64-encoded GeoJSON representation', async () => {
      const shapeData = JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'MultiPolygon',
              coordinates: [
                [
                  [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 1],
                    [0, 0],
                  ],
                ],
              ],
            },
            properties: { name: 'State A', code: 'SA' },
          },
        ],
      });
      const base64Data = Buffer.from(shapeData).toString('base64');

      const layer = await gisService.createLayer(tenantId, warehouseId, {
        areaId,
        name: 'State Boundaries',
        layerType: 'shapefile',
        data: base64Data,
        crs: 'EPSG:4326',
      });

      expect(layer.layerType).toBe('shapefile');
      expect(layer.featureCount).toBe(1);
      expect(layer.features[0]!.type).toBe('MultiPolygon');
    });
  });

  describe('Layer CRUD Operations', () => {
    it('should get a layer by ID', async () => {
      const geojson = JSON.stringify({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: {},
      });
      const created = await gisService.createLayer(tenantId, warehouseId, {
        areaId,
        name: 'Test Layer',
        layerType: 'geojson',
        data: geojson,
      });

      const fetched = await gisService.getLayer(tenantId, warehouseId, created.id);
      expect(fetched.name).toBe('Test Layer');
    });

    it('should throw NotFoundError for non-existent layer', async () => {
      await expect(
        gisService.getLayer(tenantId, warehouseId, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow(NotFoundError);
    });

    it('should update a layer', async () => {
      const created = await gisService.createLayer(tenantId, warehouseId, {
        areaId,
        name: 'Old Name',
        layerType: 'geojson',
      });

      const updated = await gisService.updateLayer(tenantId, warehouseId, created.id, {
        name: 'New Name',
        metadata: { version: '2.0' },
      });

      expect(updated.name).toBe('New Name');
      expect(updated.metadata).toEqual({ version: '2.0' });
    });

    it('should deactivate a layer', async () => {
      const created = await gisService.createLayer(tenantId, warehouseId, {
        areaId,
        name: 'Active Layer',
        layerType: 'geojson',
      });

      const updated = await gisService.updateLayer(tenantId, warehouseId, created.id, {
        isActive: false,
      });

      expect(updated.isActive).toBe(false);
    });

    it('should delete a layer', async () => {
      const created = await gisService.createLayer(tenantId, warehouseId, {
        areaId,
        name: 'To Delete',
        layerType: 'geojson',
      });

      await gisService.deleteLayer(tenantId, warehouseId, created.id);
      await expect(gisService.getLayer(tenantId, warehouseId, created.id)).rejects.toThrow(
        NotFoundError,
      );
    });

    it('should list layers with pagination', async () => {
      await gisService.createLayer(tenantId, warehouseId, {
        areaId,
        name: 'Layer 1',
        layerType: 'geojson',
      });
      await gisService.createLayer(tenantId, warehouseId, {
        areaId,
        name: 'Layer 2',
        layerType: 'geojson',
      });
      await gisService.createLayer(tenantId, warehouseId, {
        areaId,
        name: 'Layer 3',
        layerType: 'geojson',
      });

      const result = await gisService.listLayers(tenantId, warehouseId, { page: 1, pageSize: 2 });
      expect(result.data.length).toBe(2);
      expect(result.total).toBe(3);
    });

    it('should filter layers by area', async () => {
      const area2 = await warehouseService.createArea(tenantId, warehouseId, {
        name: 'Karnataka',
        areaId: 'KA',
        gid: 'AREA_KA',
        level: 1,
        parentId: areaId,
      });

      await gisService.createLayer(tenantId, warehouseId, {
        areaId,
        name: 'India Layer',
        layerType: 'geojson',
      });
      await gisService.createLayer(tenantId, warehouseId, {
        areaId: area2.id,
        name: 'KA Layer',
        layerType: 'geojson',
      });

      const result = await gisService.listLayers(tenantId, warehouseId, { areaId: area2.id });
      expect(result.data.length).toBe(1);
      expect(result.data[0]!.name).toBe('KA Layer');
    });
  });

  describe('Area Hierarchy Linking', () => {
    it('should get layers by area hierarchy (parent and children)', async () => {
      const childArea = await warehouseService.createArea(tenantId, warehouseId, {
        name: 'Maharashtra',
        areaId: 'MH',
        gid: 'AREA_MH',
        level: 1,
        parentId: areaId,
      });

      await gisService.createLayer(tenantId, warehouseId, {
        areaId,
        name: 'India Boundary',
        layerType: 'geojson',
      });
      await gisService.createLayer(tenantId, warehouseId, {
        areaId: childArea.id,
        name: 'MH Boundary',
        layerType: 'geojson',
      });

      const layers = await gisService.getLayersByAreaHierarchy(tenantId, warehouseId, areaId);
      expect(layers.length).toBe(2);
    });

    it('should throw NotFoundError for non-existent area in hierarchy query', async () => {
      await expect(
        gisService.getLayersByAreaHierarchy(
          tenantId,
          warehouseId,
          '00000000-0000-4000-8000-000000000000',
        ),
      ).rejects.toThrow(NotFoundError);
    });
  });
});

describe('Publishing Service (Requirement 15.4)', () => {
  let warehouseService: DataWarehouseService;
  let publishingService: PublishingService;
  let warehouseRepo: InMemoryWarehouseRepository;
  let gisRepo: InMemoryGISRepository;
  let warehouseId: string;

  beforeEach(async () => {
    warehouseRepo = new InMemoryWarehouseRepository();
    gisRepo = new InMemoryGISRepository(warehouseRepo);
    warehouseService = new DataWarehouseService(warehouseRepo, { maxImportBatchSize: 10000 });
    publishingService = new PublishingService(warehouseRepo, gisRepo, null, {
      apiBaseUrl: 'https://api.proctira.org',
      webBaseUrl: 'https://portal.proctira.org',
      mobileBaseUrl: 'https://mobile.proctira.org',
    });

    const wh = await warehouseService.createWarehouse(tenantId, { name: 'Publish Test DW' });
    warehouseId = wh.id;

    // Set up reference data
    await warehouseService.createIndicator(tenantId, warehouseId, { name: 'NER', gid: 'NER_001' });
    await warehouseService.createUnit(tenantId, warehouseId, { name: 'Percent', gid: 'PCT' });
    await warehouseService.createSubgroup(tenantId, warehouseId, {
      name: 'Total',
      gid: 'SG_TOTAL',
    });
    await warehouseService.createTimePeriod(tenantId, warehouseId, { timePeriod: '2023' });
    await warehouseService.createArea(tenantId, warehouseId, {
      name: 'India',
      areaId: 'IND',
      gid: 'AREA_IND',
      level: 0,
    });

    // Import some data
    await warehouseService.importData(tenantId, warehouseId, 'csv', {
      records: [
        {
          indicatorGid: 'NER_001',
          unitGid: 'PCT',
          subgroupGid: 'SG_TOTAL',
          areaId: 'IND',
          timePeriod: '2023',
          dataValue: 95.5,
        },
      ],
    });
  });

  describe('Publish to Mobile', () => {
    it('should publish data for mobile consumption', async () => {
      const result = await publishingService.publishData(tenantId, warehouseId, {
        target: 'mobile',
        language: 'en',
      });

      expect(result.status).toBe('completed');
      expect(result.target).toBe('mobile');
      expect(result.recordCount).toBe(1);
      expect(result.endpoint).toContain('mobile.proctira.org');
      expect(result.payload.data.length).toBe(1);
      expect(result.payload.data[0]!.indicatorGid).toBe('NER_001');
      expect(result.payload.data[0]!.value).toBe(95.5);
    });
  });

  describe('Publish to Web Portal', () => {
    it('should publish data for web portal with full metadata', async () => {
      const result = await publishingService.publishData(tenantId, warehouseId, {
        target: 'web',
        includeMetadata: true,
        language: 'en',
      });

      expect(result.status).toBe('completed');
      expect(result.target).toBe('web');
      expect(result.endpoint).toContain('portal.proctira.org');
      expect(result.payload.metadata.warehouseName).toBe('Publish Test DW');
      expect(result.payload.metadata.language).toBe('en');
    });
  });

  describe('Publish to API Endpoint', () => {
    it('should publish data for API consumption', async () => {
      const result = await publishingService.publishData(tenantId, warehouseId, {
        target: 'api',
        language: 'en',
      });

      expect(result.status).toBe('completed');
      expect(result.target).toBe('api');
      expect(result.endpoint).toContain('api.proctira.org');
      expect(result.payload.metadata).toBeDefined();
      expect(result.payload.data).toBeDefined();
    });
  });

  describe('Publish with GIS Layers', () => {
    it('should include GIS layers when requested', async () => {
      // Create a GIS layer first
      const areas = await warehouseRepo.listAreas(warehouseId, tenantId, {}, 1, 10);
      const area = areas.data[0]!;

      const gisService = new GISService(gisRepo, warehouseRepo, {
        maxLayerFileSize: 50 * 1024 * 1024,
        supportedCRS: ['EPSG:4326'],
      });

      const geojson = JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [77.5, 12.9] },
            properties: {},
          },
        ],
      });

      await gisService.createLayer(tenantId, warehouseId, {
        areaId: area.id,
        name: 'Test Points',
        layerType: 'geojson',
        data: geojson,
      });

      const result = await publishingService.publishData(tenantId, warehouseId, {
        target: 'web',
        includeGISLayers: true,
      });

      expect(result.layerCount).toBe(1);
      expect(result.payload.gisLayers).toBeDefined();
      expect(result.payload.gisLayers!.length).toBe(1);
      expect(result.payload.gisLayers![0]!.name).toBe('Test Points');
    });
  });

  describe('Publish History', () => {
    it('should track publish history', async () => {
      await publishingService.publishData(tenantId, warehouseId, { target: 'mobile' });
      await publishingService.publishData(tenantId, warehouseId, { target: 'web' });
      await publishingService.publishData(tenantId, warehouseId, { target: 'api' });

      const history = await publishingService.getPublishHistory(tenantId, warehouseId, {});
      expect(history.total).toBe(3);
    });

    it('should filter publish history by target', async () => {
      await publishingService.publishData(tenantId, warehouseId, { target: 'mobile' });
      await publishingService.publishData(tenantId, warehouseId, { target: 'web' });

      const history = await publishingService.getPublishHistory(tenantId, warehouseId, {
        target: 'mobile',
      });
      expect(history.total).toBe(1);
      expect(history.data[0]!.target).toBe('mobile');
    });
  });

  describe('Error Handling', () => {
    it('should throw NotFoundError for non-existent warehouse', async () => {
      await expect(
        publishingService.publishData(tenantId, '00000000-0000-4000-8000-000000000000', {
          target: 'api',
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });
});

describe('Translation Service (Requirement 15.5)', () => {
  let warehouseService: DataWarehouseService;
  let translationService: TranslationService;
  let warehouseRepo: InMemoryWarehouseRepository;
  let translationRepo: InMemoryTranslationRepository;
  let warehouseId: string;
  let indicatorId: string;
  let unitId: string;
  let areaId: string;

  beforeEach(async () => {
    warehouseRepo = new InMemoryWarehouseRepository();
    translationRepo = new InMemoryTranslationRepository();
    warehouseService = new DataWarehouseService(warehouseRepo, { maxImportBatchSize: 10000 });
    translationService = new TranslationService(translationRepo, warehouseRepo, {
      supportedLanguages: ['en', 'fr', 'ar', 'es'],
      maxImportBatchSize: 5000,
    });

    const wh = await warehouseService.createWarehouse(tenantId, {
      name: 'Translation Test DW',
      defaultLanguage: 'en',
    });
    warehouseId = wh.id;

    const indicator = await warehouseService.createIndicator(tenantId, warehouseId, {
      name: 'Net Enrollment Rate',
      gid: 'NER_001',
    });
    indicatorId = indicator.id;

    const unit = await warehouseService.createUnit(tenantId, warehouseId, {
      name: 'Percent',
      gid: 'PCT',
    });
    unitId = unit.id;

    const area = await warehouseService.createArea(tenantId, warehouseId, {
      name: 'India',
      areaId: 'IND',
      gid: 'AREA_IND',
      level: 0,
    });
    areaId = area.id;
  });

  describe('Single Translation', () => {
    it('should create a translation for an indicator', async () => {
      const translation = await translationService.setTranslation(tenantId, warehouseId, {
        entityType: 'indicator',
        entityId: indicatorId,
        language: 'fr',
        field: 'name',
        value: 'Taux net de scolarisation',
      });

      expect(translation.entityType).toBe('indicator');
      expect(translation.entityId).toBe(indicatorId);
      expect(translation.language).toBe('fr');
      expect(translation.field).toBe('name');
      expect(translation.value).toBe('Taux net de scolarisation');
    });

    it('should update an existing translation (upsert)', async () => {
      await translationService.setTranslation(tenantId, warehouseId, {
        entityType: 'indicator',
        entityId: indicatorId,
        language: 'fr',
        field: 'name',
        value: 'Old Value',
      });

      const updated = await translationService.setTranslation(tenantId, warehouseId, {
        entityType: 'indicator',
        entityId: indicatorId,
        language: 'fr',
        field: 'name',
        value: 'New Value',
      });

      expect(updated.value).toBe('New Value');
    });

    it('should create translations for different entity types', async () => {
      await translationService.setTranslation(tenantId, warehouseId, {
        entityType: 'unit',
        entityId: unitId,
        language: 'fr',
        field: 'name',
        value: 'Pourcentage',
      });
      await translationService.setTranslation(tenantId, warehouseId, {
        entityType: 'area',
        entityId: areaId,
        language: 'fr',
        field: 'name',
        value: 'Inde',
      });

      const unitTranslations = await translationService.getEntityTranslations(
        tenantId,
        warehouseId,
        'unit',
        unitId,
      );
      expect(unitTranslations.length).toBe(1);
      expect(unitTranslations[0]!.value).toBe('Pourcentage');

      const areaTranslations = await translationService.getEntityTranslations(
        tenantId,
        warehouseId,
        'area',
        areaId,
      );
      expect(areaTranslations.length).toBe(1);
      expect(areaTranslations[0]!.value).toBe('Inde');
    });

    it('should reject translation for non-existent entity', async () => {
      await expect(
        translationService.setTranslation(tenantId, warehouseId, {
          entityType: 'indicator',
          entityId: '00000000-0000-4000-8000-000000000000',
          language: 'fr',
          field: 'name',
          value: 'Test',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('should reject translation for non-existent warehouse', async () => {
      await expect(
        translationService.setTranslation(tenantId, '00000000-0000-4000-8000-000000000000', {
          entityType: 'indicator',
          entityId: indicatorId,
          language: 'fr',
          field: 'name',
          value: 'Test',
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('Batch Translations', () => {
    it('should set multiple translations in batch', async () => {
      const result = await translationService.setTranslationsBatch(tenantId, warehouseId, {
        translations: [
          {
            entityType: 'indicator',
            entityId: indicatorId,
            language: 'fr',
            field: 'name',
            value: 'Taux net',
          },
          {
            entityType: 'unit',
            entityId: unitId,
            language: 'fr',
            field: 'name',
            value: 'Pourcentage',
          },
          { entityType: 'area', entityId: areaId, language: 'fr', field: 'name', value: 'Inde' },
        ],
      });

      expect(result.successCount).toBe(3);
      expect(result.errorCount).toBe(0);
    });

    it('should report errors for invalid entities in batch', async () => {
      const result = await translationService.setTranslationsBatch(tenantId, warehouseId, {
        translations: [
          {
            entityType: 'indicator',
            entityId: indicatorId,
            language: 'fr',
            field: 'name',
            value: 'Valid',
          },
          {
            entityType: 'indicator',
            entityId: '00000000-0000-4000-8000-000000000000',
            language: 'fr',
            field: 'name',
            value: 'Invalid',
          },
        ],
      });

      expect(result.successCount).toBe(1);
      expect(result.errorCount).toBe(1);
      expect(result.errors[0]!.index).toBe(1);
    });
  });

  describe('Translation Fallback', () => {
    it('should return translated value for requested language', async () => {
      await translationService.setTranslation(tenantId, warehouseId, {
        entityType: 'indicator',
        entityId: indicatorId,
        language: 'fr',
        field: 'name',
        value: 'Taux net de scolarisation',
      });

      const value = await translationService.getTranslatedValue(
        tenantId,
        warehouseId,
        'indicator',
        indicatorId,
        'name',
        'fr',
        'Net Enrollment Rate',
      );
      expect(value).toBe('Taux net de scolarisation');
    });

    it('should fallback to default language when requested language not available', async () => {
      await translationService.setTranslation(tenantId, warehouseId, {
        entityType: 'indicator',
        entityId: indicatorId,
        language: 'en',
        field: 'name',
        value: 'Net Enrollment Rate (EN)',
      });

      const value = await translationService.getTranslatedValue(
        tenantId,
        warehouseId,
        'indicator',
        indicatorId,
        'name',
        'ar',
        'Net Enrollment Rate',
      );
      // Should fallback to 'en' (warehouse default)
      expect(value).toBe('Net Enrollment Rate (EN)');
    });

    it('should return default value when no translation exists', async () => {
      const value = await translationService.getTranslatedValue(
        tenantId,
        warehouseId,
        'indicator',
        indicatorId,
        'name',
        'zh',
        'Net Enrollment Rate',
      );
      expect(value).toBe('Net Enrollment Rate');
    });
  });

  describe('Translation Export', () => {
    beforeEach(async () => {
      await translationService.setTranslation(tenantId, warehouseId, {
        entityType: 'indicator',
        entityId: indicatorId,
        language: 'fr',
        field: 'name',
        value: 'Taux net',
      });
      await translationService.setTranslation(tenantId, warehouseId, {
        entityType: 'unit',
        entityId: unitId,
        language: 'fr',
        field: 'name',
        value: 'Pourcentage',
      });
      await translationService.setTranslation(tenantId, warehouseId, {
        entityType: 'indicator',
        entityId: indicatorId,
        language: 'ar',
        field: 'name',
        value: 'معدل الالتحاق الصافي',
      });
    });

    it('should export translations as JSON', async () => {
      const result = await translationService.exportTranslations(tenantId, warehouseId, {
        format: 'json',
      });

      expect(result.format).toBe('json');
      expect(result.totalRecords).toBe(3);
      const parsed = JSON.parse(result.content);
      expect(parsed.length).toBe(3);
    });

    it('should export translations as CSV', async () => {
      const result = await translationService.exportTranslations(tenantId, warehouseId, {
        format: 'csv',
      });

      expect(result.format).toBe('csv');
      expect(result.totalRecords).toBe(3);
      expect(result.content).toContain('entityType,entityId,language,field,value');
    });

    it('should filter export by language', async () => {
      const result = await translationService.exportTranslations(tenantId, warehouseId, {
        format: 'json',
        language: 'fr',
      });

      expect(result.totalRecords).toBe(2);
      expect(result.language).toBe('fr');
    });

    it('should filter export by entity type', async () => {
      const result = await translationService.exportTranslations(tenantId, warehouseId, {
        format: 'json',
        entityType: 'indicator',
      });

      expect(result.totalRecords).toBe(2);
      expect(result.entityType).toBe('indicator');
    });
  });

  describe('Translation Import', () => {
    it('should import translations from JSON', async () => {
      const jsonContent = JSON.stringify([
        {
          entityType: 'indicator',
          entityId: indicatorId,
          language: 'es',
          field: 'name',
          value: 'Tasa neta de matriculación',
        },
        {
          entityType: 'unit',
          entityId: unitId,
          language: 'es',
          field: 'name',
          value: 'Porcentaje',
        },
      ]);

      const result = await translationService.importTranslations(tenantId, warehouseId, {
        format: 'json',
        content: jsonContent,
      });

      expect(result.totalRows).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.errorCount).toBe(0);
    });

    it('should import translations from CSV', async () => {
      const csvContent = `entityType,entityId,language,field,value
indicator,${indicatorId},es,name,Tasa neta
unit,${unitId},es,name,Porcentaje`;

      const result = await translationService.importTranslations(tenantId, warehouseId, {
        format: 'csv',
        content: csvContent,
      });

      expect(result.totalRows).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.errorCount).toBe(0);
    });

    it('should import translations from base64-encoded content', async () => {
      const jsonContent = JSON.stringify([
        {
          entityType: 'indicator',
          entityId: indicatorId,
          language: 'es',
          field: 'name',
          value: 'Tasa neta',
        },
      ]);
      const base64Content = Buffer.from(jsonContent).toString('base64');

      const result = await translationService.importTranslations(tenantId, warehouseId, {
        format: 'json',
        content: base64Content,
      });

      expect(result.successCount).toBe(1);
    });

    it('should track updated translations during import', async () => {
      // First, create a translation
      await translationService.setTranslation(tenantId, warehouseId, {
        entityType: 'indicator',
        entityId: indicatorId,
        language: 'es',
        field: 'name',
        value: 'Old Value',
      });

      // Import with updated value
      const jsonContent = JSON.stringify([
        {
          entityType: 'indicator',
          entityId: indicatorId,
          language: 'es',
          field: 'name',
          value: 'New Value',
        },
      ]);

      const result = await translationService.importTranslations(tenantId, warehouseId, {
        format: 'json',
        content: jsonContent,
      });

      expect(result.successCount).toBe(1);
      expect(result.updatedCount).toBe(1);
    });

    it('should report errors for invalid entity types in import', async () => {
      const jsonContent = JSON.stringify([
        {
          entityType: 'invalid_type',
          entityId: indicatorId,
          language: 'es',
          field: 'name',
          value: 'Test',
        },
      ]);

      const result = await translationService.importTranslations(tenantId, warehouseId, {
        format: 'json',
        content: jsonContent,
      });

      expect(result.errorCount).toBe(1);
      expect(result.errors[0]!.field).toBe('entityType');
    });

    it('should handle malformed import content gracefully', async () => {
      const result = await translationService.importTranslations(tenantId, warehouseId, {
        format: 'json',
        content: 'not valid json at all',
      });

      expect(result.errorCount).toBe(1);
      expect(result.errors[0]!.message).toContain('Failed to parse');
    });
  });

  describe('List Translations', () => {
    beforeEach(async () => {
      await translationService.setTranslation(tenantId, warehouseId, {
        entityType: 'indicator',
        entityId: indicatorId,
        language: 'fr',
        field: 'name',
        value: 'Taux net',
      });
      await translationService.setTranslation(tenantId, warehouseId, {
        entityType: 'indicator',
        entityId: indicatorId,
        language: 'ar',
        field: 'name',
        value: 'معدل',
      });
      await translationService.setTranslation(tenantId, warehouseId, {
        entityType: 'unit',
        entityId: unitId,
        language: 'fr',
        field: 'name',
        value: 'Pourcentage',
      });
    });

    it('should list all translations', async () => {
      const result = await translationService.listTranslations(tenantId, warehouseId, {});
      expect(result.total).toBe(3);
    });

    it('should filter by language', async () => {
      const result = await translationService.listTranslations(tenantId, warehouseId, {
        language: 'fr',
      });
      expect(result.total).toBe(2);
    });

    it('should filter by entity type', async () => {
      const result = await translationService.listTranslations(tenantId, warehouseId, {
        entityType: 'indicator',
      });
      expect(result.total).toBe(2);
    });

    it('should filter by entity ID', async () => {
      const result = await translationService.listTranslations(tenantId, warehouseId, {
        entityId: indicatorId,
      });
      expect(result.total).toBe(2);
    });
  });
});
