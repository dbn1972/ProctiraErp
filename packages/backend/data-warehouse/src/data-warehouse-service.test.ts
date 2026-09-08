/**
 * Data Warehouse Service Tests
 *
 * Tests for warehouse management, DI7 schema entities (indicators, units,
 * subgroups, time periods, areas), data import with IUS validation,
 * and referential integrity checks.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundError, ConflictError } from '@proctira/common';

import { DataWarehouseService } from './data-warehouse-service.js';
import { InMemoryWarehouseRepository } from './in-memory-repository.js';
import { parseCsvContent, parseExcelDesContent } from './import-service.js';

describe('DataWarehouseService', () => {
  let service: DataWarehouseService;
  let repository: InMemoryWarehouseRepository;
  const tenantId = 'tenant-001';

  beforeEach(() => {
    repository = new InMemoryWarehouseRepository();
    service = new DataWarehouseService(repository, { maxImportBatchSize: 10000 });
  });

  describe('Warehouse CRUD', () => {
    it('should create a warehouse', async () => {
      const warehouse = await service.createWarehouse(tenantId, {
        name: 'Education Statistics',
        description: 'National education indicators',
      });

      expect(warehouse.id).toBeDefined();
      expect(warehouse.tenantId).toBe(tenantId);
      expect(warehouse.name).toBe('Education Statistics');
      expect(warehouse.description).toBe('National education indicators');
      expect(warehouse.defaultLanguage).toBe('en');
    });

    it('should get a warehouse by ID', async () => {
      const created = await service.createWarehouse(tenantId, { name: 'Test DW' });
      const fetched = await service.getWarehouse(tenantId, created.id);
      expect(fetched.name).toBe('Test DW');
    });

    it('should throw NotFoundError for non-existent warehouse', async () => {
      await expect(
        service.getWarehouse(tenantId, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow(NotFoundError);
    });

    it('should update a warehouse', async () => {
      const created = await service.createWarehouse(tenantId, { name: 'Old Name' });
      const updated = await service.updateWarehouse(tenantId, created.id, { name: 'New Name' });
      expect(updated.name).toBe('New Name');
    });

    it('should delete a warehouse', async () => {
      const created = await service.createWarehouse(tenantId, { name: 'To Delete' });
      await service.deleteWarehouse(tenantId, created.id);
      await expect(service.getWarehouse(tenantId, created.id)).rejects.toThrow(NotFoundError);
    });

    it('should list warehouses with pagination', async () => {
      await service.createWarehouse(tenantId, { name: 'DW 1' });
      await service.createWarehouse(tenantId, { name: 'DW 2' });
      await service.createWarehouse(tenantId, { name: 'DW 3' });

      const result = await service.listWarehouses(tenantId, {}, 1, 2);
      expect(result.data.length).toBe(2);
      expect(result.total).toBe(3);
    });
  });

  describe('Indicator CRUD', () => {
    let warehouseId: string;

    beforeEach(async () => {
      const wh = await service.createWarehouse(tenantId, { name: 'Test DW' });
      warehouseId = wh.id;
    });

    it('should create an indicator', async () => {
      const indicator = await service.createIndicator(tenantId, warehouseId, {
        name: 'Net Enrollment Rate',
        gid: 'NER_001',
        shortName: 'NER',
        highIsGood: true,
      });

      expect(indicator.id).toBeDefined();
      expect(indicator.name).toBe('Net Enrollment Rate');
      expect(indicator.gid).toBe('NER_001');
      expect(indicator.highIsGood).toBe(true);
    });

    it('should reject duplicate indicator GID', async () => {
      await service.createIndicator(tenantId, warehouseId, { name: 'Ind 1', gid: 'IND_001' });
      await expect(
        service.createIndicator(tenantId, warehouseId, { name: 'Ind 2', gid: 'IND_001' }),
      ).rejects.toThrow(ConflictError);
    });

    it('should list indicators', async () => {
      await service.createIndicator(tenantId, warehouseId, { name: 'Ind A', gid: 'A' });
      await service.createIndicator(tenantId, warehouseId, { name: 'Ind B', gid: 'B' });

      const result = await service.listIndicators(tenantId, warehouseId, {}, 1, 20);
      expect(result.data.length).toBe(2);
    });
  });

  describe('Unit CRUD', () => {
    let warehouseId: string;

    beforeEach(async () => {
      const wh = await service.createWarehouse(tenantId, { name: 'Test DW' });
      warehouseId = wh.id;
    });

    it('should create a unit', async () => {
      const unit = await service.createUnit(tenantId, warehouseId, {
        name: 'Percent',
        gid: 'PCT_001',
      });
      expect(unit.name).toBe('Percent');
      expect(unit.gid).toBe('PCT_001');
    });

    it('should reject duplicate unit GID', async () => {
      await service.createUnit(tenantId, warehouseId, { name: 'Unit 1', gid: 'U1' });
      await expect(
        service.createUnit(tenantId, warehouseId, { name: 'Unit 2', gid: 'U1' }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('Subgroup CRUD', () => {
    let warehouseId: string;

    beforeEach(async () => {
      const wh = await service.createWarehouse(tenantId, { name: 'Test DW' });
      warehouseId = wh.id;
    });

    it('should create a subgroup', async () => {
      const sg = await service.createSubgroup(tenantId, warehouseId, {
        name: 'Male',
        gid: 'SG_MALE',
        typeName: 'Gender',
      });
      expect(sg.name).toBe('Male');
      expect(sg.typeName).toBe('Gender');
    });

    it('should reject duplicate subgroup GID', async () => {
      await service.createSubgroup(tenantId, warehouseId, { name: 'SG 1', gid: 'SG1' });
      await expect(
        service.createSubgroup(tenantId, warehouseId, { name: 'SG 2', gid: 'SG1' }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('TimePeriod CRUD', () => {
    let warehouseId: string;

    beforeEach(async () => {
      const wh = await service.createWarehouse(tenantId, { name: 'Test DW' });
      warehouseId = wh.id;
    });

    it('should create a time period', async () => {
      const tp = await service.createTimePeriod(tenantId, warehouseId, {
        timePeriod: '2023',
        periodicity: 'Annual',
      });
      expect(tp.timePeriod).toBe('2023');
      expect(tp.periodicity).toBe('Annual');
    });

    it('should reject duplicate time period label', async () => {
      await service.createTimePeriod(tenantId, warehouseId, { timePeriod: '2023' });
      await expect(
        service.createTimePeriod(tenantId, warehouseId, { timePeriod: '2023' }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('Area CRUD', () => {
    let warehouseId: string;

    beforeEach(async () => {
      const wh = await service.createWarehouse(tenantId, { name: 'Test DW' });
      warehouseId = wh.id;
    });

    it('should create an area', async () => {
      const area = await service.createArea(tenantId, warehouseId, {
        name: 'India',
        areaId: 'IND',
        gid: 'AREA_IND',
        level: 0,
      });
      expect(area.name).toBe('India');
      expect(area.level).toBe(0);
    });

    it('should reject duplicate area external ID', async () => {
      await service.createArea(tenantId, warehouseId, {
        name: 'A1',
        areaId: 'A1',
        gid: 'G1',
        level: 0,
      });
      await expect(
        service.createArea(tenantId, warehouseId, {
          name: 'A2',
          areaId: 'A1',
          gid: 'G2',
          level: 0,
        }),
      ).rejects.toThrow(ConflictError);
    });

    it('should validate parent area exists', async () => {
      await expect(
        service.createArea(tenantId, warehouseId, {
          name: 'Child',
          areaId: 'CHILD',
          gid: 'G_CHILD',
          level: 1,
          parentId: '00000000-0000-4000-8000-000000000000',
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('Data Import with IUS Validation', () => {
    let warehouseId: string;

    beforeEach(async () => {
      const wh = await service.createWarehouse(tenantId, { name: 'Import Test DW' });
      warehouseId = wh.id;

      // Set up reference data
      await service.createIndicator(tenantId, warehouseId, { name: 'NER', gid: 'NER_001' });
      await service.createUnit(tenantId, warehouseId, { name: 'Percent', gid: 'PCT' });
      await service.createSubgroup(tenantId, warehouseId, { name: 'Total', gid: 'SG_TOTAL' });
      await service.createTimePeriod(tenantId, warehouseId, { timePeriod: '2023' });
      await service.createArea(tenantId, warehouseId, {
        name: 'India',
        areaId: 'IND',
        gid: 'AREA_IND',
        level: 0,
      });
    });

    it('should import valid data records', async () => {
      const result = await service.importData(tenantId, warehouseId, 'csv', {
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

      expect(result.totalRows).toBe(1);
      expect(result.successCount).toBe(1);
      expect(result.errorCount).toBe(0);
    });

    it('should reject records with non-existent indicator', async () => {
      const result = await service.importData(tenantId, warehouseId, 'csv', {
        records: [
          {
            indicatorGid: 'NONEXISTENT',
            unitGid: 'PCT',
            subgroupGid: 'SG_TOTAL',
            areaId: 'IND',
            timePeriod: '2023',
            dataValue: 50,
          },
        ],
      });

      expect(result.errorCount).toBe(1);
      expect(result.errors[0]!.field).toBe('indicatorGid');
      expect(result.errors[0]!.message).toContain('Indicator not found');
    });

    it('should reject records with non-existent unit', async () => {
      const result = await service.importData(tenantId, warehouseId, 'csv', {
        records: [
          {
            indicatorGid: 'NER_001',
            unitGid: 'BADUNIT',
            subgroupGid: 'SG_TOTAL',
            areaId: 'IND',
            timePeriod: '2023',
            dataValue: 50,
          },
        ],
      });

      expect(result.errorCount).toBe(1);
      expect(result.errors[0]!.field).toBe('unitGid');
    });

    it('should reject records with non-existent subgroup', async () => {
      const result = await service.importData(tenantId, warehouseId, 'csv', {
        records: [
          {
            indicatorGid: 'NER_001',
            unitGid: 'PCT',
            subgroupGid: 'BAD_SG',
            areaId: 'IND',
            timePeriod: '2023',
            dataValue: 50,
          },
        ],
      });

      expect(result.errorCount).toBe(1);
      expect(result.errors[0]!.field).toBe('subgroupGid');
    });

    it('should reject records with non-existent area', async () => {
      const result = await service.importData(tenantId, warehouseId, 'csv', {
        records: [
          {
            indicatorGid: 'NER_001',
            unitGid: 'PCT',
            subgroupGid: 'SG_TOTAL',
            areaId: 'BADAREA',
            timePeriod: '2023',
            dataValue: 50,
          },
        ],
      });

      expect(result.errorCount).toBe(1);
      expect(result.errors[0]!.field).toBe('areaId');
    });

    it('should reject records with non-existent time period', async () => {
      const result = await service.importData(tenantId, warehouseId, 'csv', {
        records: [
          {
            indicatorGid: 'NER_001',
            unitGid: 'PCT',
            subgroupGid: 'SG_TOTAL',
            areaId: 'IND',
            timePeriod: '9999',
            dataValue: 50,
          },
        ],
      });

      expect(result.errorCount).toBe(1);
      expect(result.errors[0]!.field).toBe('timePeriod');
    });

    it('should reject duplicate IUS-area-timeperiod combinations', async () => {
      // First import succeeds
      await service.importData(tenantId, warehouseId, 'csv', {
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

      // Second import with same combination should fail
      const result = await service.importData(tenantId, warehouseId, 'csv', {
        records: [
          {
            indicatorGid: 'NER_001',
            unitGid: 'PCT',
            subgroupGid: 'SG_TOTAL',
            areaId: 'IND',
            timePeriod: '2023',
            dataValue: 96.0,
          },
        ],
      });

      expect(result.errorCount).toBe(1);
      expect(result.duplicateCount).toBe(1);
      expect(result.errors[0]!.message).toContain('Duplicate IUS-area-timeperiod');
    });

    it('should detect duplicates within the same import batch', async () => {
      const result = await service.importData(tenantId, warehouseId, 'csv', {
        records: [
          {
            indicatorGid: 'NER_001',
            unitGid: 'PCT',
            subgroupGid: 'SG_TOTAL',
            areaId: 'IND',
            timePeriod: '2023',
            dataValue: 95.5,
          },
          {
            indicatorGid: 'NER_001',
            unitGid: 'PCT',
            subgroupGid: 'SG_TOTAL',
            areaId: 'IND',
            timePeriod: '2023',
            dataValue: 96.0,
          },
        ],
      });

      expect(result.successCount).toBe(1);
      expect(result.duplicateCount).toBe(1);
      expect(result.errorCount).toBe(1);
    });
  });

  describe('CSV Import', () => {
    it('should parse CSV content into data records', () => {
      const csv = `indicatorGid,unitGid,subgroupGid,areaId,timePeriod,dataValue,source
NER_001,PCT,SG_TOTAL,IND,2023,95.5,Census
GER_001,PCT,SG_MALE,IND,2023,102.3,Survey`;

      const records = parseCsvContent(csv);
      expect(records.length).toBe(2);
      expect(records[0]!.indicatorGid).toBe('NER_001');
      expect(records[0]!.dataValue).toBe(95.5);
      expect(records[0]!.source).toBe('Census');
      expect(records[1]!.indicatorGid).toBe('GER_001');
      expect(records[1]!.dataValue).toBe(102.3);
    });

    it('should handle empty CSV', () => {
      const records = parseCsvContent('');
      expect(records.length).toBe(0);
    });

    it('should handle CSV with only headers', () => {
      const records = parseCsvContent('indicatorGid,unitGid,subgroupGid,areaId,timePeriod');
      expect(records.length).toBe(0);
    });
  });

  describe('Excel DES Import', () => {
    it('should parse DES format content', () => {
      const desContent = `Indicator\tUnit\tSubgroup\tArea\tTimePeriod\tDataValue\tSource
NER_001\tPCT\tSG_TOTAL\tIND\t2023\t95.5\tCensus`;

      const base64 = Buffer.from(desContent).toString('base64');
      const records = parseExcelDesContent(base64);
      expect(records.length).toBe(1);
      expect(records[0]!.indicatorGid).toBe('NER_001');
      expect(records[0]!.unitGid).toBe('PCT');
      expect(records[0]!.dataValue).toBe(95.5);
    });
  });

  describe('Data Query', () => {
    let warehouseId: string;

    beforeEach(async () => {
      const wh = await service.createWarehouse(tenantId, { name: 'Query Test DW' });
      warehouseId = wh.id;

      await service.createIndicator(tenantId, warehouseId, { name: 'NER', gid: 'NER_001' });
      await service.createIndicator(tenantId, warehouseId, { name: 'GER', gid: 'GER_001' });
      await service.createUnit(tenantId, warehouseId, { name: 'Percent', gid: 'PCT' });
      await service.createSubgroup(tenantId, warehouseId, { name: 'Total', gid: 'SG_TOTAL' });
      await service.createTimePeriod(tenantId, warehouseId, { timePeriod: '2022' });
      await service.createTimePeriod(tenantId, warehouseId, { timePeriod: '2023' });
      await service.createArea(tenantId, warehouseId, {
        name: 'India',
        areaId: 'IND',
        gid: 'AREA_IND',
        level: 0,
      });

      await service.importData(tenantId, warehouseId, 'csv', {
        records: [
          {
            indicatorGid: 'NER_001',
            unitGid: 'PCT',
            subgroupGid: 'SG_TOTAL',
            areaId: 'IND',
            timePeriod: '2022',
            dataValue: 90.0,
          },
          {
            indicatorGid: 'NER_001',
            unitGid: 'PCT',
            subgroupGid: 'SG_TOTAL',
            areaId: 'IND',
            timePeriod: '2023',
            dataValue: 95.5,
          },
          {
            indicatorGid: 'GER_001',
            unitGid: 'PCT',
            subgroupGid: 'SG_TOTAL',
            areaId: 'IND',
            timePeriod: '2023',
            dataValue: 102.3,
          },
        ],
      });
    });

    it('should query all data in warehouse', async () => {
      const result = await service.queryData(tenantId, warehouseId, {}, 1, 50);
      expect(result.total).toBe(3);
    });

    it('should filter by time period', async () => {
      const result = await service.queryData(
        tenantId,
        warehouseId,
        { timePeriods: ['2023'] },
        1,
        50,
      );
      expect(result.total).toBe(2);
    });

    it('should support pagination', async () => {
      const result = await service.queryData(tenantId, warehouseId, {}, 1, 2);
      expect(result.data.length).toBe(2);
      expect(result.total).toBe(3);
    });
  });
});
