/**
 * apps/web/src/lib/sync/replay.ts — Sync_Queue replay loop
 * (Task 54.2, Requirements 38.5, 38.6, 38.7, Design §I)
 * =====================================================================
 *
 * Drains the persistent Sync_Queue (`./syncQueue.ts`) when connectivity
 * is restored. The loop is split out from the storage layer so each
 * piece is independently testable and so a future swap of the
 * persistence backend (e.g. WebLocks, OPFS) does not touch this file.
 *
 * Behavioural contract (Requirement 38.6, 38.7 / Design §I):
 *
 *   • Operations are drained in `createdAt` order. Ties break on `id`
 *     so the order is total and deterministic.
 *
 *   • Each replayed request carries `Idempotency-Key: <op.idempotencyKey>`
 *     so the API_Gateway (task 54.6) deduplicates retries.
 *
 *   • 2xx → `dequeue` and record `succeeded`.
 *
 *   • 4xx (except 408 / 429) → leave in queue, mark `lastError`, and
 *     stop attempting (the user must amend or discard via the
 *     conflict dialog). Outcome: `failed_permanent`.
 *
 *   • 408 / 429 / 5xx / network error → bump `attemptCount`, set
 *     `lastError` and `lastAttemptAt`, wait `backoffFor(attemptCount)`,
 *     and retry the SAME operation. After `MAX_ATTEMPTS` failures,
 *     leave the operation in place with the error and proceed to the
 *     next op. Outcome: `failed_transient`.
 *
 *   • If `signal.aborted` fires (e.g. user goes offline mid-drain),
 *     `replayAll` returns the results gathered so far.
 *
 *   • Any operation already at `attemptCount >= MAX_ATTEMPTS` on entry
 *     is skipped — the user must intervene via the UI.
 *
 * Pluggable seams (`ReplayOptions`):
 *
 *   • `wait` — defaults to `setTimeout` so the loop sleeps between
 *     retries. Tests pass a synchronous fake to keep them
 *     deterministic without needing fake timers.
 *
 *   • `now` — a `Date.now` proxy so `lastAttemptAt` is reproducible.
 *
 *   • `buildHeaders` — merges extra headers (auth tokens, tenant
 *     context) onto every replay; the `Idempotency-Key` is appended
 *     after this hook so callers cannot accidentally override it.
 *
 *   • `signal` — an `AbortSignal` so the `offline` event can cut a
 *     drain short. The next checkpoint is between operations.
 */

import { dequeue, peekAll, persistAttempt, type SyncQueueOperation } from './syncQueue';

// ─── Backoff schedule ────────────────────────────────────────────────────────

/**
 * Backoff schedule from Requirement 38.6 / Design §I.
 *
 * Indices `0..9` map to attempts `1..10`. Values are in milliseconds.
 * The schedule doubles up to 32 s, then caps at 5 min (300 s) to keep
 * retries from drifting indefinitely while remaining gentle on the
 * gateway when many clients reconnect at once.
 */
export const BACKOFF_SCHEDULE_MS: readonly number[] = [
  1_000, // attempt 1
  2_000, // attempt 2
  4_000, // attempt 3
  8_000, // attempt 4
  16_000, // attempt 5
  32_000, // attempt 6
  64_000, // attempt 7
  128_000, // attempt 8
  256_000, // attempt 9
  300_000, // attempt 10 — final cap at 5 minutes
] as const;

/**
 * Maximum number of replay attempts before an operation is parked in
 * the queue with `lastError` populated for the conflict resolution UI.
 * Must equal `BACKOFF_SCHEDULE_MS.length`.
 */
export const MAX_ATTEMPTS = BACKOFF_SCHEDULE_MS.length;

// ─── Public types ────────────────────────────────────────────────────────────

/** Outcome of a single replay attempt. Surfaced to callers so the
 * Connectivity_Indicator and the toast hook can summarise progress.
 */
export type ReplayOutcome = 'succeeded' | 'failed_permanent' | 'failed_transient';

