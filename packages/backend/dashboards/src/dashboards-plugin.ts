/**
 * Fastify plugin that mounts the dashboard routes.
 *
 * Caller responsibilities:
 *   - Register an auth plugin BEFORE this plugin so JWTs are verified.
 *   - Pass a concrete `DashboardRepository` (Prisma in production, the
 *     in-memory implementation in tests).
 *   - Pass a concrete `AreaHierarchyResolver` so descendants are
 *     included in the per-row scope filter.
 */

import type { AreaHierarchyResolver } from '@proctira/auth';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { DashboardRepository } from './dashboard-repository.js';
import { DashboardService } from './dashboard-service.js';
import { registerDashboardRoutes } from './routes.js';

export interface DashboardsPluginOptions {
  repository: DashboardRepository;
  areaResolver: AreaHierarchyResolver;
  /** Route prefix (default: `/dashboards`). */
  prefix?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    dashboardService: DashboardService;
  }
}

export const dashboardsPlugin = fp(
  async function dashboardsPluginImpl(fastify: FastifyInstance, options: DashboardsPluginOptions) {
    const { repository, areaResolver, prefix = '/dashboards' } = options;

    const service = new DashboardService({ repository, areaResolver });
    fastify.decorate('dashboardService', service);

    await registerDashboardRoutes(fastify, { service, prefix });
  },
  {
    name: '@proctira/backend-dashboards',
    fastify: '4.x',
  },
);
