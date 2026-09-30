/**
 * Data-integrity regression tests for CDC sync (PRC-H103):
 * - mapping lookups use the real migration_uuid_map table,
 * - a poison event does not abort the rest of the batch (per-event SAVEPOINT),
 * - the sync position is only persisted when every event applied.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { CDCConsumer, CDCEvent, CDCSyncConfig, SyncPosition, syncTableCycle } from './cdc-sync.js';
import { MIGRATION_UUID_MAP_TABLE, MigrationConfig, TableMapping } from './types.js';

const migrationConfig = {
  pg: { schema: 'public' },
} as unknown as MigrationConfig;

const cdcConfig: CDCSyncConfig = {
  kafkaBrokers: ['localhost:9092'],
  kafkaClientId: 'test',
  consumerGroupId: 'test',
  topicPrefix: 'cdc.test',
  pollIntervalMs: 1000,
  batchSize: 100,
  tenantId: 'tenant-1',
  conflictResolution: 'source_wins',
};

/**
 * Minimal Postgres transaction simulator: knows only migration_uuid_map, rejects
 * the "poison" table, and aborts the transaction after an error exactly like PG
 * (every statement fails until ROLLBACK / ROLLBACK TO SAVEPOINT).
 */
function fakePool(mappings: Record<string, string>) {
  const applied: string[] = [];
  let pending: string[] = [];
  let savepoint: string[] = [];
  let aborted = false;
  let committed = false;
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const q = sql.trim();
      if (q === 'BEGIN') {
        pending = [];
        return { rows: [] };
      }
      if (q.startsWith('ROLLBACK TO SAVEPOINT')) {
        aborted = false;
        pending = [...savepoint];
        return { rows: [] };
      }
      if (q === 'ROLLBACK') {
        aborted = false;
        pending = [];
        return { rows: [] };
      }
      if (aborted) {
        if (q === 'COMMIT') {
          // PG turns COMMIT of an aborted transaction into ROLLBACK.
          pending = [];
          aborted = false;
          return { rows: [] };
        }
        throw new Error('current transaction is aborted');
      }
      if (q.startsWith('SAVEPOINT')) {
        savepoint = [...pending];
        return { rows: [] };
      }
      if (q.startsWith('RELEASE SAVEPOINT')) return { rows: [] };
      if (q === 'COMMIT') {
        applied.push(...pending);
        committed = true;
        return { rows: [] };
      }
      if (q.startsWith('SELECT new_uuid FROM')) {
        if (!q.includes(`FROM ${MIGRATION_UUID_MAP_TABLE}\n`)) {
          aborted = true;
          throw new Error('relation does not exist');
        }
        const key = `${params[0]}:${params[1]}`;
        return { rows: mappings[key] ? [{ new_uuid: mappings[key] }] : [] };
      }
      if (q.includes('"poison"')) {
        aborted = true;
        throw new Error('poison event');
      }
      if (q.startsWith('UPDATE') || q.startsWith('INSERT')) {
        pending.push(`${q.split('\n')[0]} ${JSON.stringify(params)}`);
        return { rows: [] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, applied, isCommitted: () => committed };
}

function event(targetTable: string, legacyId: number): CDCEvent {
  return {
    id: `evt-${targetTable}-${legacyId}`,
    tenantId: 'tenant-1',
    operation: 'UPDATE',
    sourceTable: 'security_users',
    targetTable,
    legacyId,
    data: { first_name: 'Asha' },
    sourceTimestamp: '2025-01-02T00:00:00.000Z',
    capturedAt: '2025-01-02T00:00:00.000Z',
    sequence: legacyId,
  };
}

const mapping = {
  sourceTable: 'security_users',
  targetTable: 'students',
} as TableMapping;

describe('CDC sync data integrity (PRC-H103)', () => {
  it('uses the migration_uuid_map constant for mapping lookups and updates the mapped row', async () => {
    expect(MIGRATION_UUID_MAP_TABLE).toBe('migration_uuid_map');
    const { pool, applied } = fakePool({ 'security_users:7': 'uuid-7' });
    const consumer = new CDCConsumer(cdcConfig, migrationConfig);

    const result = await consumer.processBatch(pool, [event('students', 7)]);

    expect(result.errors).toBe(0);
    expect(result.applied).toBe(1);
    expect(applied).toHaveLength(1);
    expect(applied[0]).toContain('"uuid-7"');
  });

  it('isolates a poison event with a SAVEPOINT so later events still commit', async () => {
    const { pool, applied, isCommitted } = fakePool({
      'security_users:1': 'uuid-1',
      'security_users:2': 'uuid-2',
    });
    const consumer = new CDCConsumer(cdcConfig, migrationConfig);

    const result = await consumer.processBatch(pool, [event('poison', 1), event('students', 2)]);

    expect(result.errors).toBe(1);
    expect(result.applied).toBe(1);
    expect(isCommitted()).toBe(true);
    expect(applied).toHaveLength(1);
    expect(applied[0]).toContain('"uuid-2"');
  });

  it('does not persist or advance the sync position when any event failed', async () => {
    const position: SyncPosition = {
      table: 'security_users',
      lastSyncedAt: '2025-01-01T00:00:00.000Z',
      lastSequence: 10,
      lastLegacyId: 5,
      status: 'active',
    };
    const producer = {
      captureChanges: vi.fn(async () => {
        position.lastSyncedAt = '2025-01-02T00:00:00.000Z';
        position.lastSequence = 12;
        position.lastLegacyId = 9;
        return [event('students', 8), event('poison', 9)];
      }),
      commitPosition: vi.fn(async () => undefined),
    };
    const consumer = {
      processBatch: vi.fn(async () => ({
        totalEvents: 2,
        applied: 1,
        skipped: 0,
        errors: 1,
        results: [
          { eventId: 'a', status: 'applied' as const },
          { eventId: 'b', status: 'error' as const, error: 'poison event' },
        ],
      })),
    };
    const pool = {} as Pool;

    const outcome = await syncTableCycle(producer, consumer, pool, pool, mapping, position);

    expect(outcome.error).toMatch(/1 events failed/);
    expect(producer.commitPosition).not.toHaveBeenCalled();
    expect(position.lastSequence).toBe(10);
    expect(position.lastSyncedAt).toBe('2025-01-01T00:00:00.000Z');
    expect(position.lastLegacyId).toBe(5);
  });

  it('persists the advanced position after a fully successful batch', async () => {
    const position: SyncPosition = {
      table: 'security_users',
      lastSyncedAt: '2025-01-01T00:00:00.000Z',
      lastSequence: 10,
      lastLegacyId: 5,
      status: 'active',
    };
    const producer = {
      captureChanges: vi.fn(async () => {
        position.lastSequence = 11;
        return [event('students', 8)];
      }),
      commitPosition: vi.fn(async () => undefined),
    };
    const consumer = {
      processBatch: vi.fn(async () => ({
        totalEvents: 1,
        applied: 1,
        skipped: 0,
        errors: 0,
        results: [{ eventId: 'a', status: 'applied' as const }],
      })),
    };
    const pool = {} as Pool;

    const outcome = await syncTableCycle(producer, consumer, pool, pool, mapping, position);

    expect(outcome.error).toBeUndefined();
    expect(producer.commitPosition).toHaveBeenCalledWith(pool, 'security_users', position);
    expect(position.lastSequence).toBe(11);
  });
});
