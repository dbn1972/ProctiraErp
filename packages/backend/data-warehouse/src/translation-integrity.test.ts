/**
 * PRC-L554 — translation language codes / field names are validated, and translations are
 * deleted together with the indicator / unit / subgroup / area they describe.
 */
import { validate } from '@proctira/validation';
import { beforeEach, describe, expect, it } from 'vitest';

import { DataWarehouseService } from './data-warehouse-service.js';
import { InMemoryWarehouseRepository } from './in-memory-repository.js';
import { InMemoryTranslationRepository } from './in-memory-translation-repository.js';
import { CreateTranslationSchema, type TranslatableEntityType } from './translation-schemas.js';
import { TranslationService } from './translation-service.js';

const T = 'tenant-1';

describe('translation integrity (PRC-L554)', () => {
  let repo: InMemoryWarehouseRepository;
  let translationRepo: InMemoryTranslationRepository;
  let dw: DataWarehouseService;
  let tr: TranslationService;
  let wh: string;
  let ids: Record<TranslatableEntityType, string>;

  beforeEach(async () => {
    repo = new InMemoryWarehouseRepository();
    translationRepo = new InMemoryTranslationRepository();
    dw = new DataWarehouseService(
      repo,
      { maxImportBatchSize: 100 },
      { translationRepository: translationRepo },
    );
    tr = new TranslationService(translationRepo, repo, {
      supportedLanguages: ['en', 'fr'],
      maxImportBatchSize: 100,
    });
    wh = (await dw.createWarehouse(T, { name: 'DW' })).id;
    ids = {
      indicator: (await dw.createIndicator(T, wh, { name: 'I', gid: 'I1' })).id,
      unit: (await dw.createUnit(T, wh, { name: 'U', gid: 'U1' })).id,
      subgroup: (await dw.createSubgroup(T, wh, { name: 'S', gid: 'S1' })).id,
      area: (await dw.createArea(T, wh, { name: 'A', areaId: 'A1', gid: 'A1', level: 0 })).id,
    };
    for (const entityType of Object.keys(ids) as TranslatableEntityType[]) {
      await tr.setTranslation(T, wh, {
        entityType,
        entityId: ids[entityType],
        language: 'fr',
        field: 'name',
        value: `fr-${entityType}`,
      });
    }
  });

  const count = (entityType: TranslatableEntityType) =>
    translationRepo
      .getTranslationsForEntity(wh, T, entityType, ids[entityType])
      .then((rows) => rows.length);

  it('deleting an indicator / unit / subgroup / area removes its translations', async () => {
    await dw.deleteIndicator(T, wh, ids.indicator);
    expect(await count('indicator')).toBe(0);
    expect(await count('unit')).toBe(1);

    await dw.deleteUnit(T, wh, ids.unit);
    await dw.deleteSubgroup(T, wh, ids.subgroup);
    await dw.deleteArea(T, wh, ids.area);
    expect(await count('unit')).toBe(0);
    expect(await count('subgroup')).toBe(0);
    expect(await count('area')).toBe(0);
  });

  it('import rejects rows with an invalid language code or field name', async () => {
    const content = JSON.stringify([
      {
        entityType: 'indicator',
        entityId: ids.indicator,
        language: 'english!!',
        field: 'name',
        value: 'x',
      },
      {
        entityType: 'indicator',
        entityId: ids.indicator,
        language: 'fr',
        field: 'na me',
        value: 'x',
      },
      {
        entityType: 'indicator',
        entityId: ids.indicator,
        language: 'hi-IN',
        field: 'shortName',
        value: 'ok',
      },
    ]);
    const result = await tr.importTranslations(T, wh, { format: 'json', content });
    expect(result.successCount).toBe(1);
    expect(result.errors.map((e) => [e.row, e.field])).toEqual([
      [1, 'language'],
      [2, 'field'],
    ]);
  });

  it('setTranslation and batch reject an invalid language code or field name', async () => {
    const base = { entityType: 'indicator' as const, entityId: ids.indicator, value: 'x' };
    await expect(
      tr.setTranslation(T, wh, { ...base, language: '../etc', field: 'name' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      tr.setTranslation(T, wh, { ...base, language: 'fr', field: 'name;drop' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    const batch = await tr.setTranslationsBatch(T, wh, {
      translations: [
        { ...base, language: 'fr', field: 'na me' },
        { ...base, language: 'fr', field: 'info' },
      ],
    });
    expect(batch.successCount).toBe(1);
    expect(batch.errors.map((e) => e.index)).toEqual([0]);
  });

  it('CreateTranslationSchema rejects bad language/field and accepts BCP-47 style codes', () => {
    const ok = (language: string, field: string) =>
      validate(CreateTranslationSchema, {
        entityType: 'indicator',
        entityId: '550e8400-e29b-41d4-a716-446655440000',
        language,
        field,
        value: 'v',
      }).success;
    expect(ok('en', 'name')).toBe(true);
    expect(ok('hi-IN', 'shortName')).toBe(true);
    expect(ok('zh-Hant-TW', 'info')).toBe(true);
    expect(ok('english!!', 'name')).toBe(false);
    expect(ok('EN', 'name')).toBe(false);
    expect(ok('fr', 'na me')).toBe(false);
    expect(ok('fr', '1name')).toBe(false);
  });
});
