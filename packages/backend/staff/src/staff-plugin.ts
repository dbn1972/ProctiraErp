/**
 * Fastify Staff Plugin
 *
 * Registers staff routes and service on a Fastify instance.
 * Provides the staff service as a decorator for other plugins to use.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { registerAppraisalRoutes } from './appraisal-routes.js';
import { AppraisalService, type WorkflowIntegration } from './appraisal-service.js';
import type { StaffAssignmentRepository } from './assignment-repository.js';
import { registerAssignmentRoutes } from './assignment-routes.js';
import { StaffAssignmentService } from './assignment-service.js';
import {
  createAppraisalRepositories,
  createTrainingRepositories,
  type AppraisalRepositories,
  type TrainingRepositories,
} from './create-hr-repositories.js';
import type { StaffLeaveRepository } from './leave-repository.js';
import { registerStaffLeaveRoutes } from './leave-routes.js';
import { StaffLeaveService } from './leave-service.js';
import { createStaffLeaveRepository } from './pg-leave-repository.js';
import { registerStaffRoutes } from './routes.js';
import type { StaffRepository } from './staff-repository.js';
import { StaffService } from './staff-service.js';
import { registerTrainingRoutes } from './training-routes.js';
import { TrainingService, type NotificationIntegration } from './training-service.js';

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
  /** Appraisal stores (optional — defaults to PG when DATABASE_URL else in-memory) */
  appraisalRepositories?: AppraisalRepositories;
  /** Training stores (optional — defaults to PG when DATABASE_URL else in-memory) */
  trainingRepositories?: TrainingRepositories;
  /** Optional workflow integration for appraisal approval chains */
  appraisalWorkflowIntegration?: WorkflowIntegration;
  /** Optional notification integration for certification expiry alerts */
  trainingNotificationIntegration?: NotificationIntegration;
  /** Route prefix for staff (default: '/staff') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    staffService: StaffService;
    staffAssignmentService?: StaffAssignmentService;
    staffLeaveService?: StaffLeaveService;
    staffAppraisalService?: AppraisalService;
    staffTrainingService?: TrainingService;
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

    // G-717: appraisals + training were implemented but never mounted.
    const appraisalRepos = options.appraisalRepositories ?? createAppraisalRepositories();
    const appraisalService = new AppraisalService(
      appraisalRepos.templateRepository,
      appraisalRepos.appraisalRepository,
      options.appraisalWorkflowIntegration,
    );
    fastify.decorate('staffAppraisalService', appraisalService);
    await registerAppraisalRoutes(fastify, {
      appraisalService,
      prefix: `${prefix}/appraisals`,
    });

    const trainingRepos = options.trainingRepositories ?? createTrainingRepositories();
    const trainingService = new TrainingService(
      trainingRepos.programRepository,
      trainingRepos.sessionRepository,
      trainingRepos.attendanceRepository,
      trainingRepos.certificationRepository,
      options.trainingNotificationIntegration,
    );
    fastify.decorate('staffTrainingService', trainingService);
    await registerTrainingRoutes(fastify, {
      trainingService,
      prefix: `${prefix}/training`,
    });
  },
  {
    name: '@proctira/backend-staff',
    fastify: '5.x',
    dependencies: [],
  },
);
