/**
 * @proctira/api-gateway - API Gateway for the ProctiraERP Unified Platform
 *
 * Provides:
 * - buildApp(): Factory for creating the configured Fastify gateway instance
 * - loadConfig(): Configuration loader from environment variables
 * - Health check, service routing, rate limiting, and OpenAPI documentation
 */

export { buildApp } from './app.js';
export type { BuildAppOptions } from './app.js';
export { loadConfig } from './config.js';
export type { GatewayConfig, ServiceRoute } from './config.js';
