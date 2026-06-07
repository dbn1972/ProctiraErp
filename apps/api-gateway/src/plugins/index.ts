/**
 * API Gateway plugins - re-exports for convenience.
 */
export { default as errorHandlerPlugin } from './error-handler.js';
export type { ErrorHandlerOptions } from './error-handler.js';

export { default as requestContextPlugin } from './request-context.js';
export type { RequestContextOptions } from './request-context.js';

export { default as healthPlugin } from './health.js';
export type { HealthCheckOptions, HealthStatus } from './health.js';

export { default as serviceRouterPlugin } from './service-router.js';
export type { ServiceRouterOptions } from './service-router.js';

export { default as idempotencyPlugin } from './idempotency.js';
export type { IdempotencyOptions, RedisClient } from './idempotency.js';

export { default as rateLimitPlugin } from './rate-limit.js';
export type { RateLimitPluginOptions } from './rate-limit.js';
