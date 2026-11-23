/**
 * PRC-M552 — the CDC "Kafka-based sync" never published to Kafka, labelled every change
 * UPDATE, and inserted rows without a UUID or tenant_id. These tests pin:
 *  - captured events are INSERT unless the legacy row already has a migration_uuid_map row;
 *  - events are published to Kafka (idempotent producer, acks=all, row-ordered key)
 *    before they are applied, and a failed publish does not advance the sync position;
 *  - an INSERT gets the mapped UUID, the migration tenant_id and remapped foreign keys.
 */
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  CDCConsumer,
  CDCProducer,
  createKafkaCdcPublisher,
  syncTableCycle,
  type CDCEvent,
  type CDCSyncConfig,
  type SyncPosition,
} from './cdc-sync.js';
import { TABLE_MAPPINGS } from './table-mappings.js';
import type { MigrationConfig, TableMapping } from './types.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const cdcConfig: CDCSyncConfig = {
  kafkaBrokers: ['localhost:9092'],
  kafkaClientId: 'test',
  consumerGroupId: 'test',
  topicPrefix: 'cdc.test',
  pollIntervalMs: 1000,
  batchSize: 100,
  tenantId: TENANT,
  conflictResolution: 'source_wins',
};
const migrationConfig = { pg: { schema: 'public' } } as unknown as MigrationConfig;

function event(overrides: Partial<CDCEvent> = {}): CDCEvent {
  return {
    id: 'evt-1',
    tenantId: TENANT,
    operation: 'INSERT',
    sourceTable: 'institution_classes',
    targetTable: 'classes',
    legacyId: 42,
    data: { id: 42, name: '5A' },
    sourceTimestamp: '2025-01-02T00:00:00.000Z',
    capturedAt: '2025-01-02T00:00:00.000Z',
    sequence: 1,
    ...overrides,
  };
}

describe('PRC-M552 operation is decided from migration_uuid_map', () => {
  it('captures INSERT for an unmapped legacy row and UPDATE for a mapped one', async () => {
    const mapping = TABLE_MAPPINGS[0]!;
    const mapped = new Set([`${mapping.sourceTable}:2`]);
    const pgClient = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() };
    const pgPool = {
      connect: vi.fn(async () => pgClient),
      query: vi.fn(async (_sql: string, params: unknown[]) => ({
        rows: mapped.has(`${params[0]}:${params[1]}`) ? [{ found: 1 }] : [],
      })),
    } as unknown as Pool;
    const sourceClient = {
      query: vi.fn(async () => ({
        rows: [
          { [mapping.legacyPkColumn]: 1, modified: '2025-01-01T00:00:00Z' },
          { [mapping.legacyPkColumn]: 2, modified: '2025-01-01T00:00:01Z' },
        ],
      })),
      release: vi.fn(),
    };
    const sourcePool = { connect: vi.fn(async () => sourceClient) } as unknown as Pool;
    const producer = new CDCProducer(cdcConfig, migrationConfig);
    await producer.initialize(pgPool);
    const events = await producer.captureChanges(sourcePool, mapping);
    expect(events.map((e) => [e.legacyId, e.operation])).toEqual([
      [1, 'INSERT'],
      [2, 'UPDATE'],
    ]);
  });
});

