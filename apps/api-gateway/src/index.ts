/**
 * @proctira/api-gateway - API Gateway for the ProctiraERP Unified Platform
 *
 * Provides:
 * - buildApp(): Factory for creating the configured Fastify gateway instance
 * - loadConfig() / assertProductionConfig(): Configuration loader with fail-closed production checks
 * - Health check, service routing, rate limiting, and OpenAPI documentation
 */

export { buildApp } from './app.js';
export type { BuildAppOptions } from './app.js';
export { assertProductionConfig, loadConfig } from './config.js';
export type { GatewayConfig, ServiceRoute } from './config.js';
