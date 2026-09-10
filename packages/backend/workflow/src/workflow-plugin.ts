/**
 * Fastify Workflow Plugin
 *
 * Registers workflow engine routes and service on a Fastify instance.
 * Provides the workflow service as a decorator for other plugins to use.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { WorkflowRepository } from './workflow-repository.js';
import type { CaseRepository } from './case-repository.js';
import type { EscalationPublisher } from './escalation-service.js';
import type { AreaHierarchyResolver } from './assignment-service.js';
import { WorkflowService } from './workflow-service.js';
import { CaseService } from './case-service.js';
import { EscalationService } from './escalation-service.js';
import { AssignmentService } from './assignment-service.js';
import { registerWorkflowRoutes } from './routes.js';
import { registerCaseRoutes } from './case-routes.js';

/**
 * Options for the workflow plugin.
 */
export interface WorkflowPluginOptions {
  /** Workflow repository implementation */
  repository: WorkflowRepository;
  /** Case repository implementation (optional - enables case management routes) */
  caseRepository?: CaseRepository;
  /** Escalation publisher (optional - enables escalation scheduling) */
  escalationPublisher?: EscalationPublisher;
  /** Area hierarchy resolver (optional - enables area-based assignment) */
  areaHierarchyResolver?: AreaHierarchyResolver;
  /** Route prefix for workflows (default: '/workflows') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    workflowService: WorkflowService;
    caseService?: CaseService;
    escalationService?: EscalationService;
    assignmentService?: AssignmentService;
  }
}

/**
 * Fastify plugin that registers the workflow service and routes.
 */
export const workflowPlugin = fp(
  async function workflowPluginImpl(fastify: FastifyInstance, options: WorkflowPluginOptions) {
    const {
      repository,
      caseRepository,
      escalationPublisher,
      areaHierarchyResolver,
      prefix = '/workflows',
    } = options;

    // Create workflow service instance
    const workflowService = new WorkflowService(repository);

    // Set up escalation service if publisher is provided (Req 13.6)
    if (escalationPublisher) {
      const escalationService = new EscalationService(repository, escalationPublisher);
      workflowService.setEscalationService(escalationService);
      fastify.decorate('escalationService', escalationService);
    }

    // Set up assignment service if area resolver is provided (Req 13.2)
    if (areaHierarchyResolver) {
      const assignmentService = new AssignmentService(areaHierarchyResolver);
      fastify.decorate('assignmentService', assignmentService);
    }

    // Decorate fastify with the workflow service
    fastify.decorate('workflowService', workflowService);

    // Register workflow routes
    await registerWorkflowRoutes(fastify, {
      workflowService,
      prefix,
    });

    // Register case management routes if case repository is provided (Req 13.5)
    if (caseRepository) {
      const caseService = new CaseService(caseRepository);
      fastify.decorate('caseService', caseService);
      await registerCaseRoutes(fastify, {
        caseService,
        prefix: `${prefix}/cases`,
      });
    }
  },
  {
    name: '@proctira/backend-workflow',
    fastify: '5.x',
    dependencies: [],
  },
);
