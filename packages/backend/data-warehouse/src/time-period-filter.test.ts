/**
 * PRC-M593 — a time-period filter whose labels are all unknown must not widen to all data.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { DataWarehouseService } from './data-warehouse-service.js';
import { InMemoryWarehouseRepository } from './in-memory-repository.js';
import { PublishingService } from './publishing-service.js';

const T = 'tenant-1';

describe('unknown time-period labels fail closed (PRC-M593)', () => {
  let repo: InMemoryWarehouseRepository;
  let dw: DataWarehouseService;
  let wh: string;
  let publishing: PublishingService;

  beforeEach(async () => {
    repo = new InMemoryWarehouseRepository();
    dw = new DataWarehouseService(repo, { maxImportBatchSize: 100 });
    wh = (await dw.createWarehouse(T, { name: 'DW' })).id;
    await dw.createIndicator(T, wh, { name: 'I', gid: 'I1' });
    await dw.createUnit(T, wh, { name: 'U', gid: 'U1' });
    await dw.createSubgroup(T, wh, { name: 'S', gid: 'S1' });
    await dw.createArea(T, wh, { name: 'A', areaId: 'A1', gid: 'A1', level: 0 });
    await dw.createTimePeriod(T, wh, { timePeriod: '2023' });
    await dw.createTimePeriod(T, wh, { timePeriod: '2024' });
    const base = { indicatorGid: 'I1', unitGid: 'U1', subgroupGid: 'S1', areaId: 'A1' };
    const imported = await dw.importData(T, wh, 'csv', {
      records: [
        { ...base, timePeriod: '2023', dataValue: 1 },
        { ...base, timePeriod: '2024', dataValue: 2 },
      ],
    });
    expect(imported.successCount).toBe(2);
    publishing = new PublishingService(repo, null, null, {
      apiBaseUrl: 'https://api.example.test',
      webBaseUrl: 'https://web.example.test',
      mobileBaseUrl: 'https://m.example.test',
    });
  });

  it('queryData with only unknown labels returns nothing', async () => {
    const result = await dw.queryData(T, wh, { timePeriods: ['1999'] }, 1, 50);
    expect(result.total).toBe(0);
    expect(result.data).toHaveLength(0);
  });

  it('queryData with known + unknown labels narrows to the known periods', async () => {
    const result = await dw.queryData(T, wh, { timePeriods: ['2023', '1999'] }, 1, 50);
    expect(result.total).toBe(1);
    expect(result.data[0]!.dataValue).toBe(1);
  });

  it('queryData without a time-period filter still returns everything', async () => {
    expect((await dw.queryData(T, wh, {}, 1, 50)).total).toBe(2);
  });

  it('publish with only unknown labels publishes zero records', async () => {
    const result = await publishing.publishData(T, wh, { target: 'api', timePeriods: ['1999'] });
    expect(result.recordCount).toBe(0);
  });

  it('publish with known + unknown labels publishes only the known periods', async () => {
    const result = await publishing.publishData(T, wh, {
      target: 'api',
      timePeriods: ['2023', '1999'],
    });
    expect(result.recordCount).toBe(1);
  });
});
