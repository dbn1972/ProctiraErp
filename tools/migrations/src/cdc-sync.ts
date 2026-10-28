/**
 * Change Data Capture (CDC) Service for Incremental Sync.
 *
 * Keeps the new PostgreSQL system in step with the legacy source during the parallel
 * operation transition period.
 *
 * Satisfies Requirement 24.4: Support incremental migration allowing parallel
 * operation of legacy and new systems during transition.
 *
 * What is implemented (PRC-M552):
 * - timestamp + legacy-id keyset polling of the source tables;
 * - INSERT vs UPDATE decided from migration_uuid_map (not "always UPDATE");
 * - publish of every captured event to Kafka (kafkajs, idempotent producer, acks=all)
 *   when brokers are configured, before the events are applied;
 * - apply to PostgreSQL with per-event SAVEPOINTs; inserts get a mapped UUID, the
 *   migration tenant_id and remapped legacy foreign keys;
 * - sync position persisted only after a clean batch.
 * Not implemented: the reverse direction (PostgreSQL -> legacy) and a Kafka consumer
 * service; the one-shot runner applies the events it captured directly.
 */

import { randomUUID } from 'node:crypto';

import { Kafka, type Producer } from 'kafkajs';
import type { PoolClient } from 'pg';
import { Pool } from 'pg';

import { TABLE_MAPPINGS } from './table-mappings.js';
import type { MigrationConfig, MigrationStepResult, TableMapping, ColumnMapping } from './types.js';
import { MIGRATION_UUID_MAP_TABLE } from './types.js';

/** CDC event types representing data changes. */
export type CDCOperation = 'INSERT' | 'UPDATE' | 'DELETE';

/** A single CDC event representing a change in the legacy system. */
export interface CDCEvent {
  /** Unique event ID */
  id: string;
  /** Tenant ID for multi-tenant routing */
  tenantId: string;
  /** The operation type */
  operation: CDCOperation;
  /** Source table in legacy MySQL */
  sourceTable: string;
  /** Target table in new PostgreSQL */
  targetTable: string;
  /** Legacy primary key value */
  legacyId: number;
  /** New UUID (if already mapped) */
  newId?: string;
  /** The changed data (after state for INSERT/UPDATE, before state for DELETE) */
  data: Record<string, unknown>;
  /** Previous data state (for UPDATE operations) */
  previousData?: Record<string, unknown>;
  /** Timestamp of the change in the source system */
  sourceTimestamp: string;
  /** Timestamp when the CDC event was captured */
  capturedAt: string;
  /** Sequence number for ordering */
  sequence: number;
}

/** Sync position tracking per table. */
export interface SyncPosition {
  table: string;
  lastSyncedAt: string;
  lastSequence: number;
  lastLegacyId: number;
  status: 'active' | 'paused' | 'error';
  errorMessage?: string;
}

/** CDC sync configuration. */
export interface CDCSyncConfig {
  /** Kafka broker addresses */
  kafkaBrokers: string[];
  /** Kafka client ID */
  kafkaClientId: string;
  /** Consumer group for CDC processing */
  consumerGroupId: string;
  /** Topic prefix for CDC events */
  topicPrefix: string;
  /** Polling interval in milliseconds */
  pollIntervalMs: number;
  /** Maximum batch size per poll */
  batchSize: number;
  /** Tenant ID for the migration */
  tenantId: string;
  /** Conflict resolution strategy */
  conflictResolution: 'source_wins' | 'target_wins' | 'latest_wins';
}

/** Default CDC configuration. */
export const DEFAULT_CDC_CONFIG: Partial<CDCSyncConfig> = {
  topicPrefix: 'cdc.migration',
  pollIntervalMs: 5000,
  batchSize: 1000,
  conflictResolution: 'source_wins',
};

/**
 * CDC Producer: Captures changes from legacy MySQL and publishes to Kafka.
 *
 * Uses timestamp-based change detection (polling `modified` column)
 * since direct binlog access requires MySQL replication privileges.
 */
export class CDCProducer {
  private config: CDCSyncConfig;
  private migrationConfig: MigrationConfig;
  private syncPositions: Map<string, SyncPosition> = new Map();
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** PRC-M552: target pool holding migration_uuid_map (set by initialize()). */
  private mappingPool: Pool | null = null;

