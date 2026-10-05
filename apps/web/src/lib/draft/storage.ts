/**
 * apps/web/src/lib/draft/storage.ts — hook-free draft storage helpers.
 * =====================================================================
 *
 * The `localStorage` contract behind `useDraftAutosave` (key format,
 * envelope, TTL, purge). Kept free of React imports so server-reachable
 * modules (e.g. `lib/auth/session.ts`, which is imported by route handlers
 * via `lib/auth/server.ts`) can purge drafts on sign-out without pulling a
 * client hook into the server graph. Every function is a no-op outside the
 * browser.
 *
 * Storage key: `<brand>-draft:[t:<tenantId>:u:<userId>:]<route>:<formId>`.
 */

/**
 * PRC-M119: drafts expire after this long (envelope `savedAt` + TTL). Expired
 * drafts are removed on read.
 */
export const DRAFT_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** Owner of a draft. Scoped drafts are only readable by the same user + tenant. */
export interface DraftScope {
  userId: string;
  tenantId: string;
}

/** Schema version stamped on every persisted draft. Bump when shape changes. */
const DRAFT_SCHEMA_VERSION = 1;

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

/**
 * The configured brand prefix for storage namespacing. Matches the
 * convention in `lib/sync/syncQueue.ts` so multi-tenant deployments
 * keep their drafts isolated. Falls back to `proctira` when the env
 * is missing (e.g. SSR, tests).
 */
function getBrand(): string {
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

/** Build the localStorage key for a given form id at the current route. */
export function buildDraftKey(formId: string, scope?: DraftScope | null): string {
  const owner = scope ? `t:${scope.tenantId}:u:${scope.userId}:` : '';
  return `${getBrand()}-draft:${owner}${getRoute()}:${formId}`;
}

/**
 * PRC-M119: remove every persisted draft (any brand, user or tenant). Called
 * on sign-out, session expiry and user/tenant switch so a shared device never
 * keeps the previous user's form data.
 */
export function purgeAllDrafts(options: { ownedOnly?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  try {
    const storage = window.localStorage;
    const doomed: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key || !key.includes('-draft:')) continue;
      // `ownedOnly` keeps anonymous drafts (e.g. a public registration wizard).
      if (options.ownedOnly && !key.includes('-draft:t:')) continue;
      doomed.push(key);
    }
    for (const key of doomed) storage.removeItem(key);
  } catch {
    // Storage unavailable — nothing persisted to purge.
  }
}

/**
 * Read the current draft from storage. Returns `null` when storage
 * is unavailable, the slot is empty, or the persisted envelope is
 * malformed / stale.
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
    const savedAtMs = Date.parse((parsed as { savedAt?: string }).savedAt ?? '');
    if (!Number.isFinite(savedAtMs) || Date.now() - savedAtMs > ttlMs) {
      // PRC-M119: expired (or undated) draft — purge rather than restore.
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed as DraftEnvelope<T>;
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
