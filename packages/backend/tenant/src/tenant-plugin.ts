/**
 * Fastify Tenant Lifecycle Plugin
 *
 * Registers tenant lifecycle routes and service on a Fastify instance.
 * Provides the tenant service as a decorator for other plugins to use.
 *
 * Charter: Section 6 (Tenant Model)
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import {
  registerBrandingRoutes,
  type BrandingPermissionResolver,
  type TenantIdResolver,
} from './branding-routes.js';
import { registerTenantRoutes } from './routes.js';
import type { TenantRepository } from './tenant-repository.js';
import { TenantService } from './tenant-service.js';

/**
 * Options for the tenant lifecycle plugin.
 */
export interface TenantPluginOptions {
  /** Tenant repository implementation */
  repository: TenantRepository;
  /** Route prefix for tenant routes (default: '/tenants') */
  prefix?: string;
  /**
   * Branding route configuration (Tasks 58.2 + 58.3). When omitted, the
   * branding endpoints are still registered at `/tenant/branding` and rely
   * on the default tenant resolver (`request.tenantId`).
   */
  branding?: {
    /** Route prefix for branding endpoints (default: `/tenant/branding`). */
    prefix?: string;
    /** Override tenant-id resolution (default reads `request.tenantId`). */
    getTenantId?: TenantIdResolver;
    /**
     * Permission resolver invoked for the preview path AND for draft
     * mutating endpoints (Task 58.3). When omitted, all preview signals
     * are ignored and draft endpoints reject every request — fail-closed
     * by design.
     */
    hasPermission?: BrandingPermissionResolver;
    /** When true, do NOT register the branding routes. */
    disabled?: boolean;
  };
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    tenantService: TenantService;
  }
}

/**
 * Fastify plugin that registers the tenant lifecycle service and routes.
 */
export const tenantLifecyclePlugin = fp(
  async function tenantLifecyclePluginImpl(fastify: FastifyInstance, options: TenantPluginOptions) {
    const { repository, prefix = '/tenants', branding } = options;

    // Create tenant service instance
    const tenantService = new TenantService(repository);

    // Decorate fastify with the tenant service
    fastify.decorate('tenantService', tenantService);

    // Register tenant routes
    await registerTenantRoutes(fastify, {
      tenantService,
      prefix,
    });

    // Register branding routes (Tasks 58.2 + 58.3) unless explicitly disabled.
    if (!branding?.disabled) {
      await registerBrandingRoutes(fastify, {
        tenantService,
        prefix: branding?.prefix,
        getTenantId: branding?.getTenantId,
        hasPermission: branding?.hasPermission,
      });
    }
  },
  {
    name: '@proctira/backend-tenant',
    fastify: '5.x',
    dependencies: [],
  },
);