export interface ReplayResult {
  id: string;
  outcome: ReplayOutcome;
  /** HTTP status code for terminal outcomes; null for network errors. */
  status: number | null;
  /** Error message for non-`succeeded` outcomes; undefined on success. */
  error?: string;
  /** Final attemptCount after this call (post-mutation). */
  attemptCount: number;
  /**
   * Full response body for terminal failures (status set, non-2xx).
   * Surfaced so the `<ConflictResolutionDialog>` (task 54.5) can parse
   * the structured 409 conflict payload without re-fetching. Capped at
   * 16 KiB to keep the in-memory result list bounded; this is more
   * than enough for the conflict envelope (Design §I) but small
   * enough that an accidentally enormous error page does not bloat
   * memory. `undefined` for successes and pure network errors.
   */
  responseBody?: string;
}

/**
 * Maximum number of characters captured into `ReplayResult.responseBody`.
 * Larger than the `lastError` excerpt (200 chars) so the conflict
 * dialog can parse the full structured payload, but bounded so a
 * pathological response does not balloon the result list.
 */
export const REPLAY_BODY_CAPTURE_LIMIT = 16_384;

/** Optional dependencies — every parameter has a sensible default but
 * tests inject deterministic substitutes. */
export interface ReplayOptions {
  /** Wait helper (`setTimeout` by default). Tests pass `() => Promise.resolve()`. */
  wait?: (ms: number) => Promise<void>;
  /** `Date.now()` proxy. Tests pass a fixed clock. */
  now?: () => number;
  /** Override the headers attached to each replay. Use to add auth. */
  buildHeaders?: (op: SyncQueueOperation) => Record<string, string>;
  /** AbortSignal to cut a long-running drain short (e.g. `offline`). */
  signal?: AbortSignal;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Delay for `ms` milliseconds using `setTimeout`. The default `wait`
 * helper for `replayAll`. Tests pass a synchronous substitute. */
function setTimeoutWait(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Look up the wait time (in ms) for a given attempt count. The
 * `attemptCount` parameter is the value AFTER the failure that
 * triggered this delay (i.e. attempts already made).
 */
export function backoffFor(attemptCount: number): number {
  const idx = Math.max(0, Math.min(BACKOFF_SCHEDULE_MS.length - 1, attemptCount - 1));
  return BACKOFF_SCHEDULE_MS[idx]!;
}

/**
 * Format a fetch error into a short, persistent message. We avoid
 * stack traces because the queue may serve as the audit log shown to
 * the user in the conflict dialog (task 54.5).
 */
function formatError(status: number | null, message: string, bodyExcerpt?: string): string {
  const head = status === null ? 'network' : `status ${status}`;
  if (bodyExcerpt && bodyExcerpt.length > 0) {
    return `${head}: ${message} — ${bodyExcerpt.slice(0, 200)}`;
  }
  return `${head}: ${message}`;
}

/** Default headers attached to every replay. Idempotency-Key is
 * appended downstream so callers cannot accidentally override it. */
function defaultReplayHeaders(op: SyncQueueOperation): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Tenant-ID': op.tenantId,
    'X-Sync-Replay': '1',
  };
  if (op.userId) headers['X-User-ID'] = op.userId;
  return headers;
}

/**
 * Status codes that are considered transient (worth retrying with
 * backoff). 408 (Request Timeout) and 429 (Too Many Requests) are
 * grouped with 5xx because the gateway recommends backing off rather
 * than asking the user to re-submit.
 */
function isTransientStatus(status: number): boolean {
  if (status === 408 || status === 429) return true;
  return status >= 500 && status < 600;
}

/**
 * Read the full response body (capped at `REPLAY_BODY_CAPTURE_LIMIT`)
 * so the `<ConflictResolutionDialog>` (task 54.5) can parse the
 * structured 409 payload from `Design §I`. Defensive — never throws.
 * The first 200 characters of this body double as the
 * `lastError`-attached excerpt persisted to the queue.
 */