  constructor(cdcConfig: CDCSyncConfig, migrationConfig: MigrationConfig) {
    this.config = { ...DEFAULT_CDC_CONFIG, ...cdcConfig } as CDCSyncConfig;
    this.migrationConfig = migrationConfig;
  }

  /**
   * Initializes sync positions from the tracking table.
   */
  async initialize(pgPool: Pool): Promise<void> {
    this.mappingPool = pgPool;
    const client = await pgPool.connect();
    try {
      // Create sync tracking table if not exists
      await client.query(`
        CREATE TABLE IF NOT EXISTS migration_sync_positions (
          table_name TEXT PRIMARY KEY,
          last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_sequence BIGINT NOT NULL DEFAULT 0,
          last_legacy_id BIGINT NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'active',
          error_message TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      // Load existing positions
      const result = await client.query<{
        table_name: string;
        last_synced_at: string;
        last_sequence: number;
        last_legacy_id: number;
        status: SyncPosition['status'];
        error_message?: string;
      }>('SELECT * FROM migration_sync_positions');
      for (const row of result.rows) {
        this.syncPositions.set(row.table_name, {
          table: row.table_name,
          lastSyncedAt: row.last_synced_at,
          // PRC-M417: lastSequence must come from last_sequence, not last_legacy_id
          // (they are distinct — sequence is a monotonic event counter, legacy id
          // is the source PK). Conflating them corrupted event ids on resume.
          lastSequence: Number(row.last_sequence ?? 0),
          lastLegacyId: Number(row.last_legacy_id ?? 0),
          status: row.status,
          errorMessage: row.error_message,
        });
      }

      // Initialize positions for tables not yet tracked
      for (const mapping of TABLE_MAPPINGS) {
        if (!this.syncPositions.has(mapping.sourceTable)) {
          const position: SyncPosition = {
            table: mapping.sourceTable,
            lastSyncedAt: new Date(0).toISOString(),
            lastSequence: 0,
            lastLegacyId: 0,
            status: 'active',
          };
          this.syncPositions.set(mapping.sourceTable, position);

          await client.query(
            `INSERT INTO migration_sync_positions (table_name, last_synced_at, last_sequence, last_legacy_id, status)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (table_name) DO NOTHING`,
            [
              position.table,
              position.lastSyncedAt,
              position.lastSequence,
              position.lastLegacyId,
              position.status,
            ],
          );
        }
      }
    } finally {
      client.release();
    }
  }

  /**
   * Captures changes from a single table since the last sync position.
   * Returns CDC events ready for publishing to Kafka.
   */
  async captureChanges(mysqlPool: Pool, mapping: TableMapping): Promise<CDCEvent[]> {
    const position = this.syncPositions.get(mapping.sourceTable);
    if (!position || position.status !== 'active') return [];

    const events: CDCEvent[] = [];
    const client = await mysqlPool.connect();

    try {
      const filterClause = mapping.sourceFilter ? `AND ${mapping.sourceFilter}` : '';

      // PRC-M417: a strict `modified > $1` keyset with LIMIT silently SKIPS rows
      // that share the cutoff timestamp but fall beyond the batch — on resume the
      // next query advances past them because it only looks at `modified >`. Use
      // a COMPOUND keyset on (modified, legacyPk): take everything strictly after
      // the timestamp, OR equal to it but with a legacy id greater than the last
      // one we processed. Ordering matches the keyset so pagination is stable.
      const result = await client.query<Record<string, unknown>>(
        `SELECT * FROM "${mapping.sourceTable}"
         WHERE (
           "modified" > $1
           OR ("modified" = $1 AND "${mapping.legacyPkColumn}" > $2)
         ) ${filterClause}
         ORDER BY "modified" ASC, "${mapping.legacyPkColumn}" ASC
         LIMIT $3`,
        [position.lastSyncedAt, position.lastLegacyId, this.config.batchSize],
      );

      let sequence = position.lastSequence;

      for (const row of result.rows) {
        sequence++;
        const legacyId = Number(row[mapping.legacyPkColumn]);

        // Determine if this is an INSERT or UPDATE by checking target
        const operation: CDCOperation = await this.determineOperation(mapping, legacyId);

        const event: CDCEvent = {
          id: `cdc_${mapping.sourceTable}_${legacyId}_${sequence}`,
          tenantId: this.config.tenantId,
          operation,
          sourceTable: mapping.sourceTable,
          targetTable: mapping.targetTable,
          legacyId,
          data: this.mapRowData(row, mapping.columns),
          sourceTimestamp: String(row.modified || row.created || new Date().toISOString()),
          capturedAt: new Date().toISOString(),
          sequence,
        };

        events.push(event);
      }

      // Update sync position
      if (events.length > 0) {
        const lastEvent = events[events.length - 1]!;
        position.lastSyncedAt = lastEvent.sourceTimestamp;
        position.lastSequence = lastEvent.sequence;
        position.lastLegacyId = lastEvent.legacyId;
      }
    } finally {
      client.release();
    }

    return events;
  }

  /**
   * Determines whether a change is an INSERT or UPDATE by checking
   * if the record already exists in the target system.
   */
  private async determineOperation(mapping: TableMapping, legacyId: number): Promise<CDCOperation> {
    // PRC-M552: a legacy row that already has a UUID mapping exists in the target.
    if (!this.mappingPool) {
      throw new Error('CDCProducer.initialize() must run before captureChanges()');
    }
    const result = await this.mappingPool.query<{ found: number }>(
      `SELECT 1 AS found FROM ${MIGRATION_UUID_MAP_TABLE}
       WHERE legacy_table = $1 AND legacy_id = $2
       LIMIT 1`,
      [mapping.sourceTable, legacyId],
    );
    return result.rows.length > 0 ? 'UPDATE' : 'INSERT';
  }

  /**
   * Maps a raw database row to the target schema column names.
   */
  private mapRowData(
    row: Record<string, unknown>,
    columns: ColumnMapping[],
  ): Record<string, unknown> {
    const mapped: Record<string, unknown> = {};
    for (const col of columns) {
      if (col.source in row) {
        mapped[col.target] = row[col.source];
      }
    }
    return mapped;
  }

  /**
   * Builds the Kafka topic name for a CDC event.
   */
  buildTopicName(sourceTable: string): string {
    return `${this.config.topicPrefix}.${this.config.tenantId}.${sourceTable}`;
  }

  /**
   * Returns current sync positions for all tracked tables.
   */
  getSyncPositions(): SyncPosition[] {
    return Array.from(this.syncPositions.values());
  }

  /**
   * Updates the sync position in the database after successful publish.
   */
  async commitPosition(pgPool: Pool, table: string, position: SyncPosition): Promise<void> {
    const client = await pgPool.connect();
    try {
      await client.query(
        `UPDATE migration_sync_positions
         SET last_synced_at = $1, last_sequence = $2, last_legacy_id = $3, status = $4, updated_at = NOW()
         WHERE table_name = $5`,
        [
          position.lastSyncedAt,
          position.lastSequence,
          position.lastLegacyId,
          position.status,
          table,
        ],
      );
    } finally {
      client.release();
    }
  }

  /**
   * Pauses sync for a specific table.
   */
  async pauseTable(pgPool: Pool, table: string): Promise<void> {
    const position = this.syncPositions.get(table);
    if (position) {
      position.status = 'paused';
      await this.commitPosition(pgPool, table, position);
    }
  }

  /**
   * Resumes sync for a specific table.
   */
  async resumeTable(pgPool: Pool, table: string): Promise<void> {
    const position = this.syncPositions.get(table);
    if (position) {
      position.status = 'active';
      await this.commitPosition(pgPool, table, position);
    }
  }

  /**
   * Checks if the producer is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Starts the polling loop.
   */
  start(): void {
    this.running = true;
  }

  /**
   * Stops the polling loop.
   */
  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

/**
 * CDC Consumer: Applies CDC events from Kafka to the target PostgreSQL database.
 *
 * Handles:
 * - INSERT: Creates new rows with UUID generation
 * - UPDATE: Updates existing rows with conflict resolution
 * - DELETE: Soft-deletes rows (sets deleted_at)
 */
export class CDCConsumer {
  private config: CDCSyncConfig;
  private migrationConfig: MigrationConfig;
  private processedCount = 0;
  private errorCount = 0;
  private running = false;

  constructor(cdcConfig: CDCSyncConfig, migrationConfig: MigrationConfig) {
    this.config = { ...DEFAULT_CDC_CONFIG, ...cdcConfig } as CDCSyncConfig;
    this.migrationConfig = migrationConfig;
  }

  /**
   * Processes a batch of CDC events and applies them to PostgreSQL.
   */
  async processBatch(pgPool: Pool, events: CDCEvent[]): Promise<CDCBatchResult> {
    const results: CDCEventResult[] = [];
    const client = await pgPool.connect();

    try {
      await client.query('BEGIN');

      for (const event of events) {
        // Per-event SAVEPOINT: a failed statement aborts the whole PG
        // transaction, so without it every later event (and the COMMIT)
        // would silently fail too.
        await client.query('SAVEPOINT cdc_event');
        try {
          const result = await this.processEvent(client, event);
          await client.query('RELEASE SAVEPOINT cdc_event');
          results.push(result);
          if (result.status === 'applied') {
            this.processedCount++;
          }
        } catch (error) {
          await client.query('ROLLBACK TO SAVEPOINT cdc_event');
          this.errorCount++;
          results.push({
            eventId: event.id,
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return {
      totalEvents: events.length,
      applied: results.filter((r) => r.status === 'applied').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      errors: results.filter((r) => r.status === 'error').length,
      results,
    };
  }

  /**
   * Processes a single CDC event.
   */
  private async processEvent(client: PoolClient, event: CDCEvent): Promise<CDCEventResult> {
    const schema = this.migrationConfig.pg.schema;

    switch (event.operation) {
      case 'INSERT':
        return this.applyInsert(client, event, schema);
      case 'UPDATE':
        return this.applyUpsert(client, event, schema);
      case 'DELETE':
        return this.applyDelete(client, event, schema);
      default:
        return {
          eventId: event.id,
          status: 'skipped',
          error: `Unknown operation: ${String(event.operation)}`,
        };
    }
  }

  /**
   * Applies an INSERT event to the target database.
   *
   * PRC-M552: the row gets the UUID from migration_uuid_map (created if absent), the
   * migration tenant as tenant_id when the target has that column, and every mapped
   * legacy foreign key remapped to its UUID. An unmapped foreign key fails the event
   * (its SAVEPOINT rolls back and the sync position is not advanced).
   */
  private async applyInsert(
    client: PoolClient,
    event: CDCEvent,
    schema: string,
  ): Promise<CDCEventResult> {
    const mapped = await client.query<{ new_uuid: string }>(
      `INSERT INTO ${MIGRATION_UUID_MAP_TABLE} (legacy_table, legacy_id, new_uuid)
       VALUES ($1, $2, $3::uuid)
       ON CONFLICT (legacy_table, legacy_id) DO UPDATE SET legacy_table = EXCLUDED.legacy_table
       RETURNING new_uuid`,
      [event.sourceTable, event.legacyId, randomUUID()],
    );
    const newId = mapped.rows[0]?.new_uuid;
    if (!newId) {
      throw new Error(
        `No UUID mapping could be created for ${event.sourceTable}#${event.legacyId}`,
      );
    }
    event.newId = newId;

    const data: Record<string, unknown> = { ...event.data, id: newId };
    const tableMapping = TABLE_MAPPINGS.find(
      (m) => m.sourceTable === event.sourceTable && m.targetTable === event.targetTable,
    );
    for (const fk of tableMapping?.foreignKeys ?? []) {
      const raw = data[fk.column];
      if (raw === null || raw === undefined || raw === '') continue;
      if (!/^[0-9]+$/.test(String(raw))) continue; // already a UUID
      const ref = await client.query<{ new_uuid: string }>(
        `SELECT new_uuid FROM ${MIGRATION_UUID_MAP_TABLE}
         WHERE legacy_table = $1 AND legacy_id = $2`,
        [fk.referencesTable, Number(raw)],
      );
      if (ref.rows.length === 0) {
        throw new Error(
          `Unmapped foreign key ${event.targetTable}.${fk.column}=${String(raw)} (${fk.referencesTable})`,
        );
      }
      data[fk.column] = ref.rows[0]!.new_uuid;
    }

    const tenantColumn = await client.query<{ found: number }>(
      `SELECT 1 AS found FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2 AND column_name = 'tenant_id'`,
      [schema, event.targetTable],
    );
    if (tenantColumn.rows.length > 0) {
      if (!UUID_RE.test(event.tenantId)) {
        throw new Error(`CDC tenantId must be a UUID to insert into ${event.targetTable}`);
      }
      data.tenant_id = event.tenantId;
    }

    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const columnList = columns.map((c) => `"${c}"`).join(', ');

    await client.query(
      `INSERT INTO "${schema}"."${event.targetTable}" (${columnList})
       VALUES (${placeholders})
       ON CONFLICT DO NOTHING`,
      values,
    );

    return { eventId: event.id, status: 'applied' };
  }

