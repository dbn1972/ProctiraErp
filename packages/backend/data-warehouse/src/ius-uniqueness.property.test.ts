/**
 * Property-Based Test: Data Warehouse IUS Uniqueness
 *
 * **Validates: Requirements 15.2, 15.6**
 *
 * Property 28: For any data import into a warehouse, THE Data_Warehouse_Module SHALL:
 * 1. Accept any valid IUS-area-timeperiod combination that doesn't already exist
 * 2. Reject any duplicate IUS-area-timeperiod combination with appropriate error
 * 3. Reject records referencing non-existent indicators/units/subgroups/areas/time-periods
 *    with referential integrity errors
 * 4. Within a single import batch, detect duplicate IUS-area-timeperiod combinations
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';

import { DataWarehouseService } from './data-warehouse-service.js';
import { InMemoryWarehouseRepository } from './in-memory-repository.js';
import type { ImportResult } from './schemas.js';

/**
 * Generates a unique GID string suitable for indicators, units, and subgroups.
 */
const arbGid = (prefix: string): fc.Arbitrary<string> =>
  fc.stringMatching(/^[A-Z0-9_]{2,10}$/).map((s) => `${prefix}_${s}`);

/**
 * Generates a valid area external ID.
 */
const arbAreaExternalId = (): fc.Arbitrary<string> =>
  fc.stringMatching(/^[A-Z]{2,5}$/).map((s) => `AREA_${s}`);

/**
 * Generates a valid time period label.
 */
const arbTimePeriodLabel = (): fc.Arbitrary<string> =>
  fc.integer({ min: 2000, max: 2099 }).map((year) => `${year}`);

/**
 * Generates a numeric data value.
 */
const arbDataValue = (): fc.Arbitrary<number> =>
  fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true });

