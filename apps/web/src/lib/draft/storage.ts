/**
 * apps/web/src/lib/draft/storage.ts — Draft storage helpers (hook-free)
 * =====================================================================
 *
 * The `localStorage` contract behind `useDraftAutosave`: key building,
 * envelope read/write/remove, TTL expiry, and the session-end purge
 * (PRC-M079 / PRC-M119).
 *
 * This module MUST NOT import React. It is reached from server-reachable
 * code (`lib/sw/purge.ts` and `lib/auth/session.ts`, which route handlers,
 * server components and server actions import via `lib/auth/server.ts`),
 * and Next.js rejects any server import graph that pulls in a module using
 * client-only hooks. Keep the React hook in `useDraftAutosave.ts` and the
 * storage primitives here.
 *
 * Every helper is SSR safe: outside the browser reads return `null` and
 * writes/removals/purges are silent no-ops.
 *
 * Storage key: `<brand>-draft:[<owner>:]<route>:<formId>`, where `<owner>`
 * is `t:<tenantId>:u:<userId>` for a {@link DraftScope} object or the
 * caller-supplied string scope (normally `<tenantId>:<userId>`). Anonymous
 * drafts have no owner segment, so the route (always `/…` or `_`) follows
 * the `-draft:` marker directly.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Schema version stamped on every persisted draft. Bump when shape changes. */
export const DRAFT_SCHEMA_VERSION = 1;

/**
 * PRC-M119: drafts expire after this long (envelope `savedAt` + TTL). Expired
 * drafts are removed on read. Callers may pass a shorter/longer `ttlMs`.
 */
export const DRAFT_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** Marker that separates the brand prefix from the rest of a draft key. */
const DRAFT_KEY_MARKER = '-draft:';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Owner of a draft. Scoped drafts are only readable by the same user + tenant. */
export interface DraftScope {
  userId: string;
  tenantId: string;
}

/**
 * Accepted draft owner: a {@link DraftScope} object (PRC-M119) or an opaque
 * identity string, normally `<tenantId>:<userId>` (PRC-M079). `null` /
 * `undefined` / empty means an anonymous (unscoped) draft.
 */
export type DraftScopeInput = DraftScope | string | null | undefined;

/**
 * The on-disk shape. We persist a small envelope so that future
 * migrations can detect a stale schema and discard the draft rather
 * than handing malformed data back to the form.
 */
export interface DraftEnvelope<T> {
  /** Schema version. Older envelopes are discarded silently. */
  v: number;
  /** ISO 8601 UTC timestamp of the last write. */
  savedAt: string;
  /** The form values as supplied by the caller. */
  values: T;
}

// ─── Key helpers ─────────────────────────────────────────────────────────────

/**
 * The configured brand prefix for storage namespacing. Matches the
 * convention in `lib/sync/syncQueue.ts` so multi-tenant deployments
 * keep their drafts isolated. Falls back to `proctira` when the env
 * is missing (e.g. SSR, tests).
 */
export function getBrand(): string {
  if (typeof process !== 'undefined' && process.env) {
    const brand = process.env['NEXT_PUBLIC_BRAND'] ?? process.env['OPENEMIS_BRAND'];
    if (brand && brand.length > 0) return brand;
  }
  return 'proctira';
}

/**
 * Capture the current route segment so the storage key can be
 * scoped to the page that owns the draft. Drafts under
 * `/registration/form` should not collide with drafts under, say,
 * `/app/students/new` even if both forms reuse the same `formId`.
 *
 * SSR safe: returns `'_'` outside the browser.
 */
function getRoute(): string {
  if (typeof window === 'undefined') return '_';
  // `window.location.pathname` is stable across re-renders within a
  // SPA navigation because `useDraftAutosave` is mounted inside a
  // route component and unmounted on route exit. We deliberately do
  // not subscribe to pathname changes — the key should remain frozen
  // for the life of the form mount.
  return window.location.pathname || '/';
}

