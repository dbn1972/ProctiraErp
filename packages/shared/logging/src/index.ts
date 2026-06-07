/**
 * @proctira/logging - Structured logging with Pino for the ProctiraERP platform
 *
 * Provides:
 * - createLogger(): Factory for creating Pino loggers with tenant context
 * - loggingPlugin: Fastify plugin for automatic request/response logging
 */

export { createLogger } from './logger.js';
export type { CreateLoggerOptions, LogContext } from './logger.js';

export { loggingPlugin } from './fastify-plugin.js';
export type { LoggingPluginOptions } from './fastify-plugin.js';
