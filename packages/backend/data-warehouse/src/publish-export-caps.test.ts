/**
 * Publishing / translation export must not silently truncate (PRC-L458).
 * Repositories here enforce a hard page cap, as a real DB adapter would.
 */
import { describe, expect, it } from 'vitest';

import { DataWarehouseService } from './data-warehouse-service.js';
import { InMemoryWarehouseRepository } from './in-memory-repository.js';
import { InMemoryTranslationRepository } from './in-memory-translation-repository.js';
import { PublishingService } from './publishing-service.js';
import { TranslationService } from './translation-service.js';

const CAP = 5;
const T = 'tenant-1';

class CappedWarehouseRepository extends InMemoryWarehouseRepository {
  override queryData(...args: Parameters<InMemoryWarehouseRepository['queryData']>) {
    const [w, t, f, page, pageSize] = args;
    return super.queryData(w, t, f, page, Math.min(pageSize, CAP));
  }
}

class CappedTranslationRepository extends InMemoryTranslationRepository {
  override listTranslations(
    ...args: Parameters<InMemoryTranslationRepository['listTranslations']>
  ) {
    const [w, t, o] = args;
    return super.listTranslations(w, t, { ...o, pageSize: Math.min(o.pageSize ?? CAP, CAP) });
  }
}

describe('no silent caps (PRC-L458)', () => {
  it('publishes all cap+1 data records', async () => {
    const repo = new CappedWarehouseRepository();
    const dw = new DataWarehouseService(repo, { maxImportBatchSize: 100 });
    const wh = (await dw.createWarehouse(T, { name: 'DW' })).id;
    await dw.createIndicator(T, wh, { name: 'I', gid: 'I1' });
    await dw.createUnit(T, wh, { name: 'U', gid: 'U1' });
    await dw.createSubgroup(T, wh, { name: 'S', gid: 'S1' });
    await dw.createTimePeriod(T, wh, { timePeriod: '2024' });
    const records = [];
    for (let i = 0; i < CAP + 1; i++) {
      await dw.createArea(T, wh, { name: `A${i}`, areaId: `A${i}`, gid: `A${i}`, level: 0 });
      records.push({
        indicatorGid: 'I1',
        unitGid: 'U1',
        subgroupGid: 'S1',
        areaId: `A${i}`,
        timePeriod: '2024',
        dataValue: i,
      });
    }
    const imported = await dw.importData(T, wh, 'csv', { records });
    expect(imported.successCount).toBe(CAP + 1);

    const publishing = new PublishingService(repo, null, null, {
      apiBaseUrl: 'https://api.example.test',
      webBaseUrl: 'https://web.example.test',
      mobileBaseUrl: 'https://m.example.test',
      fetchPageSize: CAP,
    });
    const result = await publishing.publishData(T, wh, { target: 'api' });
    expect(result.recordCount).toBe(CAP + 1);
  });

  it('exports all cap+1 translations', async () => {
    const repo = new InMemoryWarehouseRepository();
    const dw = new DataWarehouseService(repo, { maxImportBatchSize: 100 });
    const wh = (await dw.createWarehouse(T, { name: 'DW' })).id;
    const tr = new TranslationService(new CappedTranslationRepository(), repo, {
      supportedLanguages: ['en', 'fr'],
      maxImportBatchSize: 100,
      fetchPageSize: CAP,
    });
    for (let i = 0; i < CAP + 1; i++) {
      const area = await dw.createArea(T, wh, {
        name: `A${i}`,
        areaId: `A${i}`,
        gid: `A${i}`,
        level: 0,
      });
      await tr.setTranslation(T, wh, {
        entityType: 'area',
        entityId: area.id,
        language: 'fr',
        field: 'name',
        value: `Zone ${i}`,
      });
    }
    const exported = await tr.exportTranslations(T, wh, { format: 'json' });
    expect(exported.totalRecords).toBe(CAP + 1);
  });
});
