/**
 * Audit events for every mutation (PRC-L452): exactly one event per successful
 * mutating call, carrying tenant + actor, with counts but no row payloads.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DataWarehouseAuditEvent } from './audit.js';
import { dataWarehousePlugin } from './data-warehouse-plugin.js';
import { DataWarehouseService } from './data-warehouse-service.js';
import { GISService } from './gis-service.js';
import { InMemoryGISRepository } from './in-memory-gis-repository.js';
import { InMemoryWarehouseRepository } from './in-memory-repository.js';
import { InMemoryTranslationRepository } from './in-memory-translation-repository.js';
import { PublishingService } from './publishing-service.js';
import { TranslationService } from './translation-service.js';

const TENANT = 'tenant-a';
const ACTOR = 'user-123';

describe('audit events via routes (PRC-L452)', () => {
  let app: FastifyInstance;
  let events: DataWarehouseAuditEvent[];

  beforeEach(async () => {
    events = [];
    app = Fastify();
    app.addHook('onRequest', async (request) => {
      (request as typeof request & { tenantId?: string }).tenantId = TENANT;
      (request as typeof request & { user?: { sub: string } }).user = { sub: ACTOR };
    });
    await app.register(dataWarehousePlugin, {
      repository: new InMemoryWarehouseRepository(),
      config: { maxImportBatchSize: 100 },
      auditSink: (e) => {
        events.push(e);
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function call(method: 'POST' | 'PUT' | 'DELETE' | 'GET', url: string, payload?: object) {
    const before = events.length;
    const res = await app.inject({ method, url, payload });
    return { res, emitted: events.slice(before) };
  }

  it('emits exactly one event with tenant and actor per mutation', async () => {
    const created = await call('POST', '/warehouses', { name: 'Secret Name' });
    expect(created.res.statusCode).toBe(201);
    expect(created.emitted).toHaveLength(1);
    const wh = (created.res.json() as { id: string }).id;
    expect(created.emitted[0]).toMatchObject({
      tenantId: TENANT,
      actorId: ACTOR,
      action: 'warehouse.create',
      resourceId: wh,
    });

    const steps: Array<[string, object, string]> = [
      [`/warehouses/${wh}/indicators`, { name: 'I', gid: 'I1' }, 'indicator.create'],
      [`/warehouses/${wh}/units`, { name: 'U', gid: 'U1' }, 'unit.create'],
      [`/warehouses/${wh}/subgroups`, { name: 'S', gid: 'S1' }, 'subgroup.create'],
      [`/warehouses/${wh}/time-periods`, { timePeriod: '2024' }, 'time_period.create'],
      [`/warehouses/${wh}/areas`, { name: 'A', areaId: 'A1', gid: 'A1', level: 0 }, 'area.create'],
    ];
    for (const [url, body, action] of steps) {
      const { res, emitted } = await call('POST', url, body);
      expect(res.statusCode).toBe(201);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        tenantId: TENANT,
        actorId: ACTOR,
        action,
        warehouseId: wh,
      });
    }

    const imported = await call('POST', `/warehouses/${wh}/import`, {
      format: 'csv',
      records: [
        {
          indicatorGid: 'I1',
          unitGid: 'U1',
          subgroupGid: 'S1',
          areaId: 'A1',
          timePeriod: '2024',
          dataValue: 98765.4321,
        },
      ],
    });
    expect(imported.res.statusCode).toBe(200);
    expect(imported.emitted).toHaveLength(1);
    expect(imported.emitted[0]).toMatchObject({
      action: 'data.import',
      counts: { totalRows: 1, successCount: 1 },
    });

    const updated = await call('PUT', `/warehouses/${wh}`, { name: 'Renamed' });
    expect(updated.res.statusCode).toBe(200);
    expect(updated.emitted).toHaveLength(1);
    expect(updated.emitted[0]!.action).toBe('warehouse.update');

    const deleted = await call('DELETE', `/warehouses/${wh}`);
    expect(deleted.res.statusCode).toBe(204);
    expect(deleted.emitted).toHaveLength(1);
    expect(deleted.emitted[0]).toMatchObject({ action: 'warehouse.delete', resourceId: wh });

    // No row payloads in any event.
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('Secret Name');
    expect(serialized).not.toContain('Renamed');
    expect(serialized).not.toContain('98765.4321');
  });

  it('emits nothing for reads or failed mutations', async () => {
    await call('GET', '/warehouses');
    const failed = await call('DELETE', '/warehouses/00000000-0000-4000-8000-000000000000');
    expect(failed.res.statusCode).toBe(404);
    expect(events).toHaveLength(0);
  });
});

describe('audit events in GIS / translation / publishing services (PRC-L452)', () => {
  it('emits one event per mutation with counts only', async () => {
    const events: DataWarehouseAuditEvent[] = [];
    const sink = (e: DataWarehouseAuditEvent) => {
      events.push(e);
    };
    const ctx = { actorId: ACTOR };
    const repo = new InMemoryWarehouseRepository();
    const dw = new DataWarehouseService(repo, { maxImportBatchSize: 100 });
    const wh = (await dw.createWarehouse(TENANT, { name: 'DW' })).id;
    const area = await dw.createArea(TENANT, wh, { name: 'A', areaId: 'A', gid: 'A', level: 0 });

    const gis = new GISService(
      new InMemoryGISRepository(repo),
      repo,
      { maxLayerFileSize: 100000, supportedCRS: ['EPSG:4326'] },
      { auditSink: sink },
    );
    const layer = await gis.createLayer(
      TENANT,
      wh,
      { areaId: area.id, name: 'L', layerType: 'geojson' },
      ctx,
    );
    await gis.updateLayer(TENANT, wh, layer.id, { name: 'L2' }, ctx);
    await gis.deleteLayer(TENANT, wh, layer.id, ctx);

    const trRepo = new InMemoryTranslationRepository();
    const tr = new TranslationService(
      trRepo,
      repo,
      { supportedLanguages: ['en', 'fr'], maxImportBatchSize: 100 },
      { auditSink: sink },
    );
    await tr.setTranslation(
      TENANT,
      wh,
      { entityType: 'area', entityId: area.id, language: 'fr', field: 'name', value: 'Zone X' },
      ctx,
    );
    await tr.importTranslations(
      TENANT,
      wh,
      {
        format: 'csv',
        content: `entityType,entityId,language,field,value\narea,${area.id},fr,name,Zone Y\n`,
      },
      ctx,
    );

    const pub = new PublishingService(
      repo,
      null,
      trRepo,
      {
        apiBaseUrl: 'https://a.test',
        webBaseUrl: 'https://w.test',
        mobileBaseUrl: 'https://m.test',
      },
      { auditSink: sink },
    );
    await pub.publishData(TENANT, wh, { target: 'api' }, ctx);

    expect(events.map((e) => e.action)).toEqual([
      'gis_layer.create',
      'gis_layer.update',
      'gis_layer.delete',
      'translation.set',
      'translation.import',
      'data.publish',
    ]);
    for (const e of events) {
      expect(e).toMatchObject({ tenantId: TENANT, actorId: ACTOR, warehouseId: wh });
    }
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('Zone X');
    expect(serialized).not.toContain('Zone Y');
  });
});
