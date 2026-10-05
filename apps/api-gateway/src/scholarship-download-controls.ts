/**
 * PRC-L344: gateway wiring for scholarship document downloads.
 *
 * - The single-use jti guard is the shared Redis store (REDIS_URL) so a consumed link is refused
 *   on every replica; production without Redis refuses to boot.
 * - The per-download audit row is written by the scholarship document routes themselves through
 *   the document store's hash-chained access log (PRC-M353), so the gateway injects no second
 *   audit sink: one access, one row, and a 503 instead of bytes when that row cannot be written.
 */
import {
  createDownloadTokenReplayGuard,
  type DownloadTokenReplayStore,
  type RedisLikeForDownloadReplay,
} from '@proctira/backend-scholarship';

export function createScholarshipDownloadReplayGuard(env: {
  redis?: RedisLikeForDownloadReplay;
  NODE_ENV?: string;
}): DownloadTokenReplayStore {
  return createDownloadTokenReplayGuard(env);
}
