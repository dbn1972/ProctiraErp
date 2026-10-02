/**
 * Session-end purge of everything this browser keeps for a signed-in user
 * (PRC-H026 / PRC-H032): service-worker Cache Storage, the offline
 * Sync_Queue (IndexedDB) and autosaved form drafts (localStorage).
 *
 * Runs on explicit sign-out and whenever a *different* user/tenant signs in
 * on the same browser — including across an expired session, because the
 * last identity is remembered in localStorage rather than in React state.
 * A plain 401/expiry only evicts caches (see browser-gateway): queued
 * offline writes belong to the user and must survive a token refresh.
 *
 * Best-effort and never throws: sign-out must not be blocked by storage errors.
 */
import { clearAllDrafts } from '@/lib/draft/useDraftAutosave';
import { clearSyncQueue } from '@/lib/sync/syncQueue';
import { purgeServiceWorkerCaches } from '@/lib/sw/purge';

function brand(): string {
  const value =
    typeof process !== 'undefined' && process.env
      ? (process.env['NEXT_PUBLIC_BRAND'] ?? process.env['OPENEMIS_BRAND'])
      : undefined;
  return value && value.length > 0 ? value : 'proctira';
}

/** localStorage key holding `<tenantId>:<userId>` of the last signed-in user. */
export function sessionIdentityKey(): string {
  return `${brand()}-session-identity`;
}

/** Delete caches, queued offline operations and drafts. Never throws. */
export async function purgeUserOfflineData(): Promise<void> {
  await Promise.allSettled([
    purgeServiceWorkerCaches(),
    clearSyncQueue(),
    Promise.resolve().then(() => clearAllDrafts()),
  ]);
}

function readIdentity(): string | null {
  try {
    return window.localStorage.getItem(sessionIdentityKey());
  } catch {
    return null;
  }
}

function writeIdentity(identity: string | null): void {
  try {
    if (identity === null) window.localStorage.removeItem(sessionIdentityKey());
    else window.localStorage.setItem(sessionIdentityKey(), identity);
  } catch {
    // Storage unavailable (private mode / quota) — nothing to remember.
  }
}

/**
 * Record the identity that is now signed in. When it differs from the last
 * remembered identity, the previous user's offline data is purged first.
 * Resolves `true` when a purge happened.
 */
export async function noteSignedInIdentity(identity: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const previous = readIdentity();
  const switched = previous !== null && previous !== identity;
  if (switched) await purgeUserOfflineData();
  writeIdentity(identity);
  return switched;
}

/** Explicit sign-out: purge everything and forget the identity. */
export async function purgeOnSignOut(): Promise<void> {
  if (typeof window === 'undefined') return;
  await purgeUserOfflineData();
  writeIdentity(null);
}
