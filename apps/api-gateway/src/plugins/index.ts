/**
 * API Gateway plugins - re-exports for convenience.
 *
 * PRC-L398: export only plugins the gateway actually mounts. Rate limiting is registered once,
 * directly via `@fastify/rate-limit` in app.ts (keyed by `rateLimitKeyFor`); request ids come
 * from `@proctira/logging`. The unmounted request-context / rate-limit / static-assets plugins
 * were removed.
 */
export { default as errorHandlerPlugin } from './error-handler.js';
export type { ErrorHandlerOptions } from './error-handler.js';

export { default as healthPlugin } from './health.js';
export type { HealthCheckOptions, HealthStatus } from './health.js';

export { default as serviceRouterPlugin } from './service-router.js';
export type { ServiceRouterOptions } from './service-router.js';

export { default as idempotencyPlugin } from './idempotency.js';
export type { IdempotencyOptions, RedisClient } from './idempotency.js';
export {
  assertIdempotencyRedisClient,
  readIdempotencyStoreEnv,
  resolveIdempotencyStore,
  resolveIdempotencyStoreMode,
} from './idempotency-store.js';
export type {
  IdempotencyStoreMode,
  IdempotencyStorePolicyEnv,
  ResolvedIdempotencyStore,
} from './idempotency-store.js';

export { default as paginationCapPlugin } from './pagination-cap.js';