async function readBodyFull(response: Response): Promise<string> {
  try {
    const text = await response.clone().text();
    return text.slice(0, REPLAY_BODY_CAPTURE_LIMIT);
  } catch {
    return '';
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Replay every pending operation in submission order. See module
 * docstring for the full behavioural contract.
 *
 * `fetcher` is required so callers (the ConnectivityProvider in
 * particular) can inject an instrumented fetch (auth refresh,
 * telemetry, etc.) without monkey-patching the global.
 */
export async function replayAll(
  fetcher: typeof fetch,
  options: ReplayOptions = {},
): Promise<ReplayResult[]> {
  const wait = options.wait ?? setTimeoutWait;
  const now = options.now ?? Date.now;
  const signal = options.signal;
  const buildHeaders = options.buildHeaders ?? defaultReplayHeaders;

  const queue = await peekAll();
  const results: ReplayResult[] = [];

  for (const initial of queue) {
    if (signal?.aborted) break;

    // Skip already-exhausted operations — they need user attention
    // via the conflict dialog (task 54.5).
    if (initial.attemptCount >= MAX_ATTEMPTS) continue;

    let op = initial;
    let outcome: ReplayOutcome = 'failed_transient';
    let status: number | null = null;
    let error: string | undefined;
    let responseBody: string | undefined;

    // Inner loop: retry the same op with backoff up to MAX_ATTEMPTS.
    // We re-read the operation from the store after every persist so
    // an external mutation (e.g. user discards) cuts the retry loop.
    while (op.attemptCount < MAX_ATTEMPTS) {
      if (signal?.aborted) break;

      const headers = {
        ...(op.payload.headers ?? {}),
        ...buildHeaders(op),
        'Idempotency-Key': op.idempotencyKey,
      };

      let response: Response | null = null;
      let fetchError: Error | null = null;
      try {
        response = await fetcher(op.payload.url, {
          method: op.operationType,
          headers,
          body: op.payload.body ?? undefined,
          signal,
        });
      } catch (err) {
        fetchError = err instanceof Error ? err : new Error(String(err));
      }

      const attemptedAt = new Date(now()).toISOString();

      if (response && response.ok) {
        // 2xx — success path.
        await dequeue(op.id);
        outcome = 'succeeded';
        status = response.status;
        error = undefined;
        responseBody = undefined;
        break;
      }

      if (response) {
        const isTransient = isTransientStatus(response.status);
        // Capture the full body once per terminal/transient response.
        // The conflict dialog needs the structured payload (Design §I)
        // and `lastError` only retains a 200-char excerpt.
        const fullBody = await readBodyFull(response);
        const bodyExcerpt = fullBody.slice(0, 200);
        const message = formatError(
          response.status,
          response.statusText || 'replay failed',
          bodyExcerpt,
        );

        const updated = await persistAttempt(op.id, op.attemptCount + 1, attemptedAt, message);
        // The record was deleted out from under us (user discarded
        // mid-replay). Record the most recent state we knew about
        // and move on to the next operation.
        if (!updated) {
          outcome = isTransient ? 'failed_transient' : 'failed_permanent';
          status = response.status;
          error = message;
          responseBody = fullBody.length > 0 ? fullBody : undefined;
          op = { ...op, attemptCount: MAX_ATTEMPTS };
          break;
        }

        op = updated;
        if (!isTransient) {
          // 4xx terminal: leave in queue for the conflict dialog.
          outcome = 'failed_permanent';
          status = response.status;
          error = message;
          responseBody = fullBody.length > 0 ? fullBody : undefined;
          break;
        }

        // 5xx / 408 / 429: bump attempts and back off.
        outcome = 'failed_transient';
        status = response.status;
        error = message;
        responseBody = fullBody.length > 0 ? fullBody : undefined;
      } else {
        // Network error / timeout — same as 5xx for retry purposes.
        const message = formatError(null, fetchError?.message ?? 'unknown network error');
        const updated = await persistAttempt(op.id, op.attemptCount + 1, attemptedAt, message);
        if (!updated) {
          outcome = 'failed_transient';
          status = null;
          error = message;
          responseBody = undefined;
          op = { ...op, attemptCount: MAX_ATTEMPTS };
          break;
        }
        op = updated;
        outcome = 'failed_transient';
        status = null;
        error = message;
        responseBody = undefined;
      }

      if (op.attemptCount >= MAX_ATTEMPTS) break;
      await wait(backoffFor(op.attemptCount));
    }

    results.push({
      id: op.id,
      outcome,
      status,
      ...(error !== undefined ? { error } : {}),
      ...(responseBody !== undefined ? { responseBody } : {}),
      attemptCount: op.attemptCount,
    });
  }

  return results;
}
