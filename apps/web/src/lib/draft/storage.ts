/**
 * apps/web/src/lib/draft/storage.ts — Draft storage helpers (hook-free)
 * =====================================================================
 *
 * The `localStorage` contract behind `useDraftAutosave`: key building,
 * envelope read/write/remove, and the session-end purge (PRC-M079).
 *
 * This module MUST NOT import React. It is reached from server-reachable
 * code (`lib/sw/purge.ts` ← `lib/auth/session.ts` ← server components,
 * route handlers and server actions), and Next.js rejects any server
 * import graph that pulls in a module using client-only hooks. Keep the
 * React hook in `useDraftAutosave.ts` and the storage primitives here.
 *
 * Every helper is SSR safe: outside the browser reads return `null` and
 * writes/removals/purges are silent no-ops.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Schema version stamped on every persisted draft. Bump when shape changes. */
export const DRAFT_SCHEMA_VERSION = 1;

// ─── Types ───────────────────────────────────────────────────────────────────

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
 * Build the localStorage key for a given form id at the current route.
 *
 * PRC-M079: when a `scope` (tenantId:userId) is supplied it is embedded in
 * the key so a draft written by one user/tenant on a shared device is never
 * restored for another.
 */
export function buildDraftKey(formId: string, scope?: string): string {
  const scoped = scope ? `${scope}:` : '';
  return `${getBrand()}-draft:${scoped}${getRoute()}:${formId}`;
}

// ─── Storage helpers ─────────────────────────────────────────────────────────

/**
 * PRC-M079: remove every persisted draft for this brand. Called on logout,
 * 401 and user/tenant switch so a shared device never keeps the previous
 * user's in-progress form data. Best-effort; never throws.
 */
export function purgeAllDrafts(): void {
  if (typeof window === 'undefined') return;
  try {
    const prefix = `${getBrand()}-draft:`;
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(prefix)) doomed.push(key);
    }
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable — nothing to purge.
  }
}

/**
 * Read the current draft from storage. Returns `null` when storage
 * is unavailable, the slot is empty, or the persisted envelope is
 * malformed / stale.
 */
export function readDraft<T>(key: string, ttlMs?: number): DraftEnvelope<T> | null {
  if (typeof window === 'undefined') return null;
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
    if (ttlMs !== undefined) {
      // PRC-M079: expired drafts are discarded, never restored.
      const savedAt = Date.parse(envelope.savedAt);
      if (!Number.isFinite(savedAt) || Date.now() - savedAt > ttlMs) {
        window.localStorage.removeItem(key);
        return null;
      }
    }
    return envelope;
  } catch {
    // SecurityError (private mode), QuotaExceededError, or invalid JSON.
    return null;
  }
}

/** Write a draft envelope, swallowing storage errors silently. */
export function writeDraft<T>(key: string, values: T): void {
  if (typeof window === 'undefined') return;
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
export function removeDraft(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // No-op (see writeDraft for rationale).
  }
}