describe('PRC-M552 Kafka publish', () => {
  function fakeKafka(fail = false) {
    const sent: Array<Record<string, unknown>> = [];
    const producerConfigs: unknown[] = [];
    const producer = {
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      send: vi.fn(async (record: Record<string, unknown>) => {
        if (fail) throw new Error('broker unavailable');
        sent.push(record);
        return [];
      }),
    };
    const kafka = {
      producer: (config: unknown) => {
        producerConfigs.push(config);
        return producer as never;
      },
    };
    return { kafka, producer, sent, producerConfigs };
  }

  it('publishes with an idempotent producer, acks=all and a per-row key', async () => {
    const k = fakeKafka();
    const publisher = createKafkaCdcPublisher(cdcConfig, { kafka: k.kafka });
    await publisher.publish('cdc.test.t.institution_classes', [event()]);
    await publisher.disconnect();
    expect(k.producerConfigs).toEqual([{ idempotent: true, maxInFlightRequests: 1 }]);
    expect(k.sent).toHaveLength(1);
    const record = k.sent[0] as {
      topic: string;
      acks: number;
      messages: Array<{ key: string; value: string }>;
    };
    expect(record.topic).toBe('cdc.test.t.institution_classes');
    expect(record.acks).toBe(-1);
    expect(record.messages[0]!.key).toBe('institution_classes:42');
    expect(JSON.parse(record.messages[0]!.value)).toMatchObject({
      legacyId: 42,
      operation: 'INSERT',
    });
    expect(k.producer.disconnect).toHaveBeenCalled();
  });

  it('syncTableCycle publishes before apply and keeps the position when publish fails', async () => {
    const position: SyncPosition = {
      table: 'institution_classes',
      lastSyncedAt: '2025-01-01T00:00:00.000Z',
      lastSequence: 3,
      lastLegacyId: 7,
      status: 'active',
    };
    const order: string[] = [];
    const producer = {
      captureChanges: vi.fn(async () => {
        position.lastSequence = 4;
        position.lastLegacyId = 42;
        return [event()];
      }),
      commitPosition: vi.fn(async () => undefined),
      buildTopicName: (table: string) => `cdc.test.${TENANT}.${table}`,
    };
    const consumer = {
      processBatch: vi.fn(async () => {
        order.push('apply');
        return { totalEvents: 1, applied: 1, skipped: 0, errors: 0, results: [] };
      }),
    };
    const pool = {} as Pool;
    const mapping = { sourceTable: 'institution_classes' } as TableMapping;

    const ok = await syncTableCycle(producer, consumer, pool, pool, mapping, position, {
      publish: async (topic) => {
        order.push(`publish:${topic}`);
      },
      disconnect: async () => undefined,
    });
    expect(ok.error).toBeUndefined();
    expect(order).toEqual([`publish:cdc.test.${TENANT}.institution_classes`, 'apply']);

    position.lastSequence = 3;
    position.lastLegacyId = 7;
    consumer.processBatch.mockClear();
    producer.commitPosition.mockClear();
    const failed = await syncTableCycle(producer, consumer, pool, pool, mapping, position, {
      publish: async () => {
        throw new Error('broker unavailable');
      },
      disconnect: async () => undefined,
    });
    expect(failed.error).toContain('broker unavailable');
    expect(consumer.processBatch).not.toHaveBeenCalled();
    expect(producer.commitPosition).not.toHaveBeenCalled();
    expect(position.lastSequence).toBe(3);
    expect(position.lastLegacyId).toBe(7);
  });
});

describe('PRC-M552 INSERT gets a mapped UUID, tenant_id and remapped foreign keys', () => {
  function fakeTarget(options: { hasTenantColumn: boolean; mappings: Record<string, string> }) {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        const q = sql.trim();
        statements.push({ sql: q, params });
        if (q.startsWith('INSERT INTO migration_uuid_map')) {
          return {
            rows: [{ new_uuid: options.mappings[`${params[0]}:${params[1]}`] ?? params[2] }],
          };
        }
        if (q.startsWith('SELECT new_uuid FROM migration_uuid_map')) {
          const key = `${params[0]}:${params[1]}`;
          return { rows: options.mappings[key] ? [{ new_uuid: options.mappings[key] }] : [] };
        }
        if (q.includes('information_schema.columns')) {
          return { rows: options.hasTenantColumn ? [{ found: 1 }] : [] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
    const inserted = () =>
      statements.find((s) => s.sql.startsWith('INSERT INTO "public"."classes"'));
    return { pool, statements, inserted };
  }

  const classes = TABLE_MAPPINGS.find((m) => m.sourceTable === 'institution_classes')!;
  const fk = classes.foreignKeys[0]!;

  it('writes id = mapped UUID, tenant_id = migration tenant, FK = referenced UUID', async () => {
    const target = fakeTarget({
      hasTenantColumn: true,
      mappings: {
        'institution_classes:42': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        [`${fk.referencesTable}:9`]: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    });
    const consumer = new CDCConsumer(cdcConfig, migrationConfig);
    const result = await consumer.processBatch(target.pool, [
      event({ data: { id: 42, name: '5A', [fk.column]: 9 } }),
    ]);
    expect(result.errors).toBe(0);
    const insert = target.inserted();
    expect(insert).toBeDefined();
    const columns = insert!.sql
      .match(/\(([^)]*)\)/)![1]!
      .split(',')
      .map((c) => c.trim());
    const row = Object.fromEntries(columns.map((c, i) => [c.replace(/"/g, ''), insert!.params[i]]));
    expect(row).toMatchObject({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tenant_id: TENANT,
      [fk.column]: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      name: '5A',
    });
  });

  it('fails the event (no row written) when a foreign key has no mapping', async () => {
    const target = fakeTarget({ hasTenantColumn: true, mappings: {} });
    const consumer = new CDCConsumer(cdcConfig, migrationConfig);
    const result = await consumer.processBatch(target.pool, [
      event({ data: { id: 42, name: '5A', [fk.column]: 9 } }),
    ]);
    expect(result.errors).toBe(1);
    expect(result.results[0]!.error).toMatch(/Unmapped foreign key/);
    expect(target.inserted()).toBeUndefined();
  });
});
