/**
 * CSV/TSV import parsing (PRC-L549): CRLF, quoted fields, strict numerics.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { DataWarehouseService } from './data-warehouse-service.js';
import { parseCsvImport, parseDelimited } from './import-service.js';
import { InMemoryWarehouseRepository } from './in-memory-repository.js';

const HEADER = 'indicatorGid,unitGid,subgroupGid,areaId,timePeriod,dataValue,source';

describe('CSV import parsing (PRC-L549)', () => {
  it('handles CRLF line endings without residue', () => {
    const { records, rowErrors } = parseCsvImport(
      `${HEADER}\r\nI1,U1,S1,A1,2024,12.5,Census\r\n\r\n`,
    );
    expect(rowErrors.size).toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ dataValue: 12.5, source: 'Census' });
  });

  it('maps quoted fields containing commas and escaped quotes', () => {
    const { records } = parseCsvImport(
      `${HEADER}\nI1,U1,S1,A1,2024,7,"Ministry, ""Dept"" of Education"\n`,
    );
    expect(records[0]!.source).toBe('Ministry, "Dept" of Education');
    expect(records[0]!.dataValue).toBe(7);
  });

  it('supports newlines inside quoted fields', () => {
    expect(parseDelimited('a,b\n"x\ny",z\n', ',')).toEqual([
      ['a', 'b'],
      ['x\ny', 'z'],
    ]);
  });

  it('rejects numeric-looking garbage such as "12abc"', () => {
    const { records, rowErrors } = parseCsvImport(`${HEADER}\nI1,U1,S1,A1,2024,12abc,\n`);
    expect(records[0]!.dataValue).toBeUndefined();
    expect(rowErrors.get(0)).toMatchObject({ field: 'dataValue' });
  });

  it('keeps genuinely textual values as textualDataValue', () => {
    const { records, rowErrors } = parseCsvImport(`${HEADER}\nI1,U1,S1,A1,2024,NA,\n`);
    expect(rowErrors.size).toBe(0);
    expect(records[0]!.textualDataValue).toBe('NA');
  });

  describe('importData end to end', () => {
    let service: DataWarehouseService;
    let wh: string;
    const T = 'tenant-1';

    beforeEach(async () => {
      service = new DataWarehouseService(new InMemoryWarehouseRepository(), {
        maxImportBatchSize: 100,
      });
      wh = (await service.createWarehouse(T, { name: 'DW' })).id;
      await service.createIndicator(T, wh, { name: 'I', gid: 'I1' });
      await service.createUnit(T, wh, { name: 'U', gid: 'U1' });
      await service.createSubgroup(T, wh, { name: 'S', gid: 'S1' });
      await service.createArea(T, wh, { name: 'A', areaId: 'A1', gid: 'A1', level: 0 });
      await service.createArea(T, wh, { name: 'B', areaId: 'A2', gid: 'A2', level: 0 });
      await service.createTimePeriod(T, wh, { timePeriod: '2024' });
    });

    it('imports CRLF rows and reports "12abc" as a row error', async () => {
      const csv = `${HEADER}\r\nI1,U1,S1,A1,2024,10,"Src, A"\r\nI1,U1,S1,A2,2024,12abc,\r\n`;
      const result = await service.importData(T, wh, 'csv', {
        fileContent: Buffer.from(csv).toString('base64'),
      });
      expect(result.totalRows).toBe(2);
      expect(result.successCount).toBe(1);
      expect(result.errorCount).toBe(1);
      expect(result.errors[0]).toMatchObject({ row: 2, field: 'dataValue' });
    });
  });
});