/**
 * The owner segment (without trailing `:`) for a scope, or `''` for an
 * anonymous draft. Stable primitive, so hooks can use it as an effect dep.
 */
export function draftOwnerSegment(scope: DraftScopeInput): string {
  if (!scope) return '';
  if (typeof scope === 'string') return scope;
  return `t:${scope.tenantId}:u:${scope.userId}`;
}

/**
 * Build the localStorage key for a given form id at the current route.
 *
 * PRC-M079 / PRC-M119: when a `scope` is supplied it is embedded in the key
 * so a draft written by one user/tenant on a shared device is never
 * restored for another.
 */
export function buildDraftKey(formId: string, scope?: DraftScopeInput): string {
  const owner = draftOwnerSegment(scope);
  return `${getBrand()}${DRAFT_KEY_MARKER}${owner ? `${owner}:` : ''}${getRoute()}:${formId}`;
}

/** True when the draft key carries an owner (user/tenant) segment. */
function isOwnedDraftKey(key: string): boolean {
  const rest = key.slice(key.indexOf(DRAFT_KEY_MARKER) + DRAFT_KEY_MARKER.length);
  // Anonymous keys go straight to the route: `/…` in the browser, `_` in SSR.
  return !(rest.startsWith('/') || rest.startsWith('_:'));
}

// ─── Storage helpers ─────────────────────────────────────────────────────────

/**
 * PRC-M079 / PRC-M119: remove every persisted draft (any brand, user or
 * tenant). Called on logout, session expiry, 401 and user/tenant switch so a
 * shared device never keeps the previous user's in-progress form data.
 * `ownedOnly` keeps anonymous drafts (e.g. a public registration wizard).
 * Best-effort; never throws.
 */
export function purgeAllDrafts(options: { ownedOnly?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  try {
    const storage = window.localStorage;
    const doomed: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key || !key.includes(DRAFT_KEY_MARKER)) continue;
      if (options.ownedOnly && !isOwnedDraftKey(key)) continue;
      doomed.push(key);
    }
    for (const key of doomed) storage.removeItem(key);
  } catch {
    // Storage unavailable — nothing persisted to purge.
  }
}

/**
 * Read the current draft from storage. Returns `null` when storage
 * is unavailable, the key is `null` (storage disabled), the slot is empty,
 * or the persisted envelope is malformed / stale / expired.
 */
export function readDraft<T>(
  key: string | null,
  ttlMs: number = DRAFT_DEFAULT_TTL_MS,
): DraftEnvelope<T> | null {
  if (typeof window === 'undefined' || key === null) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as { v?: unknown }).v !== DRAFT_SCHEMA_VERSION
    ) {
      // Stale schema — discard so we never hand malformed data to the form.
      window.localStorage.removeItem(key);
      return null;
    }
    const envelope = parsed as DraftEnvelope<T>;
    const savedAtMs = Date.parse(envelope.savedAt ?? '');
    if (!Number.isFinite(savedAtMs) || Date.now() - savedAtMs > ttlMs) {
      // PRC-M079 / PRC-M119: expired (or undated) draft — purge, never restore.
      window.localStorage.removeItem(key);
      return null;
    }
    return envelope;
  } catch {
    // SecurityError (private mode), QuotaExceededError, or invalid JSON.
    return null;
  }
}

/** Write a draft envelope, swallowing storage errors silently. */
export function writeDraft<T>(key: string | null, values: T): void {
  if (typeof window === 'undefined' || key === null) return;
  const envelope: DraftEnvelope<T> = {
    v: DRAFT_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    values,
  };
  try {
    window.localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // Quota or permission denial — surfacing this would block the form
    // for users on private-mode browsers, which is worse than a
    // best-effort save. Sync_Queue still owns the durable replay path.
  }
}

/** Delete a draft, swallowing storage errors silently. */
export function removeDraft(key: string | null): void {
  if (typeof window === 'undefined' || key === null) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // No-op (see writeDraft for rationale).
  }
}
