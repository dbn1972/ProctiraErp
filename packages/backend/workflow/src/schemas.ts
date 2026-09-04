/**
 * Typebox schemas for Workflow Engine request/response validation.
 *
 * Defines schemas for:
 * - WorkflowDefinition CRUD (states, transitions, assignee rules)
 * - WorkflowInstance creation and transitions
 * - Transition audit records
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4
 */
import { Type, type Static } from '@sinclair/typebox';

// UUID pattern for validation
const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

// ─── Workflow State Schema ───────────────────────────────────────────────────

/**
 * Schema for a workflow state definition.
 * Requirement 13.1: configurable states with assignee rules
 * Requirement 13.2: assigning steps to roles/users based on area/institution context
 */
export const WorkflowStateSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 100, description: 'Unique state identifier within the workflow' }),
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Human-readable state name' }),
  type: Type.Union(
    [Type.Literal('INITIAL'), Type.Literal('INTERMEDIATE'), Type.Literal('FINAL')],
    { description: 'State type: INITIAL (start), INTERMEDIATE (in-progress), FINAL (end)' },
  ),
  assigneeType: Type.Union(
    [Type.Literal('role'), Type.Literal('user'), Type.Literal('area_role')],
    { description: 'How the assignee is determined for this state' },
  ),
  assigneeId: Type.String({ minLength: 1, maxLength: 255, description: 'Role ID, user ID, or area-role identifier' }),
  institutionScoped: Type.Optional(Type.Boolean({ description: 'Whether assignment is scoped to institution context' })),
});

export type WorkflowStateInput = Static<typeof WorkflowStateSchema>;

// ─── Workflow Transition Schema ──────────────────────────────────────────────

/**
 * Schema for a workflow transition definition.
 * Requirement 13.1: configurable transitions
 * Requirement 13.4: parallel and sequential approval paths
 */
export const WorkflowTransitionSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 100, description: 'Unique transition identifier' }),
  fromStateId: Type.String({ minLength: 1, maxLength: 100, description: 'Source state ID' }),
  toStateId: Type.String({ minLength: 1, maxLength: 100, description: 'Target state ID' }),
  action: Type.String({ minLength: 1, maxLength: 100, description: 'Action name (e.g., approve, reject, escalate)' }),
  requiredApprovals: Type.Optional(Type.Number({
    minimum: 1,
    maximum: 100,
    description: 'Number of approvals required for parallel paths (default: 1)',
  })),
  conditions: Type.Optional(Type.Array(Type.Object({
    field: Type.String({ description: 'Field to evaluate' }),
    operator: Type.Union([
      Type.Literal('eq'),
      Type.Literal('neq'),
      Type.Literal('gt'),
      Type.Literal('lt'),
      Type.Literal('in'),
    ]),
    value: Type.Unknown({ description: 'Value to compare against' }),
  }), { description: 'Optional conditions that must be met for this transition' })),
});

export type WorkflowTransitionInput = Static<typeof WorkflowTransitionSchema>;

// ─── Escalation Rule Schema ─────────────────────────────────────────────────

/**
 * Schema for escalation rules.
 * Requirement 13.4: configurable escalation rules
 */
export const EscalationRuleSchema = Type.Object({
  stateId: Type.String({ minLength: 1, maxLength: 100, description: 'State to monitor for escalation' }),
  durationMinutes: Type.Number({ minimum: 1, description: 'Minutes before escalation triggers' }),
  escalateToStateId: Type.String({ minLength: 1, maxLength: 100, description: 'State to escalate to' }),
  notifyRoleId: Type.Optional(Type.String({ description: 'Role to notify on escalation' })),
});

export type EscalationRuleInput = Static<typeof EscalationRuleSchema>;

// ─── Workflow Definition Schemas ─────────────────────────────────────────────

/**
 * Schema for creating a workflow definition.
 * Requirement 13.1: multi-step approval workflows with configurable states, transitions, and assignee rules
 */
export const CreateWorkflowDefinitionSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Workflow name' }),
  entityType: Type.String({ minLength: 1, maxLength: 100, description: 'Entity type this workflow applies to (e.g., student_transfer, staff_leave)' }),
  description: Type.Optional(Type.String({ maxLength: 1000, description: 'Workflow description' })),
  states: Type.Array(WorkflowStateSchema, { minItems: 2, description: 'Workflow states (must have at least initial and final)' }),
  transitions: Type.Array(WorkflowTransitionSchema, { minItems: 1, description: 'Allowed transitions between states' }),
  escalationRules: Type.Optional(Type.Array(EscalationRuleSchema, { description: 'Escalation rules for timeout handling' })),
});

export type CreateWorkflowDefinitionInput = Static<typeof CreateWorkflowDefinitionSchema>;

/**
 * Schema for updating a workflow definition.
 * Accepts pause/resume via `isActive`, `paused`, or `status` (`active`/`paused`).
 */
export const UpdateWorkflowDefinitionSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255, description: 'Workflow name' })),
  description: Type.Optional(Type.String({ maxLength: 1000, description: 'Workflow description' })),
  states: Type.Optional(Type.Array(WorkflowStateSchema, { minItems: 2, description: 'Workflow states' })),
  transitions: Type.Optional(Type.Array(WorkflowTransitionSchema, { minItems: 1, description: 'Allowed transitions' })),
  escalationRules: Type.Optional(Type.Array(EscalationRuleSchema, { description: 'Escalation rules' })),
  isActive: Type.Optional(Type.Boolean({ description: 'Whether the definition is active (not paused)' })),
  paused: Type.Optional(Type.Boolean({ description: 'When true, pauses the definition (sets isActive=false)' })),
  status: Type.Optional(
    Type.Union([Type.Literal('active'), Type.Literal('paused'), Type.Literal('ACTIVE'), Type.Literal('PAUSED')], {
      description: 'Convenience status alias for pause/resume',
    }),
  ),
});

export type UpdateWorkflowDefinitionInput = Static<typeof UpdateWorkflowDefinitionSchema>;

// ─── Workflow Instance Schemas ───────────────────────────────────────────────

/**
 * Schema for creating a workflow instance linked to an entity.
 */
export const CreateWorkflowInstanceSchema = Type.Object({
  workflowDefinitionId: Type.String({
    pattern: UUID_PATTERN,
    description: 'Workflow definition UUID',
  }),
  entityType: Type.String({ minLength: 1, maxLength: 100, description: 'Entity type (e.g., student_transfer)' }),
  entityId: Type.String({ minLength: 1, maxLength: 255, description: 'Entity ID this workflow instance is linked to' }),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'Additional metadata for the instance' })),
});

export type CreateWorkflowInstanceInput = Static<typeof CreateWorkflowInstanceSchema>;

// ─── Transition Request Schema ───────────────────────────────────────────────

/**
 * Schema for requesting a state transition.
 * Requirement 13.3: record transition with timestamp, actor, and comments
 */
export const TransitionRequestSchema = Type.Object({
  action: Type.String({ minLength: 1, maxLength: 100, description: 'Transition action (e.g., approve, reject)' }),
  actorId: Type.String({ minLength: 1, maxLength: 255, description: 'User performing the transition' }),
  comments: Type.Optional(Type.String({ maxLength: 2000, description: 'Comments for the transition' })),
});

export type TransitionRequestInput = Static<typeof TransitionRequestSchema>;

// ─── ID Parameter Schemas ────────────────────────────────────────────────────

export const WorkflowDefinitionParamsSchema = Type.Object({
  id: Type.String({
    pattern: UUID_PATTERN,
    description: 'Workflow definition UUID',
  }),
});

export type WorkflowDefinitionParams = Static<typeof WorkflowDefinitionParamsSchema>;

export const WorkflowInstanceParamsSchema = Type.Object({
  instanceId: Type.String({
    pattern: UUID_PATTERN,
    description: 'Workflow instance UUID',
  }),
});

export type WorkflowInstanceParams = Static<typeof WorkflowInstanceParamsSchema>;

// ─── Response Schemas ────────────────────────────────────────────────────────

export const TransitionAuditResponseSchema = Type.Object({
  id: Type.String(),
  instanceId: Type.String(),
  fromStateId: Type.String(),
  toStateId: Type.String(),
  action: Type.String(),
  actorId: Type.String(),
  comments: Type.Union([Type.String(), Type.Null()]),
  timestamp: Type.String(),
});

export type TransitionAuditResponse = Static<typeof TransitionAuditResponseSchema>;

export const WorkflowInstanceResponseSchema = Type.Object({
  id: Type.String(),
  workflowDefinitionId: Type.String(),
  entityType: Type.String(),
  entityId: Type.String(),
  currentStateId: Type.String(),
  status: Type.String(),
  metadata: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  approvals: Type.Array(Type.Object({
    stateId: Type.String(),
    actorId: Type.String(),
    action: Type.String(),
    timestamp: Type.String(),
  })),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type WorkflowInstanceResponse = Static<typeof WorkflowInstanceResponseSchema>;

export const WorkflowDefinitionResponseSchema = Type.Object({
  id: Type.String(),
  tenantId: Type.String(),
  name: Type.String(),
  entityType: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  states: Type.Array(WorkflowStateSchema),
  transitions: Type.Array(WorkflowTransitionSchema),
  escalationRules: Type.Union([Type.Array(EscalationRuleSchema), Type.Null()]),
  isActive: Type.Boolean(),
  status: Type.String({ description: 'active | paused' }),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type WorkflowDefinitionResponse = Static<typeof WorkflowDefinitionResponseSchema>;

// ─── List Query Schema ───────────────────────────────────────────────────────

export const WorkflowDefinitionListQuerySchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
  entityType: Type.Optional(Type.String({ description: 'Filter by entity type' })),
});

export type WorkflowDefinitionListQuery = Static<typeof WorkflowDefinitionListQuerySchema>;

export const WorkflowInstanceListQuerySchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
  entityType: Type.Optional(Type.String({ description: 'Filter by entity type' })),
  entityId: Type.Optional(Type.String({ description: 'Filter by entity ID' })),
  status: Type.Optional(Type.Union([Type.Literal('ACTIVE'), Type.Literal('COMPLETED'), Type.Literal('CANCELLED')])),
});

export type WorkflowInstanceListQuery = Static<typeof WorkflowInstanceListQuerySchema>;