  /**
   * Applies an UPDATE/UPSERT event with conflict resolution.
   */
  private async applyUpsert(
    client: PoolClient,
    event: CDCEvent,
    schema: string,
  ): Promise<CDCEventResult> {
    if (!event.newId) {
      // Look up the UUID from the legacy ID mapping
      const lookupResult = await client.query<{ new_uuid: string }>(
        `SELECT new_uuid FROM ${MIGRATION_UUID_MAP_TABLE}
         WHERE legacy_table = $1 AND legacy_id = $2`,
        [event.sourceTable, event.legacyId],
      );

      if (lookupResult.rows.length === 0) {
        // No mapping exists — treat as INSERT
        return this.applyInsert(client, event, schema);
      }

      event.newId = lookupResult.rows[0]!.new_uuid;
    }

    // Apply conflict resolution
    if (this.config.conflictResolution === 'latest_wins') {
      // Check if target has a more recent modification
      const targetResult = await client.query<{ updated_at: string }>(
        `SELECT updated_at FROM "${schema}"."${event.targetTable}" WHERE id = $1`,
        [event.newId],
      );

      if (targetResult.rows.length > 0) {
        const targetUpdatedAt = new Date(targetResult.rows[0]!.updated_at);
        const sourceTimestamp = new Date(event.sourceTimestamp);
        if (targetUpdatedAt > sourceTimestamp) {
          return {
            eventId: event.id,
            status: 'skipped',
            error: 'Target has newer data (latest_wins)',
          };
        }
      }
    }

    // Build SET clause excluding id
    const updateData = { ...event.data };
    delete updateData.id;
    updateData.updated_at = new Date().toISOString();

    const columns = Object.keys(updateData);
    const values = Object.values(updateData);
    const setClause = columns.map((col, i) => `"${col}" = $${i + 1}`).join(', ');

    await client.query(
      `UPDATE "${schema}"."${event.targetTable}"
       SET ${setClause}
       WHERE id = $${values.length + 1}`,
      [...values, event.newId],
    );

    return { eventId: event.id, status: 'applied' };
  }

