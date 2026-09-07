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
import type { StaffLeaveRepository } from './leave-repository.js';
import { StaffService } from './staff-service.js';
import { StaffAssignmentService } from './assignment-service.js';
import { StaffLeaveService } from './leave-service.js';
import { registerStaffRoutes } from './routes.js';
import { registerAssignmentRoutes } from './assignment-routes.js';
import { registerStaffLeaveRoutes } from './leave-routes.js';
import { createStaffLeaveRepository } from './pg-leave-repository.js';

/**
 * Options for the staff plugin.
 */
export interface StaffPluginOptions {
  /** Staff repository implementation */
  repository: StaffRepository;
  /** Staff assignment repository implementation (optional — if not provided, assignment routes are not registered) */
  assignmentRepository?: StaffAssignmentRepository;
  /** Staff leave repository (optional — defaults to PG when DATABASE_URL else in-memory) */
  leaveRepository?: StaffLeaveRepository;
  /** Route prefix for staff (default: '/staff') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    staffService: StaffService;
    staffAssignmentService?: StaffAssignmentService;
    staffLeaveService?: StaffLeaveService;
  }
}

/**
 * Fastify plugin that registers the staff service and routes.
 */
export const staffPlugin = fp(
  async function staffPluginImpl(fastify: FastifyInstance, options: StaffPluginOptions) {
    const { repository, assignmentRepository, prefix = '/staff' } = options;
    const leaveRepository = options.leaveRepository ?? createStaffLeaveRepository();

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

    const leaveService = new StaffLeaveService(leaveRepository);
    fastify.decorate('staffLeaveService', leaveService);
    await registerStaffLeaveRoutes(fastify, {
      leaveService,
      prefix,
    });
  },
  {
    name: '@proctira/backend-staff',
    fastify: '4.x',
    dependencies: [],
  },
);
