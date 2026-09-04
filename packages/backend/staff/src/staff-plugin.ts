/**
 * Fastify Staff Plugin
 *
 * Registers staff routes and service on a Fastify instance.
 * Provides the staff service as a decorator for other plugins to use.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { AppraisalRepository, AppraisalTemplateRepository } from './appraisal-repository.js';
import { AppraisalService } from './appraisal-service.js';
import { registerAppraisalRoutes } from './appraisal-routes.js';
import type { StaffAssignmentRepository } from './assignment-repository.js';
import { StaffAssignmentService } from './assignment-service.js';
import { registerAssignmentRoutes } from './assignment-routes.js';
import type { StaffRepository } from './staff-repository.js';
import { StaffService } from './staff-service.js';
import { registerStaffRoutes } from './routes.js';
import type {
  CertificationRepository,
  TrainingAttendanceRepository,
  TrainingProgramRepository,
  TrainingSessionRepository,
} from './training-repository.js';
import { TrainingService } from './training-service.js';
import { registerTrainingRoutes } from './training-routes.js';

/**
 * Options for the staff plugin.
 */
export interface StaffPluginOptions {
  /** Staff repository implementation */
  repository: StaffRepository;
  /** Staff assignment repository implementation (optional — if not provided, assignment routes are not registered) */
  assignmentRepository?: StaffAssignmentRepository;
  /** Appraisal template repository (optional — with appraisalRepository mounts appraisal routes) */
  appraisalTemplateRepository?: AppraisalTemplateRepository;
  /** Appraisal repository (optional) */
  appraisalRepository?: AppraisalRepository;
  /** Training program repository (optional — with siblings mounts training routes) */
  trainingProgramRepository?: TrainingProgramRepository;
  /** Training session repository (optional) */
  trainingSessionRepository?: TrainingSessionRepository;
  /** Training attendance repository (optional) */
  trainingAttendanceRepository?: TrainingAttendanceRepository;
  /** Certification repository (optional) */
  certificationRepository?: CertificationRepository;
  /** Route prefix for staff (default: '/staff') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    staffService: StaffService;
    staffAssignmentService?: StaffAssignmentService;
    appraisalService?: AppraisalService;
    trainingService?: TrainingService;
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
    const {
      repository,
      assignmentRepository,
      appraisalTemplateRepository,
      appraisalRepository,
      trainingProgramRepository,
      trainingSessionRepository,
      trainingAttendanceRepository,
      certificationRepository,
      prefix = '/staff',
    } = options;

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

    // Register appraisal routes when both repositories are provided
    if (appraisalTemplateRepository && appraisalRepository) {
      const appraisalService = new AppraisalService(
        appraisalTemplateRepository,
        appraisalRepository,
      );
      fastify.decorate('appraisalService', appraisalService);

      await registerAppraisalRoutes(fastify, {
        appraisalService,
        prefix: `${prefix}/appraisals`,
      });
    }

    // Register training routes when all four repositories are provided
    if (
      trainingProgramRepository &&
      trainingSessionRepository &&
      trainingAttendanceRepository &&
      certificationRepository
    ) {
      const trainingService = new TrainingService(
        trainingProgramRepository,
        trainingSessionRepository,
        trainingAttendanceRepository,
        certificationRepository,
      );
      fastify.decorate('trainingService', trainingService);

      await registerTrainingRoutes(fastify, {
        trainingService,
        prefix: `${prefix}/training`,
      });
    }
  },
  {
    name: '@proctira/backend-staff',
    fastify: '4.x',
    dependencies: [],
  },
);
