/**
 * Admin Dashboard Fastify Plugin
 *
 * Registers the scalability monitoring routes as a Fastify plugin.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { registerScalabilityRoutes, type ScalabilityRoutesOptions } from './scalability-routes.js';

export interface AdminDashboardPluginOptions extends ScalabilityRoutesOptions {}

export default fp(
  async (app: FastifyInstance, options: AdminDashboardPluginOptions) => {
    await registerScalabilityRoutes(app, options);
  },
  {
    name: 'admin-dashboard-plugin',
    fastify: '4.x',
  },
);
