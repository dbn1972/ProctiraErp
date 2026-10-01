/**
 * apps/web/src/lib/sw/purge.ts — session-end Cache Storage eviction
 * (PRC-H026 / PRC-H032)
 *
 * Deletes every `proctira-*` cache from the page (Cache Storage is shared
 * with the service worker) and also asks the active service worker to do
 * the same, so a shared device never keeps the previous user's cached
 * responses after logout, a 401, or a user/tenant switch.
 *
 * Best-effort and never throws: logout must not be blocked by storage errors.
 */
import { SW_CACHE_PREFIX, SW_PURGE_MESSAGE } from './pickStrategy';

export async function purgeServiceWorkerCaches(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const controller =
      typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller : undefined;
    controller?.postMessage({ type: SW_PURGE_MESSAGE });
  } catch {
    // Ignore — the direct deletion below is the primary path.
  }
  try {
    if (typeof caches === 'undefined') return;
    const names = await caches.keys();
    await Promise.all(
      names.filter((name) => name.startsWith(SW_CACHE_PREFIX)).map((name) => caches.delete(name)),
    );
  } catch {
    // Ignore — storage may be unavailable (private mode, quota errors).
  }
}
