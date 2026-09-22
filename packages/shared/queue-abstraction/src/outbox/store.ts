/**
 * Outbox store contract — durable pending queue messages (W2-JOB-04).
 */
import type { NewOutboxEntry, OutboxQueryable, OutboxRecord } from './types.js';

/** Filter for {@link OutboxStore.listFailed}. */
export interface ListFailedOptions {
  /**
   * Restrict to one tenant. Omitting it lists across tenants, which is a
   * platform-operator action — callers exposing this must gate accordingly.
   */
  tenantId?: string;
  limit?: number;
  /** Only rows created at or after this instant. */
  since?: Date;
}

/** Input for {@link OutboxStore.requeueFailed}. */
export interface RequeueFailedOptions {
  /** Rows to redrive. Only rows currently in `failed` are affected. */
  ids: string[];
  /** Who requested the redrive. Recorded in `redrive_history`. */
  actor: string;
  /** Why. Recorded in `redrive_history`. */
  reason: string;
  /**
   * Restrict the redrive to one tenant. A cross-tenant id list is silently
   * narrowed rather than partially applied, so an operator scoped to one tenant
   * cannot redrive another's rows by passing their ids.
   */
  tenantId?: string;
  /** When the requeued rows become claimable. Default: now. */
  availableAt?: Date;
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
