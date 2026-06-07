/**
 * Fastify Staff Plugin
 *
 * Registers staff routes and service on a Fastify instance.
 * Provides the staff service as a decorator for other plugins to use.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { StaffRepository } from './staff-repository.js';
import type { StaffAssignmentRepository } from './assignment-repository.js';
import { StaffService } from './staff-service.js';
import { StaffAssignmentService } from './assignment-service.js';
import { registerStaffRoutes } from './routes.js';
import { registerAssignmentRoutes } from './assignment-routes.js';

/**
 * Options for the staff plugin.
 */
export interface StaffPluginOptions {
  /** Staff repository implementation */
  repository: StaffRepository;
  /** Staff assignment repository implementation (optional — if not provided, assignment routes are not registered) */
  assignmentRepository?: StaffAssignmentRepository;
  /** Route prefix for staff (default: '/staff') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    staffService: StaffService;
    staffAssignmentService?: StaffAssignmentService;
  }
}

/**
 * Fastify plugin that registers the staff service and routes.
 */
export const staffPlugin = fp(
  async function staffPluginImpl(
    fastify: FastifyInstance,
    options: StaffPluginOptions,
  ) {
    const { repository, assignmentRepository, prefix = '/staff' } = options;

    // Create staff service instance
    const staffService = new StaffService(repository);

    // Decorate fastify with the staff service
    fastify.decorate('staffService', staffService);

    // Register staff routes
    await registerStaffRoutes(fastify, {
      staffService,
      prefix,
    });

    // Register assignment routes if repository is provided
    if (assignmentRepository) {
      const assignmentService = new StaffAssignmentService(assignmentRepository);
      fastify.decorate('staffAssignmentService', assignmentService);

      await registerAssignmentRoutes(fastify, {
        assignmentService,
        prefix: `${prefix}/assignments`,
      });
    }
  },
  {
    name: '@proctira/backend-staff',
    fastify: '4.x',
    dependencies: [],
  },
);
