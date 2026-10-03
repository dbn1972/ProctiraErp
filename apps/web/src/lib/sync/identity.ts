/**
 * PRC-M119 — the signed-in identity the Sync_Queue may replay for.
 *
 * `undefined` = never set (no AuthProvider mounted, e.g. isolated tests):
 * replay is unfiltered. `null` = signed out: nothing replays. Otherwise only
 * operations enqueued by this tenant + user replay; the rest stay queued
 * (quarantined) and are never sent with another user's session.
 */
export interface SyncIdentity {
  tenantId: string;
  userId: string;
}

let current: SyncIdentity | null | undefined;

export function setSyncIdentity(identity: SyncIdentity | null): void {
  current = identity;
}

export function getSyncIdentity(): SyncIdentity | null | undefined {
  return current;
}

/** True when `op` may be replayed under `identity`. */
export function canReplayFor(
  op: { tenantId: string; userId: string },
  identity: SyncIdentity | null | undefined,
): boolean {
  if (identity === undefined) return true;
  if (identity === null) return false;
  return op.tenantId === identity.tenantId && op.userId === identity.userId;
}
