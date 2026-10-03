/**
 * Fastify Workflow Plugin
 *
 * Registers workflow engine routes and service on a Fastify instance.
 * Provides the workflow service as a decorator for other plugins to use.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
 */
import type { QueueAdapter } from '@proctira/queue-abstraction';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { AreaHierarchyResolver } from './assignment-service.js';
import { AssignmentService } from './assignment-service.js';
import type { CaseRepository } from './case-repository.js';
import { registerCaseRoutes } from './case-routes.js';
import { CaseService } from './case-service.js';
import { EscalationService } from './escalation-service.js';
import type { EscalationPublisher } from './escalation-service.js';
import {
  createWorkflowEscalationWorker,
  type WorkflowEscalationWorker,
} from './escalation-worker.js';
import { registerWorkflowRoutes } from './routes.js';
import type { WorkflowRepository } from './workflow-repository.js';
import { WorkflowService } from './workflow-service.js';

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
  /**
   * PRC-H110: dedicated queue adapter the in-process escalation worker
   * consumes from (started onReady, stopped onClose).
   */
  escalationWorkerQueue?: QueueAdapter;
  /**
   * PRC-H110: reject definitions with escalationRules (422) when the worker is
   * not wired. Default false (env WORKFLOW_REJECT_UNWIRED_ESCALATIONS).
   */
  rejectUnwiredEscalations?: boolean;
  /** Area hierarchy resolver (optional - enables area-based assignment) */
  areaHierarchyResolver?: AreaHierarchyResolver;
  /** Route prefix for workflows (default: '/workflows') */
  prefix?: string;
}

/** PRC-H110: escalation pipeline health (degraded when rules cannot fire). */
export interface WorkflowEscalationHealth {
  status: 'ok' | 'degraded';
  wiring: 'wired' | 'publisher_only' | 'unwired';
  rejectUnwiredEscalations: boolean;
  message?: string;
}

/** Parse WORKFLOW_REJECT_UNWIRED_ESCALATIONS (default false). */
export function readRejectUnwiredEscalations(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env['WORKFLOW_REJECT_UNWIRED_ESCALATIONS']?.trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    workflowService: WorkflowService;
    caseService?: CaseService;
    escalationService?: EscalationService;
    escalationWorker?: WorkflowEscalationWorker;
    workflowEscalationHealth: () => WorkflowEscalationHealth;
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
      escalationWorkerQueue,
      areaHierarchyResolver,
      prefix = '/workflows',
      rejectUnwiredEscalations = readRejectUnwiredEscalations(),
    } = options;

    // Create workflow service instance
    const workflowService = new WorkflowService(repository);

    // Set up escalation service if publisher is provided (Req 13.6)
    if (escalationPublisher) {
      const escalationService = new EscalationService(repository, escalationPublisher);
      workflowService.setEscalationService(escalationService);
      fastify.decorate('escalationService', escalationService);
      if (escalationWorkerQueue) {
        const worker = createWorkflowEscalationWorker({
          queue: escalationWorkerQueue,
          processor: escalationService,
          logger: {
            info: (obj, msg) => fastify.log.info(obj, msg),
            error: (obj, msg) => fastify.log.error(obj, msg),
          },
        });
        fastify.decorate('escalationWorker', worker);
        // Bind the work queue before traffic so mandatory dispatch (PRC-H087) routes.
        fastify.addHook('onReady', async () => {
          await worker.start();
        });
        fastify.addHook('onClose', async () => {
          await worker.stop();
        });
      } else {
        fastify.log.warn(
          'workflow escalation publisher configured without a consumer; escalations will not be processed in this process',
        );
      }
    } else {
      fastify.log.warn(
        'workflow escalation publisher not configured (QUEUE_BACKEND/RABBITMQ_URL unset); escalation rules will not fire',
      );
    }

    // PRC-H110: escalation health — degraded unless a consumer is running here.
    const wiring: WorkflowEscalationHealth['wiring'] = escalationPublisher
      ? escalationWorkerQueue
        ? 'wired'
        : 'publisher_only'
      : 'unwired';
    workflowService.setEscalationWiring(wiring === 'wired', rejectUnwiredEscalations);
    const health: WorkflowEscalationHealth =
      wiring === 'wired'
        ? { status: 'ok', wiring, rejectUnwiredEscalations }
        : {
            status: 'degraded',
            wiring,
            rejectUnwiredEscalations,
            message:
              wiring === 'publisher_only'
                ? 'escalations are published but no consumer runs in this process'
                : 'no escalation publisher configured; escalation rules will not fire',
          };
    fastify.decorate('workflowEscalationHealth', () => ({ ...health }));
    fastify.get(`${prefix}/escalations/health`, async (_request, reply) =>
      reply.status(200).send(health),
    );

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
