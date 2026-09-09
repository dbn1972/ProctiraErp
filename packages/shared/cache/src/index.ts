/**
 * @proctira/cache - Redis caching layer with graceful degradation
 *
 * This package provides:
 * - CacheClient: Redis-backed cache with read-through pattern
 * - Key builders: Consistent, tenant-scoped cache key generation
 * - Metrics: Hit/miss/error tracking
 * - Graceful degradation: Falls through to fetcher when Redis is unavailable
 */

export { CacheClient } from './cache-client.js';
export type { CacheClientOptions, CacheMetrics } from './cache-client.js';

export { tenantKey, configKey, listKey } from './cache-keys.js';

export { reviveDates } from './revive-dates.js';