  /**
   * Applies a DELETE event as a soft-delete.
   */
  private async applyDelete(
    client: PoolClient,
    event: CDCEvent,
    schema: string,
  ): Promise<CDCEventResult> {
    if (!event.newId) {
      const lookupResult = await client.query<{ new_uuid: string }>(
        `SELECT new_uuid FROM ${MIGRATION_UUID_MAP_TABLE}
         WHERE legacy_table = $1 AND legacy_id = $2`,
        [event.sourceTable, event.legacyId],
      );

      if (lookupResult.rows.length === 0) {
        return { eventId: event.id, status: 'skipped', error: 'No UUID mapping found for delete' };
      }

      event.newId = lookupResult.rows[0]!.new_uuid;
    }

    await client.query(
      `UPDATE "${schema}"."${event.targetTable}"
       SET deleted_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [event.newId],
    );

    return { eventId: event.id, status: 'applied' };
  }

  /**
   * Returns processing statistics.
   */
  getStats(): { processedCount: number; errorCount: number } {
    return { processedCount: this.processedCount, errorCount: this.errorCount };
  }

  /**
   * Checks if the consumer is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Starts the consumer.
   */
  start(): void {
    this.running = true;
  }

  /**
   * Stops the consumer.
   */
  stop(): void {
    this.running = false;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PRC-M552: publishes captured CDC events to Kafka. One topic per tenant + source
 * table (`buildCDCTopic`); the message key is `<sourceTable>:<legacyId>` so all
 * changes of one row stay ordered in one partition.
 */
export interface CDCEventPublisher {
  publish(topic: string, events: CDCEvent[]): Promise<void>;
  disconnect(): Promise<void>;
}

export interface KafkaCdcPublisherDeps {
  /** Test seam: anything with kafkajs' `producer()` factory. */
  kafka?: { producer(config: { idempotent: boolean; maxInFlightRequests: number }): Producer };
}

export function createKafkaCdcPublisher(
  config: Pick<CDCSyncConfig, 'kafkaBrokers' | 'kafkaClientId'>,
  deps: KafkaCdcPublisherDeps = {},
): CDCEventPublisher {
  if (!deps.kafka && config.kafkaBrokers.length === 0) {
    throw new Error('Kafka CDC publisher needs at least one broker');
  }
  const kafka =
    deps.kafka ?? new Kafka({ clientId: config.kafkaClientId, brokers: config.kafkaBrokers });
  // Idempotent producer: retries cannot duplicate or reorder messages.
  const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
  let connected: Promise<void> | null = null;
  return {
    async publish(topic, events) {
      if (events.length === 0) return;
      connected ??= producer.connect();
      await connected;
      await producer.send({
        topic,
        acks: -1,
        messages: events.map((e) => ({
          key: `${e.sourceTable}:${e.legacyId}`,
          value: serializeCDCEvent(e),
          headers: { 'cdc-operation': e.operation, 'tenant-id': e.tenantId },
        })),
      });
    },
    async disconnect() {
      if (connected) await producer.disconnect();
    },
  };
}

/** Result of processing a single CDC event. */
export interface CDCEventResult {
  eventId: string;
  status: 'applied' | 'skipped' | 'error';
  error?: string;
}

/** Result of processing a batch of CDC events. */
export interface CDCBatchResult {
  totalEvents: number;
  applied: number;
  skipped: number;
  errors: number;
  results: CDCEventResult[];
}

/** Outcome of one capture+apply cycle for a single table. */
export interface TableSyncOutcome {
  captured: number;
  applied: number;
  /** Set when any event failed or the cycle threw; position is NOT advanced. */
  error?: string;
}

/**
 * Runs one capture+apply cycle for a table. The sync position is persisted
 * only after the batch COMMIT succeeded with zero failed events; otherwise the
 * in-memory position is restored so the failed changes are re-captured.
 */
export async function syncTableCycle(
  producer: Pick<CDCProducer, 'captureChanges' | 'commitPosition'> &
    Partial<Pick<CDCProducer, 'buildTopicName'>>,
  consumer: Pick<CDCConsumer, 'processBatch'>,
  pgPool: Pool,
  stagingPool: Pool,
  mapping: TableMapping,
  position: SyncPosition,
  publisher?: CDCEventPublisher,
): Promise<TableSyncOutcome> {
  const snapshot = { ...position };
  const restore = (): void => {
    position.lastSyncedAt = snapshot.lastSyncedAt;
    position.lastSequence = snapshot.lastSequence;
    position.lastLegacyId = snapshot.lastLegacyId;
  };
  let captured = 0;
  let applied = 0;
  try {
    const events = await producer.captureChanges(stagingPool, mapping);
    captured = events.length;
    if (events.length === 0) return { captured, applied };

    // PRC-M552: publish before apply; a failed publish does not advance the position.
    if (publisher) {
      const topic = producer.buildTopicName
        ? producer.buildTopicName(mapping.sourceTable)
        : buildCDCTopic(DEFAULT_CDC_CONFIG.topicPrefix!, events[0]!.tenantId, mapping.sourceTable);
      await publisher.publish(topic, events);
    }

    const batchResult = await consumer.processBatch(pgPool, events);
    applied = batchResult.applied;
    console.log(
      `[cdc-sync]   ${mapping.sourceTable}: captured=${events.length}, applied=${batchResult.applied}, errors=${batchResult.errors}`,
    );

    if (batchResult.errors > 0) {
      restore();
      const firstError = batchResult.results.find((r) => r.status === 'error')?.error;
      return {
        captured,
        applied,
        error: `${batchResult.errors} events failed to apply; sync position not advanced${
          firstError ? ` (first error: ${firstError})` : ''
        }`,
      };
    }

    await producer.commitPosition(pgPool, mapping.sourceTable, position);
    return { captured, applied };
  } catch (error) {
    restore();
    const message = error instanceof Error ? error.message : String(error);
    return { captured, applied, error: `CDC sync failed: ${message}` };
  }
}

/**
 * Runs the CDC incremental sync as a migration step.
 * This performs a single sync cycle (capture + apply) for all tracked tables.
 */
export async function runIncrementalSync(
  config: MigrationConfig,
  cdcConfig: CDCSyncConfig,
): Promise<MigrationStepResult> {
  const startTime = Date.now();
  const errors: MigrationStepResult['errors'] = [];
  const warnings: MigrationStepResult['warnings'] = [];

  const pgPool = new Pool({
    host: config.pg.host,
    port: config.pg.port,
    database: config.pg.database,
    user: config.pg.user,
    password: config.pg.password,
  });

  // For the staging schema (simulating MySQL source via PG staging)
  const stagingPool = new Pool({
    host: config.pg.host,
    port: config.pg.port,
    database: config.pg.database,
    user: config.pg.user,
    password: config.pg.password,
  });

  const publisher =
    cdcConfig.kafkaBrokers.length > 0 ? createKafkaCdcPublisher(cdcConfig) : undefined;
  if (!publisher) {
    warnings.push({
      table: 'all',
      message: 'No Kafka brokers configured: CDC events are applied without being published',
    });
  }

  try {
    const producer = new CDCProducer(cdcConfig, config);
    const consumer = new CDCConsumer(cdcConfig, config);

    await producer.initialize(pgPool);

    console.log('[cdc-sync] Starting incremental sync cycle...');

    let totalCaptured = 0;
    let totalApplied = 0;
    let tablesProcessed = 0;

    for (const mapping of TABLE_MAPPINGS) {
      const position = producer.getSyncPositions().find((p) => p.table === mapping.sourceTable);
      if (!position || position.status !== 'active') continue;

      const outcome = await syncTableCycle(
        producer,
        consumer,
        pgPool,
        stagingPool,
        mapping,
        position,
        publisher,
      );
      totalCaptured += outcome.captured;
      totalApplied += outcome.applied;
      if (outcome.error) {
        errors.push({ table: mapping.sourceTable, message: outcome.error });
      } else {
        tablesProcessed++;
      }
    }

    console.log(
      `\n[cdc-sync] Sync cycle complete: captured=${totalCaptured}, applied=${totalApplied}`,
    );

    return {
      step: 'incremental_sync',
      // Any failed event or table is an error: the run must exit non-zero.
      status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'success',
      tablesProcessed,
      rowsProcessed: totalApplied,
      errors,
      warnings,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push({ table: 'all', message: `Incremental sync failed: ${message}` });

    return {
      step: 'incremental_sync',
      status: 'error',
      tablesProcessed: 0,
      rowsProcessed: 0,
      errors,
      warnings,
      durationMs: Date.now() - startTime,
    };
  } finally {
    await publisher?.disconnect().catch(() => undefined);
    await pgPool.end();
    await stagingPool.end();
  }
}

/**
 * Builds the Kafka topic name for CDC events.
 */
export function buildCDCTopic(prefix: string, tenantId: string, table: string): string {
  return `${prefix}.${tenantId}.${table}`;
}

/**
 * Serializes a CDC event for Kafka message value.
 */
export function serializeCDCEvent(event: CDCEvent): string {
  return JSON.stringify(event);
}

/**
 * Deserializes a CDC event from a Kafka message value.
 */
export function deserializeCDCEvent(value: string): CDCEvent {
  return JSON.parse(value) as CDCEvent;
}
