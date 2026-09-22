/**
 * Outbox store contract — durable pending queue messages (W2-JOB-04).
 */
import type { NewOutboxEntry, OutboxQueryable, OutboxRecord } from './types.js';

/** Filter for {@link OutboxStore.listFailed}. */
export interface ListFailedOptions {
  /**
   * Restrict to one tenant. Omitting it lists across tenants, which is a
   * platform-operator action — callers exposing this must gate accordingly. Note
   * that `transactional_outbox` rows carry domain payloads, so an unscoped list is
   * a cross-tenant payload read.
   */
  tenantId?: string;
  limit?: number;
  /**
   * Only rows **created** at or after this instant.
   *
   * Deliberately not "failed since": the table has no failure timestamp, so that
   * question cannot be answered today. Named `createdSince` to stop it being read
   * as a failure-time filter.
   */
  createdSince?: Date;
}

/**
 * Input for {@link OutboxStore.requeueFailed}.
 *
 * `tenantId` is **required**, and `PLATFORM_WIDE_REDRIVE` is the explicit opt-out.
 * An optional field would have made the cross-tenant call the shorter one: the store
 * runs redrive under `app.platform_admin='1'`, which fully bypasses the
 * `tenant_isolation` policy on `transactional_outbox`, so a caller threading an
 * `undefined` from a request context would silently get platform-wide write access.
 */
export interface RequeueFailedOptions {
  /** Rows to redrive. Only rows currently in `failed` are affected. */
  ids: string[];
  /** Who requested the redrive. Recorded in `redrive_history`. */
  actor: string;
  /** Why. Recorded in `redrive_history`. */
  reason: string;
  /**
   * Tenant whose rows may be redriven, or {@link PLATFORM_WIDE_REDRIVE} to act
   * across every tenant. A cross-tenant id list is narrowed rather than partially
   * applied, so an operator scoped to one tenant cannot redrive another's rows by
   * passing their ids.
   */
  tenantId: string | typeof PLATFORM_WIDE_REDRIVE;
  /** When the requeued rows become claimable. Default: now. */
  availableAt?: Date;
}

/**
 * Explicit opt-in to a cross-tenant redrive. Spelled out so it is visible in a
 * call site and in review, rather than being the consequence of an omitted field.
 */
export const PLATFORM_WIDE_REDRIVE = Symbol.for('proctira.outbox.platformWideRedrive');

/** Thrown when an id in a redrive batch is not a UUID. */
export class InvalidOutboxIdError extends Error {
  constructor(readonly invalidIds: string[]) {
    super(
      `requeueFailed: not valid UUIDs: ${invalidIds.join(', ')}. ` +
        'No rows were redriven. Postgres would abort the whole batch on the first ' +
        'malformed id, so the batch is rejected up front with the ids named.',
    );
    this.name = 'InvalidOutboxIdError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reject a batch containing a non-UUID id.
 *
 * Shared by both stores so they cannot diverge. Without this, `PgOutboxStore` raises
 * a bare `22P02 invalid input syntax for type uuid` from `id = ANY($1::uuid[])`,
 * rolls back, and redrives *nothing* — naming neither the parameter nor which id was
 * bad — while `InMemoryOutboxStore` skipped unknown ids and reported partial success.
 * Two different contracts for the same interface, with the tests exercising the
 * lenient one.
 */
export function assertValidOutboxIds(ids: readonly string[]): void {
  const invalid = ids.filter((id) => !UUID_RE.test(id));
  if (invalid.length > 0) throw new InvalidOutboxIdError(invalid);
}

export interface OutboxStore {
  /**
   * Insert a pending outbox row.
   * When `client` is provided, the insert uses that connection so it can
   * share a transaction with domain writes.
   */
  enqueue(entry: NewOutboxEntry, client?: OutboxQueryable): Promise<OutboxRecord>;

  /** Claim pending rows that are due (status=pending, available_at <= now). */
  claimPending(limit: number, now?: Date): Promise<OutboxRecord[]>;

  markPublished(id: string, publishedAt?: Date): Promise<void>;

  /**
   * Record a publish failure. Optionally schedule a retry via `availableAt`.
   * When `availableAt` is omitted, status becomes `failed` (no automatic retry).
   */
  markFailed(id: string, error: string, availableAt?: Date): Promise<void>;

  /**
   * List rows in terminal `failed` state so an operator can inspect before
   * redriving. Required because `claimPending` never returns these rows, which
   * previously made them invisible as well as unrecoverable.
   */
  listFailed(options?: ListFailedOptions): Promise<OutboxRecord[]>;

  /**
   * Move `failed` rows back to `pending` so the relay picks them up again
   * (V10 defect 1; Volume 5 §6 redrive).
   *
   * Resets `attempts` to 0. This is load-bearing, not hygiene: `OutboxRelay.tick`
   * sends a row to terminal `failed` when `row.attempts >= maxAttempts`, so a
   * requeue that preserved the exhausted counter would re-fail on the first error
   * and the redrive would be a no-op.
   *
   * Appends an {@link OutboxRedriveEntry} rather than overwriting, so a row
   * redriven repeatedly keeps every attempt.
   *
   * @returns the ids actually transitioned. Rows that were absent, not `failed`,
   * or outside `tenantId` are omitted, so the caller can tell a partial redrive
   * from a complete one instead of assuming success.
   */
  requeueFailed(options: RequeueFailedOptions): Promise<string[]>;

  /** Test helper: pending rows still waiting for relay. */
  listPending?(): Promise<OutboxRecord[]>;
}
