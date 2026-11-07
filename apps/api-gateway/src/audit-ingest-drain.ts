/**
 * PRC-M200 / DR4-4 — gateway pg-pool QueueSealer for the audit ingest drain.
 *
 * The drain *engine* (single-flight scheduling, per-tenant ordering, in-process
 * keyed HMAC) lives in @proctira/audit and is unit-tested without a live
 * Postgres. This module supplies the production {@link QueueSealer}: it binds
 * the platform/tenant GUCs and calls the SECURITY DEFINER functions from
 * migrations 292/293 so the runtime role never writes `audit_chain_heads`,
 * `audit_log_entries` or `audit_ingest_queue.sealed_at` directly.
 *
 *   listPendingTenants -> withPlatformScope + audit_ingest_pending_tenants()
 *   withTenant         -> withPgTenant (binds app.tenant_id for FORCE RLS)
 *     lockHead         -> audit_chain_lock_head($tenant)   (head FOR UPDATE)
 *     loadPending      -> SELECT unsealed rows ORDER BY id (RLS-scoped)
 *     seal             -> audit_ingest_seal(...)           (append + mark)
 *
 * The HMAC is computed by the engine under the configured KMS/dev key; the DB
 * only stores entry_hash + key_id. The whole per-tenant drain runs inside one
 * `withPgTenant` transaction so the head lock and every seal share one commit.
 */
import { randomUUID } from 'node:crypto';

import {
  createAuditIngestDrain,
  currentAuditChainKey,
  type AuditChainHeadState,
  type AuditIngestDrain,
  type AuditIngestDrainLogger,
  type PendingAuditQueueRow,
  type QueueSealer,
  type SealArgs,
  type TenantSealOps,
} from '@proctira/backend-audit';
import {
  getSharedPgPool,
  withPgTenant,
  withPlatformScope,
  type PgPoolWithConnect,
  type PgQueryable,
} from '@proctira/database';

/** Coerce a possibly-string bigint/count column into a JS number. */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return Number(value ?? 0);
}

/** Coerce a JSONB column into a plain object or null (pg returns objects). */
function toJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  return null;
}

/**
 * Map one `audit_ingest_queue` row (snake_case columns) onto the engine's
 * {@link PendingAuditQueueRow}. `occurred_at` comes back as a Date from pg.
 */
function mapPendingRow(row: Record<string, unknown>): PendingAuditQueueRow {
  const occurred = row['occurred_at'];
  return {
    queueId: toNumber(row['id']),
    tenantId: String(row['tenant_id']),
    entityType: String(row['entity_type']),
    entityId: String(row['entity_id']),
    operation: String(row['operation']) as PendingAuditQueueRow['operation'],
    userId: row['user_id'] == null ? null : String(row['user_id']),
    actorKind: String(row['actor_kind'] ?? 'system:unknown'),
    userName: String(row['user_name'] ?? 'system'),
    ipAddress: String(row['ip_address'] ?? '0.0.0.0'),
    occurredAt: occurred instanceof Date ? occurred : new Date(String(occurred)),
    beforeValues: toJsonObject(row['before_values']),
    afterValues: toJsonObject(row['after_values']),
    metadata: toJsonObject(row['metadata']),
  };
}

/**
 * Build the pg-pool QueueSealer. Every call binds the appropriate GUC on a
 * dedicated client; nothing touches the chain tables outside the definer
 * functions.
 */
export function createPgQueueSealer(pool: PgPoolWithConnect): QueueSealer {
  return {
    async listPendingTenants(): Promise<string[]> {
      // Platform context is required by audit_ingest_pending_tenants(); it is a
      // read-only aggregate over every tenant's unsealed rows.
      return withPlatformScope(pool, async (client: PgQueryable) => {
        const { rows } = (await client.query(
          'SELECT tenant_id FROM audit_ingest_pending_tenants()',
        )) as { rows: Array<{ tenant_id: unknown }> };
        return rows.map((r) => String(r.tenant_id));
      });
    },

    async withTenant<T>(tenantId: string, fn: (ops: TenantSealOps) => Promise<T>): Promise<T> {
      // One tenant-bound transaction for the whole drain of this tenant: the
      // head lock and every seal share the same client + commit boundary.
      return withPgTenant(pool, tenantId, async (client: PgQueryable) => {
        const ops: TenantSealOps = {
          async lockHead(): Promise<AuditChainHeadState> {
            const { rows } = (await client.query(
              'SELECT head_seq, head_hash FROM audit_chain_lock_head($1)',
              [tenantId],
            )) as { rows: Array<{ head_seq: unknown; head_hash: unknown }> };
            const head = rows[0];
            return {
              headSeq: head ? toNumber(head.head_seq) : 0,
              headHash: head && head.head_hash != null ? String(head.head_hash) : null,
            };
          },
          async loadPending(): Promise<PendingAuditQueueRow[]> {
            // RLS pins this to the bound tenant; oldest-first by surrogate id so
            // the chain order is deterministic. The explicit tenant predicate
            // lets the (tenant_id, id) pending index drive the scan: the
            // policy's tenant_id::text comparison cannot be an index condition.
            const { rows } = (await client.query(
              `SELECT id, tenant_id, entity_type, entity_id, operation, user_id,
                      actor_kind, user_name, ip_address, occurred_at,
                      before_values, after_values, metadata
                 FROM audit_ingest_queue
                WHERE sealed_at IS NULL
                  AND tenant_id = $1
                ORDER BY id ASC`,
              [tenantId],
            )) as { rows: Array<Record<string, unknown>> };
            return rows.map(mapPendingRow);
          },
          async seal(args: SealArgs): Promise<void> {
            await client.query('SELECT chain_seq FROM audit_ingest_seal($1, $2, $3, $4, $5)', [
              args.tenantId,
              args.queueId,
              args.entryId,
              args.entryHash,
              args.keyId,
            ]);
          },
        };
        return fn(ops);
      });
    },

    newEntryId(): string {
      return randomUUID();
    },
  };
}

/**
 * Create the gateway drain over the shared pg pool, or `null` when no database
 * is configured (DATABASE_URL unset — in-memory audit). The caller starts it
 * after {@link configureAuditChainKey} and stops it on close.
 */
export function createGatewayAuditIngestDrain(options: {
  logger: AuditIngestDrainLogger;
  intervalMs?: number;
}): AuditIngestDrain | null {
  const pool = getSharedPgPool();
  if (!pool) return null;
  return createAuditIngestDrain({
    sealer: createPgQueueSealer(pool as PgPoolWithConnect),
    // Resolve the signing key lazily so boot ordering (configureAuditChainKey
    // before start) and any future rotation are honoured on every tick.
    key: () => currentAuditChainKey(),
    intervalMs: options.intervalMs,
    logger: options.logger,
  });
}
