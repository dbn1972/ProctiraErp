/**
 * PRC-M200 / DR4-4 — audit ingest drain.
 *
 * System-originated audit events (the demo seed under L461, background jobs and
 * async side-effects) cannot always run inside the originating tenant
 * transaction. They are written to `audit_ingest_queue` (migration 293) and
 * *sealed* into the keyed HMAC chain by this drain, which runs at gateway boot
 * and on an unref'd interval (default 60s), single-flight per replica.
 *
 * The drain never touches the queue or the chain head directly: it calls the
 * SECURITY DEFINER functions `audit_ingest_pending_tenants()` (platform scope),
 * `audit_chain_lock_head()` and `audit_ingest_seal()` (tenant-bound). The HMAC
 * over the canonical payload is computed here, in-process, under the KMS/dev
 * key, so the database never sees the signing secret. Ordering within a tenant
 * is by queue id; the per-tenant head lock serialises the drain against every
 * synchronous writer, and `audit_ingest_seal`'s double-seal guard is the
 * backstop against two drains sealing the same row twice.
 *
 * The DB mechanics live behind {@link QueueSealer} so the scheduler itself is
 * unit-testable without a live Postgres; the gateway supplies a pg-pool-backed
 * sealer in apps/api-gateway/src/audit-ingest-drain.ts.
 */
import { computeKeyedEntryHash, type AuditChainKey } from './audit-hash.js';
import type { AuditOperation } from './audit-repository.js';

/** One unsealed queue row as the drain needs it (migration 293 columns). */
export interface PendingAuditQueueRow {
  /** Surrogate identity; the drain seals rows oldest-first by this. */
  queueId: number;
  tenantId: string;
  entityType: string;
  entityId: string;
  operation: AuditOperation;
  /** Nullable for system-origin rows; the DB falls back to actor_kind. */
  userId: string | null;
  actorKind: string;
  userName: string;
  ipAddress: string;
  occurredAt: Date;
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

/** Head state returned by `audit_chain_lock_head` (held FOR UPDATE). */
export interface AuditChainHeadState {
  headSeq: number;
  headHash: string | null;
}

/** The sealed-entry id + its keyed hash, as passed to `audit_ingest_seal`. */
export interface SealArgs {
  tenantId: string;
  queueId: number;
  entryId: string;
  entryHash: string;
  keyId: string;
}

/**
 * The database surface the drain depends on. Implemented by the gateway over a
 * real pg pool (withPlatformScope / withPgTenant + the definer functions) and
 * by an in-memory fake in tests.
 */
export interface QueueSealer {
  /** Platform-scope read of tenants that have unsealed rows. */
  listPendingTenants(): Promise<string[]>;
  /**
   * Run `fn` inside ONE tenant-bound transaction for `tenantId`. The callback
   * receives the per-row primitives it needs; all of them run on the same bound
   * client so the head lock and the seals share one commit boundary.
   */
  withTenant<T>(tenantId: string, fn: (ops: TenantSealOps) => Promise<T>): Promise<T>;
  /** A fresh entry id (UUID) for each sealed row. */
  newEntryId(): string;
}

/** The tenant-bound operations available inside {@link QueueSealer.withTenant}. */
export interface TenantSealOps {
  /** `audit_chain_lock_head($tenant)` — creates + locks the head FOR UPDATE. */
  lockHead(): Promise<AuditChainHeadState>;
  /** Unsealed rows for the bound tenant, ordered oldest-first by queue id. */
  loadPending(): Promise<PendingAuditQueueRow[]>;
  /** `audit_ingest_seal(...)` — appends the keyed row + marks the queue row. */
  seal(args: SealArgs): Promise<void>;
}

export interface AuditIngestDrainLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
  warn?(obj: Record<string, unknown>, msg: string): void;
}

export interface AuditIngestDrainOptions {
  sealer: QueueSealer;
  /** Resolver for the current signing key (the configured KMS key or dev). */
  key: () => AuditChainKey;
  /** Drain interval; default 60s. Minimum 1s (tests). */
  intervalMs?: number;
  /** Delay before the first scheduled run; default = intervalMs. */
  initialDelayMs?: number;
  logger?: AuditIngestDrainLogger;
}

export interface AuditIngestDrainResult {
  tenants: number;
  sealed: number;
  failures: Array<{ tenantId: string; error: string }>;
}

export interface AuditIngestDrain {
  start(): void;
  stop(): void;
  /** Seal all currently-pending rows once; safe to call directly (tests/boot). */
  runOnce(): Promise<AuditIngestDrainResult>;
  readonly running: boolean;
  readonly lastRun: { at: string; tenants: number; sealed: number; failures: number } | null;
}

export const DEFAULT_AUDIT_INGEST_DRAIN_INTERVAL_MS = 60 * 1000;

