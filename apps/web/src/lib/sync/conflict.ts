/**
 * apps/web/src/lib/sync/conflict.ts — 409 conflict payload parsing
 * and the global event protocol that connects the Sync_Queue replay
 * loop to the `<ConflictResolutionDialog>` (task 54.5).
 * (Requirements 38.7, Design §I)
 * =====================================================================
 *
 * When `replayAll` reports a `failed_permanent` outcome with HTTP 409,
 * the API_Gateway has returned the structured conflict envelope
 * documented in Design §I:
 *
 *     interface ConflictPayload {
 *       field_conflicts: Array<{
 *         field: string;
 *         server_value: unknown;
 *         server_version: string;
 *         client_value: unknown;
 *       }>;
 *       server_record: unknown;
 *       resolution_token: string;
 *     }
 *
 * The envelope is serialised inside the standard `ApiError` shape:
 *
 *     {
 *       "error": {
 *         "code": "CONFLICT_*",
 *         "message": "…",
 *         "details": <ConflictPayload>
 *       }
 *     }
 *
 * Both shapes are accepted (envelope-or-bare) so the parser is robust
 * to gateway/handler variations. Any deviation produces a `null`
 * return — the caller (the ConnectivityProvider) treats `null` as a
 * generic permanent failure and falls back to the standard error
 * toast.
 *
 * Event protocol:
 *
 *   • `sync:conflict` — fired on `window` whenever a queued op fails
 *     with a parsable 409. The dialog listens for this and opens
 *     itself with the parsed envelope.
 *
 *   • `sync:amend-conflict` — fired by the dialog when the user picks
 *     **Amend**. The originating wizard / form listens for this and
 *     re-opens with the merged payload pre-populated.
 *
 *   • `sync:discard-conflict` — fired by the dialog when the user
 *     picks **Discard**. Listeners (the optimistic-state stores) use
 *     this to reconcile their local view to the server record.
 *
 * The events live on `window` (rather than a React context) so they
 * cross feature-module boundaries without forcing every consumer to
 * subscribe to a shared store. The payloads are typed strictly so a
 * mistyped consumer is caught at compile time.
 */

// ─── Public types ────────────────────────────────────────────────────────────

/** A single field-level disagreement between client and server. */
export interface FieldConflict {
  /** Dotted-path field identifier (e.g. `studentName`, `address.city`). */
  field: string;
  /** The value the server currently holds for this field. */
  server_value: unknown;
  /** Optimistic-concurrency token for the server's value (e.g. `"v3"`). */
  server_version: string;
  /** The value the client tried to write. */
  client_value: unknown;
}

/** Structured 409 payload returned by the API_Gateway (Design §I). */
export interface ConflictPayload {
  field_conflicts: FieldConflict[];
  /** The full server-side record after conflicts. Opaque to the dialog. */
  server_record: unknown;
  /** Token to attach to a subsequent Amend retry so the gateway can
   * correlate it with the prior conflict. */
  resolution_token: string;
}

/**
 * Detail surfaced on the `sync:conflict` window event. Bundles
 * everything the dialog needs to render without re-fetching.
 */
export interface SyncConflictEventDetail {
  /** Sync_Queue id of the failing operation. */
  queueId: string;
  /** HTTP method of the originating write. */
  method: string;
  /** Full URL of the originating write (so the dialog can show context). */
  url: string;
  /** Logical entity (e.g. `attendance`, `student`). */
  targetEntity: string;
  /** Target entity id, if known. */
  targetId: string;
  /** Local payload the user submitted (parsed from the queued JSON body). */
  localPayload: unknown;
  /** Parsed structured conflict payload from the server response. */
  conflict: ConflictPayload;
  /** Raw response body string (capped). Useful for debugging. */
  rawResponseBody: string;
}

/**
 * Detail surfaced on the `sync:amend-conflict` window event. Listeners
 * (form/wizard registries) use `targetEntity` + `url` to decide
 * whether to handle it and `mergedPayload` to pre-fill their fields.
 */
export interface SyncAmendConflictEventDetail {
  queueId: string;
  method: string;
  url: string;
  targetEntity: string;
  targetId: string;
  /** Client payload merged with the user's per-field resolution choices. */
  mergedPayload: unknown;
  /** Tokens the form must echo back when it resubmits. */
  resolutionToken: string;
}

/**
 * Detail surfaced on the `sync:discard-conflict` window event.
 * Listeners reconcile their optimistic state with `serverRecord`.
 */
export interface SyncDiscardConflictEventDetail {
  queueId: string;
  targetEntity: string;
  targetId: string;
  /** The authoritative server record the local view should reconcile to. */
  serverRecord: unknown;
}

// ─── Event names ────────────────────────────────────────────────────────────

/** Fired when a queued op fails with a parsable 409 conflict. */
export const SYNC_CONFLICT_EVENT = 'sync:conflict' as const;
/** Fired when the user picks Amend in `<ConflictResolutionDialog>`. */
export const SYNC_AMEND_CONFLICT_EVENT = 'sync:amend-conflict' as const;
/** Fired when the user picks Discard in `<ConflictResolutionDialog>`. */
export const SYNC_DISCARD_CONFLICT_EVENT = 'sync:discard-conflict' as const;

