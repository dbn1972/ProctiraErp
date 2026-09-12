/**
 * @proctira/backend-workflow - Workflow Engine service
 *
 * Provides multi-step approval workflows with:
 * - Configurable states, transitions, and assignee rules (Req 13.1)
 * - Role/user assignment based on Area_Hierarchy and institution context (Req 13.2)
 * - Transition audit logging with timestamp, actor, and comments (Req 13.3)
 * - Parallel and sequential approval paths with escalation rules (Req 13.4)
 * - Case management (disciplinary, counselling, complaints) with status, attachments, resolution (Req 13.5)
 * - Timeout-based escalation via RabbitMQ delayed messages (Req 13.6)
 */

// Plugin
export { workflowPlugin } from './workflow-plugin.js';
export type { WorkflowPluginOptions } from './workflow-plugin.js';

// Service
export { WorkflowService } from './workflow-service.js';

// Repository
export type {
  WorkflowRepository,
  WorkflowDefinitionEntity,
  WorkflowDefinitionFilter,
  WorkflowInstanceEntity,
  WorkflowInstanceFilter,
  WorkflowInstanceStatus,
  TransitionAuditEntity,
  ApprovalRecord,
} from './workflow-repository.js';

// In-memory repository (for testing)
export { InMemoryWorkflowRepository } from './in-memory-repository.js';

// Postgres repositories + factory (G-715)
export {
  PgWorkflowRepository,
  PgCaseRepository,
  ensureWorkflowEngineSchema,
} from './pg-workflow-repository.js';
export type { WorkflowPgPool } from './pg-workflow-repository.js';
export { createWorkflowRepositories } from './create-workflow-repositories.js';
export type { WorkflowRepositories } from './create-workflow-repositories.js';

// Cached repository decorator
export { CachedWorkflowRepository } from './cached-workflow-repository.js';

// Schemas
export {
  WorkflowStateSchema,
  WorkflowTransitionSchema,
  EscalationRuleSchema,
  CreateWorkflowDefinitionSchema,
  UpdateWorkflowDefinitionSchema,
  CreateWorkflowInstanceSchema,
  TransitionRequestSchema,
  WorkflowDefinitionParamsSchema,
  WorkflowInstanceParamsSchema,
  WorkflowDefinitionListQuerySchema,
  WorkflowInstanceListQuerySchema,
  TransitionAuditResponseSchema,
  WorkflowInstanceResponseSchema,
  WorkflowDefinitionResponseSchema,
} from './schemas.js';
export type {
  WorkflowStateInput,
  WorkflowTransitionInput,
  EscalationRuleInput,
  CreateWorkflowDefinitionInput,
  UpdateWorkflowDefinitionInput,
  CreateWorkflowInstanceInput,
  TransitionRequestInput,
  WorkflowDefinitionParams,
  WorkflowInstanceParams,
  WorkflowDefinitionListQuery,
  WorkflowInstanceListQuery,
  TransitionAuditResponse,
  WorkflowInstanceResponse,
  WorkflowDefinitionResponse,
} from './schemas.js';

// Routes
export { registerWorkflowRoutes } from './routes.js';
export type { WorkflowRoutesOptions } from './routes.js';

// ─── Escalation Service (Req 13.6) ──────────────────────────────────────────

export { EscalationService, InMemoryEscalationPublisher } from './escalation-service.js';
export type {
  EscalationPublisher,
  EscalationTaskPayload,
  EscalationNotification,
} from './escalation-service.js';

export { QueueEscalationPublisher } from './queue-escalation-publisher.js';
export { createEscalationPublisherFromEnv } from './escalation-publisher-factory.js';
export type { EscalationPublisherHandle } from './escalation-publisher-factory.js';
export { createWorkflowEscalationWorker } from './escalation-worker.js';
export type {
  WorkflowEscalationWorker,
  WorkflowEscalationWorkerOptions,
  WorkflowEscalationProcessor,
  WorkflowEscalationWorkerLogger,
} from './escalation-worker.js';

// ─── Case Management (Req 13.5) ─────────────────────────────────────────────

export { CaseService } from './case-service.js';

export type { CaseRepository, CaseEntity, CaseFilter } from './case-repository.js';

export { InMemoryCaseRepository } from './in-memory-case-repository.js';

export {
  CaseTypeEnum,
  CaseStatusEnum,
  CaseAttachmentSchema,
  CaseResolutionSchema,
  CreateCaseSchema,
  UpdateCaseSchema,
  AddAttachmentSchema,
  ResolveCaseSchema,
  CaseParamsSchema,
  CaseListQuerySchema,
  CaseResponseSchema,
} from './case-schemas.js';
export type {
  CaseType,
  CaseStatus,
  CaseAttachmentInput,
  CaseResolutionInput,
  CreateCaseInput,
  UpdateCaseInput,
  AddAttachmentInput,
  ResolveCaseInput,
  CaseParams,
  CaseListQuery,
  CaseResponse,
} from './case-schemas.js';

export { registerCaseRoutes } from './case-routes.js';
export type { CaseRoutesOptions } from './case-routes.js';

// ─── Assignment Service (Req 13.2) ──────────────────────────────────────────

export { AssignmentService, InMemoryAreaHierarchyResolver } from './assignment-service.js';
export type {
  AreaHierarchyResolver,
  AssignmentContext,
  AssignmentTarget,
  AreaNode,
} from './assignment-service.js';