/**
 * Seal every pending row of one tenant inside a single tenant transaction.
 * Returns the number of rows sealed. The head is locked FIRST (serialises the
 * drain against synchronous writers and any concurrent drain), then rows are
 * sealed in queue-id order, each hash chaining off the previous entry hash.
 */
async function drainTenant(
  sealer: QueueSealer,
  tenantId: string,
  key: AuditChainKey,
): Promise<number> {
  return sealer.withTenant(tenantId, async (ops) => {
    const head = await ops.lockHead();
    const rows = await ops.loadPending();
    let prevHash = head.headHash;
    let sealed = 0;
    for (const row of rows) {
      const entryId = sealer.newEntryId();
      // HMAC the canonical payload under the in-process key; the DB never sees
      // the secret. Mirrors appendAuditEntryOnClient's hashed fields exactly so
      // a drained row verifies identically to a synchronous one.
      const entryHash = computeKeyedEntryHash(
        {
          id: entryId,
          tenantId,
          entityType: row.entityType,
          entityId: row.entityId,
          operation: row.operation,
          // System rows may have a NULL user_id; the sealed entry records
          // actor_kind in its place (same fallback as audit_ingest_seal).
          userId: row.userId ?? row.actorKind,
          userName: row.userName,
          ipAddress: row.ipAddress,
          timestamp: row.occurredAt,
          beforeValues: row.beforeValues,
          afterValues: row.afterValues,
          metadata: row.metadata,
        },
        prevHash,
        key,
      );
      await ops.seal({ tenantId, queueId: row.queueId, entryId, entryHash, keyId: key.keyId });
      prevHash = entryHash;
      sealed += 1;
    }
    return sealed;
  });
}

/**
 * Create the audit ingest drain. The gateway starts it once per process after
 * the audit chain key is configured, and stops it on close; tests drive
 * {@link AuditIngestDrain.runOnce} directly.
 */
export function createAuditIngestDrain(options: AuditIngestDrainOptions): AuditIngestDrain {
  const intervalMs = Math.max(1000, options.intervalMs ?? DEFAULT_AUDIT_INGEST_DRAIN_INTERVAL_MS);
  const initialDelayMs = Math.max(0, options.initialDelayMs ?? intervalMs);
  const logger = options.logger;
  let timer: NodeJS.Timeout | null = null;
  let inFlight = false;
  let lastRun: AuditIngestDrain['lastRun'] = null;

  const runOnce = async (): Promise<AuditIngestDrainResult> => {
    // Single-flight per replica: a second call while a drain is running is a
    // no-op (the interval and the boot call cannot overlap themselves).
    if (inFlight) {
      return { tenants: 0, sealed: 0, failures: [] };
    }
    inFlight = true;
    const failures: AuditIngestDrainResult['failures'] = [];
    let tenants = 0;
    let sealed = 0;
    try {
      const key = options.key();
      const pending = await sealer_listPendingTenants(options.sealer, logger);
      for (const tenantId of pending) {
        tenants += 1;
        try {
          sealed += await drainTenant(options.sealer, tenantId, key);
        } catch (error) {
          // One tenant's failure (e.g. a transient conflict) must not block the
          // others; it is retried on the next tick.
          failures.push({
            tenantId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      lastRun = {
        at: new Date().toISOString(),
        tenants,
        sealed,
        failures: failures.length,
      };
      if (failures.length > 0) {
        logger?.error({ ...lastRun, failures }, 'audit ingest drain had failures');
      } else if (sealed > 0) {
        logger?.info(lastRun, 'audit ingest drain sealed queued rows');
      }
      return { tenants, sealed, failures };
    } finally {
      inFlight = false;
    }
  };

  const schedule = (delay: number) => {
    timer = setTimeout(() => {
      void runOnce()
        .catch((error) => {
          logger?.error(
            { error: error instanceof Error ? error.message : String(error) },
            'audit ingest drain failed',
          );
        })
        .finally(() => {
          if (timer) schedule(intervalMs);
        });
    }, delay);
    // Never keep the event loop alive for the drain.
    timer.unref?.();
  };

  return {
    start() {
      if (timer) return;
      schedule(initialDelayMs);
      logger?.info({ intervalMs, initialDelayMs }, 'audit ingest drain started');
    },
    stop() {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
    },
    runOnce,
    get running() {
      return timer !== null;
    },
    get lastRun() {
      return lastRun;
    },
  };
}

/** Isolated listPendingTenants call so a read failure degrades to "no work". */
async function sealer_listPendingTenants(
  sealer: QueueSealer,
  logger?: AuditIngestDrainLogger,
): Promise<string[]> {
  try {
    return await sealer.listPendingTenants();
  } catch (error) {
    logger?.error(
      { error: error instanceof Error ? error.message : String(error) },
      'audit ingest drain could not list pending tenants',
    );
    return [];
  }
}