describe('Property 28: Data Warehouse IUS Uniqueness', () => {
  let service: DataWarehouseService;
  let repository: InMemoryWarehouseRepository;
  const tenantId = 'tenant-ius-test';

  beforeEach(() => {
    repository = new InMemoryWarehouseRepository();
    service = new DataWarehouseService(repository, { maxImportBatchSize: 10000 });
  });

  /**
   * Helper to set up a warehouse with reference data and return the metadata.
   */
  async function setupWarehouse(config: {
    indicatorGids: string[];
    unitGids: string[];
    subgroupGids: string[];
    areaExternalIds: string[];
    timePeriodLabels: string[];
  }) {
    const warehouse = await service.createWarehouse(tenantId, {
      name: 'IUS Test Warehouse',
    });

    for (const gid of config.indicatorGids) {
      await service.createIndicator(tenantId, warehouse.id, {
        name: `Indicator ${gid}`,
        gid,
      });
    }

    for (const gid of config.unitGids) {
      await service.createUnit(tenantId, warehouse.id, {
        name: `Unit ${gid}`,
        gid,
      });
    }

    for (const gid of config.subgroupGids) {
      await service.createSubgroup(tenantId, warehouse.id, {
        name: `Subgroup ${gid}`,
        gid,
      });
    }

    for (const areaId of config.areaExternalIds) {
      await service.createArea(tenantId, warehouse.id, {
        name: `Area ${areaId}`,
        areaId,
        gid: `GID_${areaId}`,
        level: 0,
      });
    }

    for (const label of config.timePeriodLabels) {
      await service.createTimePeriod(tenantId, warehouse.id, {
        timePeriod: label,
      });
    }

    return { warehouseId: warehouse.id, ...config };
  }

  it('any valid IUS-area-timeperiod combination that does not already exist is accepted', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbGid('IND'),
        arbGid('UNIT'),
        arbGid('SG'),
        arbAreaExternalId(),
        arbTimePeriodLabel(),
        arbDataValue(),
        async (indicatorGid, unitGid, subgroupGid, areaId, timePeriod, dataValue) => {
          // Set up warehouse with the generated reference data
          const { warehouseId } = await setupWarehouse({
            indicatorGids: [indicatorGid],
            unitGids: [unitGid],
            subgroupGids: [subgroupGid],
            areaExternalIds: [areaId],
            timePeriodLabels: [timePeriod],
          });

          // Import a single valid record
          const result: ImportResult = await service.importData(tenantId, warehouseId, 'csv', {
            records: [
              {
                indicatorGid,
                unitGid,
                subgroupGid,
                areaId,
                timePeriod,
                dataValue,
              },
            ],
          });

          // The record should be accepted
          expect(result.totalRows).toBe(1);
          expect(result.successCount).toBe(1);
          expect(result.errorCount).toBe(0);
          expect(result.duplicateCount).toBe(0);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('any duplicate IUS-area-timeperiod combination is rejected with appropriate error', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbGid('IND'),
        arbGid('UNIT'),
        arbGid('SG'),
        arbAreaExternalId(),
        arbTimePeriodLabel(),
        arbDataValue(),
        arbDataValue(),
        async (indicatorGid, unitGid, subgroupGid, areaId, timePeriod, value1, value2) => {
          // Set up warehouse with reference data
          const { warehouseId } = await setupWarehouse({
            indicatorGids: [indicatorGid],
            unitGids: [unitGid],
            subgroupGids: [subgroupGid],
            areaExternalIds: [areaId],
            timePeriodLabels: [timePeriod],
          });

          // First import should succeed
          const firstResult = await service.importData(tenantId, warehouseId, 'csv', {
            records: [
              {
                indicatorGid,
                unitGid,
                subgroupGid,
                areaId,
                timePeriod,
                dataValue: value1,
              },
            ],
          });
          expect(firstResult.successCount).toBe(1);

          // Second import with same IUS-area-timeperiod should be rejected
          const secondResult = await service.importData(tenantId, warehouseId, 'csv', {
            records: [
              {
                indicatorGid,
                unitGid,
                subgroupGid,
                areaId,
                timePeriod,
                dataValue: value2,
              },
            ],
          });

          expect(secondResult.totalRows).toBe(1);
          expect(secondResult.successCount).toBe(0);
          expect(secondResult.errorCount).toBe(1);
          expect(secondResult.duplicateCount).toBe(1);
          expect(secondResult.errors.length).toBeGreaterThanOrEqual(1);
          expect(secondResult.errors[0]!.message).toContain('Duplicate');
        },
      ),
      { numRuns: 50 },
    );
  });

  it('records referencing non-existent indicators/units/subgroups/areas/time-periods are rejected with referential integrity errors', async () => {
    // Arbitrary to select which reference entity to make invalid
    const arbInvalidField = fc.constantFrom(
      'indicatorGid',
      'unitGid',
      'subgroupGid',
      'areaId',
      'timePeriod',
    ) as fc.Arbitrary<'indicatorGid' | 'unitGid' | 'subgroupGid' | 'areaId' | 'timePeriod'>;

    await fc.assert(
      fc.asyncProperty(
        arbGid('IND'),
        arbGid('UNIT'),
        arbGid('SG'),
        arbAreaExternalId(),
        arbTimePeriodLabel(),
        arbInvalidField,
        async (indicatorGid, unitGid, subgroupGid, areaId, timePeriod, invalidField) => {
          // Set up warehouse with valid reference data
          const { warehouseId } = await setupWarehouse({
            indicatorGids: [indicatorGid],
            unitGids: [unitGid],
            subgroupGids: [subgroupGid],
            areaExternalIds: [areaId],
            timePeriodLabels: [timePeriod],
          });

          // Build a record with one invalid reference
          const record = {
            indicatorGid,
            unitGid,
            subgroupGid,
            areaId,
            timePeriod,
            dataValue: 50.0,
          };

          // Replace the selected field with a non-existent value
          const nonExistentValue = 'NONEXISTENT_REF_999';
          record[invalidField] = nonExistentValue;

          const result = await service.importData(tenantId, warehouseId, 'csv', {
            records: [record],
          });

          // The record should be rejected with a referential integrity error
          expect(result.totalRows).toBe(1);
          expect(result.successCount).toBe(0);
          expect(result.errorCount).toBe(1);
          expect(result.errors.length).toBeGreaterThanOrEqual(1);
          expect(result.errors[0]!.field).toBe(invalidField);
          expect(result.errors[0]!.message).toContain('not found');
        },
      ),
      { numRuns: 50 },
    );
  });

  it('within a single import batch, duplicate IUS-area-timeperiod combinations are detected', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbGid('IND'),
        arbGid('UNIT'),
        arbGid('SG'),
        arbAreaExternalId(),
        arbTimePeriodLabel(),
        arbDataValue(),
        arbDataValue(),
        fc.integer({ min: 2, max: 5 }),
        async (
          indicatorGid,
          unitGid,
          subgroupGid,
          areaId,
          timePeriod,
          value1,
          value2,
          duplicateCount,
        ) => {
          // Set up warehouse with reference data
          const { warehouseId } = await setupWarehouse({
            indicatorGids: [indicatorGid],
            unitGids: [unitGid],
            subgroupGids: [subgroupGid],
            areaExternalIds: [areaId],
            timePeriodLabels: [timePeriod],
          });

          // Create a batch with duplicates: first record is unique, rest are duplicates
          const records = Array.from({ length: duplicateCount }, (_, i) => ({
            indicatorGid,
            unitGid,
            subgroupGid,
            areaId,
            timePeriod,
            dataValue: i === 0 ? value1 : value2,
          }));

          const result = await service.importData(tenantId, warehouseId, 'csv', { records });

          // First record should succeed, remaining should be detected as duplicates
          expect(result.totalRows).toBe(duplicateCount);
          expect(result.successCount).toBe(1);
          expect(result.duplicateCount).toBe(duplicateCount - 1);
          expect(result.errorCount).toBe(duplicateCount - 1);

          // Each duplicate error should mention "Duplicate" and "within import batch"
          const duplicateErrors = result.errors.filter((e) => e.message.includes('Duplicate'));
          expect(duplicateErrors.length).toBe(duplicateCount - 1);
          for (const error of duplicateErrors) {
            expect(error.message).toContain('within import batch');
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
