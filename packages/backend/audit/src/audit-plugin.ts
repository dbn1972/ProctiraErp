/**
 * Fastify Audit Plugin
 *
 * Registers audit routes and service on a Fastify instance.
 * Provides the audit service as a decorator for other plugins to use.
 *
 * Requirements:
 * - 21.1: Record audit log entry for every create/update/delete on protected entities
 * - 21.2: Log authenticated user, timestamp, IP address, entity
 * - 21.3: Append-only storage preventing modification/deletion
 * - 21.4: Query with filtering by entity type, user, date range, operation type
 * - 21.5: Configurable retention with automated archival
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { AuditRepository } from './audit-repository.js';
import { AuditService } from './audit-service.js';
import { registerAuditRoutes } from './routes.js';

/**
 * Options for the audit plugin.
 */
export interface AuditPluginOptions {
  /** Audit repository implementation */
  repository: AuditRepository;
  /** Route prefix for audit (default: '/audit') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    auditService: AuditService;
  }
}

/**
 * Fastify plugin that registers the audit service and routes.
 *
 * Usage:
 * ```typescript
 * import { auditPlugin } from '@proctira/backend-audit/plugin';
 *
 * fastify.register(auditPlugin, {
 *   repository: new PostgresAuditRepository(prisma),
 *   prefix: '/api/v1/audit',
 * });
 * ```
 */
export const auditPlugin = fp(
  async function auditPluginImpl(fastify: FastifyInstance, options: AuditPluginOptions) {
    const { repository, prefix = '/audit' } = options;

    // Create audit service instance
    const auditService = new AuditService(repository);

    // Decorate fastify with the audit service
    fastify.decorate('auditService', auditService);

    // Register audit routes
    await registerAuditRoutes(fastify, {
      auditService,
      prefix,
    });
  },
  {
    name: '@proctira/backend-audit',
    fastify: '4.x',
    dependencies: [],
  },
);
