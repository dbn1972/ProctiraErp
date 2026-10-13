/**
 * PRC-M417 — captureChanges must use a COMPOUND keyset on (modified, legacyPk)
 * so same-timestamp rows beyond the batch are not skipped on resume, and must
 * load lastSequence from last_sequence (not last_legacy_id).
 */
import { describe, it, expect, vi } from 'vitest';

import { CDCProducer, DEFAULT_CDC_CONFIG, type CDCSyncConfig } from './cdc-sync.js';
import { getMappingForTarget, TABLE_MAPPINGS } from './table-mappings.js';
import type { MigrationConfig } from './types.js';

function fakePgPool(positionRow: Record<string, unknown>) {
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT * FROM migration_sync_positions')) {
        return { rows: [positionRow] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { connect: vi.fn(async () => client) } as never;
}

describe('captureChanges compound keyset (PRC-M417)', () => {
  const cdcConfig: CDCSyncConfig = {
    ...DEFAULT_CDC_CONFIG,
    kafkaBrokers: ['localhost:9092'],
    kafkaClientId: 'c',
    consumerGroupId: 'g',
    topicPrefix: 'cdc',
    tenantId: '11111111-1111-4111-8111-111111111111',
  } as CDCSyncConfig;
  const migrationConfig = { pg: { schema: 'public' } } as MigrationConfig;

  it('queries with (modified > $1 OR (modified = $1 AND pk > $2)) and loads lastSequence separately', async () => {
    const mapping = TABLE_MAPPINGS[0]!;
    const producer = new CDCProducer(cdcConfig, migrationConfig);
    await producer.initialize(
      fakePgPool({
        table_name: mapping.sourceTable,
        last_synced_at: '2026-01-01T00:00:00.000Z',
        last_sequence: 42,
        last_legacy_id: 7,
        status: 'active',
      }),
    );

    const captured: Array<{ sql: string; params: unknown[] }> = [];
    const mysqlClient = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        captured.push({ sql, params });
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const mysqlPool = { connect: vi.fn(async () => mysqlClient) } as never;

    await producer.captureChanges(mysqlPool, mapping);

    const { sql, params } = captured[0]!;
    expect(sql).toContain('"modified" > $1');
    expect(sql).toContain(`"modified" = $1 AND "${mapping.legacyPkColumn}" > $2`);
    // $2 is the last legacy id (7), $3 the batch size.
    expect(params[0]).toBe('2026-01-01T00:00:00.000Z');
    expect(params[1]).toBe(7);
    // lastSequence (42) is loaded from last_sequence, not last_legacy_id (7).
    const pos = producer.getSyncPositions().find((p) => p.table === mapping.sourceTable);
    expect(pos?.lastSequence).toBe(42);
  });

  it('mapping fixture exists', () => {
    expect(getMappingForTarget(TABLE_MAPPINGS[0]!.targetTable)).toBeDefined();
  });
});
