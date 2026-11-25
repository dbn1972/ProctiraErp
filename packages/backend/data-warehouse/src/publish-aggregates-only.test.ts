/**
 * PRC-L553 (DR46): publishing exposes aggregates only. Free-text values are not
 * published, a cell below the minimum size (10) is suppressed, and only tenant
 * staff with the publish (data-admin/admin) role may publish.
 */
import { describe, expect, it } from 'vitest';
import { DataWarehouseService } from './data-warehouse-service.js';
import { InMemoryWarehouseRepository } from './in-memory-repository.js';
import { PublishingService } from './publishing-service.js';

const T = 'tenant-1';
const PUBLISHER = { actorId: 'publisher-1', roles: ['data_admin'] };

async function warehouseWith(values: Array<{ area: string; value?: number; text?: string }>) {
  const repo = new InMemoryWarehouseRepository();
  const dw = new DataWarehouseService(repo, { maxImportBatchSize: 100 });
  const wh = (await dw.createWarehouse(T, { name: 'DW' })).id;
  await dw.createIndicator(T, wh, { name: 'Enrolled', gid: 'ENR' });
  await dw.createUnit(T, wh, { name: 'Number', gid: 'NUM' });
  await dw.createSubgroup(T, wh, { name: 'Girls', gid: 'G' });
  await dw.createTimePeriod(T, wh, { timePeriod: '2024' });
  for (const v of values) {
    await dw.createArea(T, wh, { name: v.area, areaId: v.area, gid: v.area, level: 0 });
  }
  const imported = await dw.importData(T, wh, 'csv', {
    records: values.map((v) => ({
      indicatorGid: 'ENR',
      unitGid: 'NUM',
      subgroupGid: 'G',
      areaId: v.area,
      timePeriod: '2024',
      ...(v.value !== undefined ? { dataValue: v.value } : {}),
      ...(v.text !== undefined ? { textualDataValue: v.text } : {}),
    })),
  });
  expect(imported.successCount).toBe(values.length);
  const publishing = new PublishingService(repo, null, null, {
    apiBaseUrl: 'https://api.example.test',
    webBaseUrl: 'https://web.example.test',
    mobileBaseUrl: 'https://m.example.test',
  });
  return { publishing, wh };
}

describe('PRC-L553 aggregates-only publishing', () => {
  it('suppresses cells below 10 and never publishes free text', async () => {
    const { publishing, wh } = await warehouseWith([
      { area: 'A1', value: 3 },
      { area: 'A2', value: 42 },
      { area: 'A3', value: 0 },
      { area: 'A4', text: 'Asha Rao (roll 12) withdrew' },
    ]);
    const result = await publishing.publishData(T, wh, { target: 'api' }, PUBLISHER);
    const byArea = Object.fromEntries(result.payload.data.map((d) => [d.areaId, d]));
    expect(byArea['A1']).toMatchObject({ value: null, suppressed: true });
    expect(byArea['A2']).toMatchObject({ value: 42, suppressed: false });
    expect(byArea['A3']).toMatchObject({ value: 0, suppressed: false });
    expect(byArea['A4']).toMatchObject({ textValue: null });
    expect(JSON.stringify(result.payload)).not.toContain('Asha');
  });

  it('refuses a caller without the publish role', async () => {
    const { publishing, wh } = await warehouseWith([{ area: 'A1', value: 42 }]);
    await expect(
      publishing.publishData(T, wh, { target: 'api' }, { actorId: 'u-1', roles: ['data_analyst'] }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(publishing.publishData(T, wh, { target: 'api' })).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