// `WindowEventMap` augmentation so `addEventListener` and
// `dispatchEvent` are typed end-to-end.
declare global {
  interface WindowEventMap {
    [SYNC_CONFLICT_EVENT]: CustomEvent<SyncConflictEventDetail>;
    [SYNC_AMEND_CONFLICT_EVENT]: CustomEvent<SyncAmendConflictEventDetail>;
    [SYNC_DISCARD_CONFLICT_EVENT]: CustomEvent<SyncDiscardConflictEventDetail>;
  }
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

/**
 * Best-effort JSON parse. Returns `null` on syntax error rather than
 * throwing so the caller can fall back to a generic error toast.
 */
function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Type guard for a single field conflict. Defensive — accepts any
 * value type for `server_value`/`client_value` because the API
 * documents them as `unknown`.
 */
function isFieldConflict(value: unknown): value is FieldConflict {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['field'] === 'string' &&
    typeof v['server_version'] === 'string' &&
    'server_value' in v &&
    'client_value' in v
  );
}

/**
 * Type guard for the conflict envelope shape. Returns `false` for
 * any deviation (missing field, wrong type, non-array conflicts) so
 * the caller can fall back to the generic error path.
 */
function isConflictPayload(value: unknown): value is ConflictPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v['field_conflicts'])) return false;
  if (!v['field_conflicts'].every(isFieldConflict)) return false;
  if (typeof v['resolution_token'] !== 'string') return false;
  // server_record may legitimately be null/undefined for delete
  // conflicts (server says the record is gone). Accept any shape.
  return 'server_record' in v;
}

/**
 * Parse a 409 response body into a `ConflictPayload`. Accepts either:
 *
 *   • The bare envelope: `{ field_conflicts, server_record, resolution_token }`
 *
 *   • The wrapped `ApiError` shape: `{ error: { details: <envelope> } }`
 *
 * Returns `null` for any other shape so the caller can safely fall
 * back to a generic error toast.
 */
export function parseConflictPayload(raw: string): ConflictPayload | null {
  if (!raw) return null;
  const parsed = tryParseJson(raw);
  if (parsed === null) return null;

  // Bare envelope.
  if (isConflictPayload(parsed)) return parsed;

  // ApiError-wrapped: { error: { code: 'CONFLICT_*', details: <envelope> } }
  if (typeof parsed === 'object' && parsed !== null) {
    const root = parsed as Record<string, unknown>;
    const error = root['error'];
    if (typeof error === 'object' && error !== null) {
      const details = (error as Record<string, unknown>)['details'];
      if (isConflictPayload(details)) return details;
    }
    // Some gateways nest under `details` directly.
    const details = root['details'];
    if (isConflictPayload(details)) return details;
  }

  return null;
}

/**
 * Parse the local payload back from the queued operation's body
 * string. The queue stores bodies as strings (so they survive
 * IndexedDB round-trips); the dialog wants the parsed object so it
 * can show field values side-by-side.
 *
 * Returns the original string on parse failure so the dialog can at
 * least display the raw text rather than crashing.
 */
export function parseLocalPayload(body: string | null | undefined): unknown {
  if (body === null || body === undefined || body === '') return null;
  const parsed = tryParseJson(body);
  return parsed ?? body;
}

// ─── Diff helpers ────────────────────────────────────────────────────────────

/**
 * Merge the local payload with the user's per-field resolution
 * choices. For each conflict, if the resolution map says `'server'`
 * the local value at that field path is replaced with the server's
 * value; if it says `'client'` the local value is kept verbatim.
 *
 * The merge is structural: nested fields use dotted-path notation
 * (e.g. `address.city`) and arrays are addressed with numeric
 * segments (`tags.0`). Unknown keys are inserted; primitives at
 * non-final segments are coerced to objects so the path can be
 * traversed.
 *
 * The function is pure: the input `localPayload` is never mutated.
 */
export type ConflictResolution = 'client' | 'server';

export function mergeResolutions(
  localPayload: unknown,
  conflicts: readonly FieldConflict[],
  resolutions: Record<string, ConflictResolution>,
): unknown {
  // Deep-clone via structuredClone (or JSON fallback for SSR safety).
  // `localPayload` may be a string (parse failed upstream) — in that
  // case we cannot meaningfully merge; return as-is.
  if (typeof localPayload !== 'object' || localPayload === null) {
    return localPayload;
  }
  const out = deepClone(localPayload) as Record<string, unknown>;
  for (const conflict of conflicts) {
    const choice = resolutions[conflict.field] ?? 'client';
    if (choice === 'server') {
      setByPath(out, conflict.field, conflict.server_value);
    }
  }
  return out;
}

function deepClone<T>(value: T): T {
  if (typeof globalThis !== 'undefined' && typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  // SSR / older runtime fallback. JSON round-trip is fine here because
  // queued payloads are JSON-serialisable by definition.
  return JSON.parse(JSON.stringify(value)) as T;
}

function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i]!;
    const next = cursor[key];
    if (typeof next !== 'object' || next === null) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]!] = value;
}
