/**
 * Workflow Service
 *
 * Business logic for the Workflow Engine.
 *
 * Requirements:
 * - 13.1: Multi-step approval workflows with configurable states, transitions, and assignee rules
 * - 13.2: Assigning workflow steps to roles/users based on Area_Hierarchy and institution context
 * - 13.3: Record transitions with timestamp, actor, and comments
 * - 13.4: Parallel and sequential approval paths with configurable escalation rules
 * - 13.6: Timeout-based escalation to next level with notification
 */
import {
  NotFoundError,
  BusinessRuleError,
  ValidationError,
  WorkflowStateType,
} from '@proctira/common';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  WorkflowRepository,
  WorkflowDefinitionEntity,
  WorkflowDefinitionFilter,
  WorkflowInstanceEntity,
  WorkflowInstanceFilter,
  WorkflowInstanceStatus,
  TransitionAuditEntity,
} from './workflow-repository.js';
import type {
  CreateWorkflowDefinitionInput,
  UpdateWorkflowDefinitionInput,
  CreateWorkflowInstanceInput,
  TransitionRequestInput,
  WorkflowStateInput,
  WorkflowTransitionInput,
} from './schemas.js';
import type { EscalationService } from './escalation-service.js';

/**
 * Service handling workflow engine business logic.
 */
export class WorkflowService {
  private escalationService: EscalationService | null = null;

  constructor(private readonly repository: WorkflowRepository) {}

  /**
   * Set the escalation service for scheduling escalation timers.
   * Optional — if not set, escalation scheduling is skipped.
   */
  setEscalationService(escalationService: EscalationService): void {
    this.escalationService = escalationService;
  }

  // ─── Workflow Definition CRUD ────────────────────────────────────────────

  /**
   * Create a new workflow definition.
   *
   * Validates:
   * - Exactly one INITIAL state exists
   * - At least one FINAL state exists
   * - All transition fromStateId/toStateId reference valid state IDs
   * - Escalation rules reference valid state IDs
   *
   * @throws ValidationError if definition structure is invalid
   */
  async createDefinition(
    tenantId: string,
    input: CreateWorkflowDefinitionInput,
  ): Promise<WorkflowDefinitionEntity> {
    this.validateDefinitionStructure(input.states, input.transitions, input.escalationRules ?? []);

    const definition: Omit<WorkflowDefinitionEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      entityType: input.entityType,
      description: input.description ?? null,
      states: input.states,
      transitions: input.transitions,
      escalationRules: input.escalationRules ?? null,
      isActive: true,
    };

    return this.repository.createDefinition(definition);
  }

  /**
   * Get a workflow definition by ID.
   *
   * @throws NotFoundError if definition not found
   */
  async getDefinition(tenantId: string, id: string): Promise<WorkflowDefinitionEntity> {
    const definition = await this.repository.findDefinitionById(id, tenantId);
    if (!definition) {
      throw new NotFoundError(`Workflow definition with id '${id}' not found`);
    }
    return definition;
  }

  /**
   * Update a workflow definition.
   *
   * @throws NotFoundError if definition not found
   * @throws ValidationError if updated structure is invalid
   */
  async updateDefinition(
    tenantId: string,
    id: string,
    input: UpdateWorkflowDefinitionInput,
  ): Promise<WorkflowDefinitionEntity> {
    const existing = await this.repository.findDefinitionById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Workflow definition with id '${id}' not found`);
    }

    // If states or transitions are being updated, validate the new structure
    const newStates = input.states ?? existing.states;
    const newTransitions = input.transitions ?? existing.transitions;
    const newEscalationRules = input.escalationRules ?? existing.escalationRules ?? [];

    if (input.states || input.transitions || input.escalationRules) {
      this.validateDefinitionStructure(newStates, newTransitions, newEscalationRules);
    }

    const updateData: Partial<WorkflowDefinitionEntity> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.states !== undefined) updateData.states = input.states;
    if (input.transitions !== undefined) updateData.transitions = input.transitions;
    if (input.escalationRules !== undefined) updateData.escalationRules = input.escalationRules;

    const resolvedActive = resolveIsActive(input);
    if (resolvedActive !== undefined) {
      updateData.isActive = resolvedActive;
    }

    const updated = await this.repository.updateDefinition(id, tenantId, updateData);
    if (!updated) {
      throw new NotFoundError(`Workflow definition with id '${id}' not found`);
    }

    return updated;
  }

  /**
   * Delete a workflow definition.
   *
   * @throws NotFoundError if definition not found
   */
  async deleteDefinition(tenantId: string, id: string): Promise<void> {
    const deleted = await this.repository.deleteDefinition(id, tenantId);
    if (!deleted) {
      throw new NotFoundError(`Workflow definition with id '${id}' not found`);
    }
  }

  /**
   * List workflow definitions with pagination and filtering.
   */
  async listDefinitions(
    tenantId: string,
    filter: WorkflowDefinitionFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<WorkflowDefinitionEntity>> {
    return this.repository.listDefinitions(tenantId, filter, pagination);
  }

  // ─── Workflow Instance Operations ────────────────────────────────────────

  /**
   * Create a workflow instance linked to an entity.
   *
   * The instance starts at the INITIAL state of the workflow definition.
   *
   * @throws NotFoundError if workflow definition not found
   * @throws ValidationError if definition has no INITIAL state
   */
  async createInstance(
    tenantId: string,
    input: CreateWorkflowInstanceInput,
  ): Promise<WorkflowInstanceEntity> {
    const definition = await this.repository.findDefinitionById(input.workflowDefinitionId, tenantId);
    if (!definition) {
      throw new NotFoundError(
        `Workflow definition with id '${input.workflowDefinitionId}' not found`,
      );
    }

    if (!definition.isActive) {
      throw new BusinessRuleError(
        'Cannot create instances for a paused workflow definition. Resume the definition first.',
      );
    }

    // Find the initial state
    const initialState = definition.states.find((s) => s.type === WorkflowStateType.INITIAL);
    if (!initialState) {
      throw new ValidationError('Workflow definition has no INITIAL state');
    }

    const instance: Omit<WorkflowInstanceEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      workflowDefinitionId: input.workflowDefinitionId,
      entityType: input.entityType,
      entityId: input.entityId,
      currentStateId: initialState.id,
      status: 'ACTIVE',
      metadata: input.metadata ?? null,
      approvals: [],
    };

    const created = await this.repository.createInstance(instance);

    // Schedule escalation if escalation rules exist for the initial state (Requirement 13.6)
    if (this.escalationService) {
      await this.escalationService.scheduleEscalation(
        tenantId,
        created.id,
        initialState.id,
        input.workflowDefinitionId,
      );
    }

    return created;
  }

  /**
   * Get a workflow instance by ID.
   *
   * @throws NotFoundError if instance not found
   */
  async getInstance(tenantId: string, instanceId: string): Promise<WorkflowInstanceEntity> {
    const instance = await this.repository.findInstanceById(instanceId, tenantId);
    if (!instance) {
      throw new NotFoundError(`Workflow instance with id '${instanceId}' not found`);
    }
    return instance;
  }

  /**
   * Perform a state transition on a workflow instance.
   *
   * Validates:
   * - Instance exists and is ACTIVE
   * - The requested transition is defined in the workflow definition
   * - The transition originates from the current state
   * - For parallel paths: tracks approvals and only transitions when requiredApprovals is met
   *
   * Records an audit entry for the transition (Requirement 13.3).
   *
   * @throws NotFoundError if instance or definition not found
   * @throws BusinessRuleError if transition is not allowed or instance is not active
   */
  async transition(
    tenantId: string,
    instanceId: string,
    input: TransitionRequestInput,
  ): Promise<WorkflowInstanceEntity> {
    const instance = await this.repository.findInstanceById(instanceId, tenantId);
    if (!instance) {
      throw new NotFoundError(`Workflow instance with id '${instanceId}' not found`);
    }

    if (instance.status !== 'ACTIVE') {
      throw new BusinessRuleError(
        `Cannot transition instance in '${instance.status}' status. Only ACTIVE instances can be transitioned.`,
      );
    }

    // Get the workflow definition to validate the transition
    const definition = await this.repository.findDefinitionById(
      instance.workflowDefinitionId,
      tenantId,
    );
    if (!definition) {
      throw new NotFoundError(
        `Workflow definition with id '${instance.workflowDefinitionId}' not found`,
      );
    }

    // Find the matching transition
    const validTransition = definition.transitions.find(
      (t) => t.fromStateId === instance.currentStateId && t.action === input.action,
    );

    if (!validTransition) {
      throw new BusinessRuleError(
        `Transition '${input.action}' is not allowed from state '${instance.currentStateId}'`,
      );
    }

    // Handle parallel approval paths (Requirement 13.4)
    const requiredApprovals = validTransition.requiredApprovals ?? 1;

    // Record this approval
    const newApproval = {
      stateId: instance.currentStateId,
      actorId: input.actorId,
      action: input.action,
      timestamp: new Date(),
    };

    const updatedApprovals = [...instance.approvals, newApproval];

    // Count approvals for this specific state+action combination
    const approvalsForTransition = updatedApprovals.filter(
      (a) => a.stateId === instance.currentStateId && a.action === input.action,
    );

    let newStateId = instance.currentStateId;
    let newStatus: WorkflowInstanceStatus = 'ACTIVE';

    // Only transition if we have enough approvals
    if (approvalsForTransition.length >= requiredApprovals) {
      newStateId = validTransition.toStateId;

      // Check if the new state is a FINAL state
      const targetState = definition.states.find((s) => s.id === newStateId);
      if (targetState && targetState.type === WorkflowStateType.FINAL) {
        newStatus = 'COMPLETED';
      }
    }

    // Record the audit entry (Requirement 13.3)
    const auditRecord: TransitionAuditEntity = {
      id: uuidv4(),
      tenantId,
      instanceId,
      fromStateId: instance.currentStateId,
      toStateId: newStateId,
      action: input.action,
      actorId: input.actorId,
      comments: input.comments ?? null,
      timestamp: new Date(),
    };

    await this.repository.createAuditRecord(auditRecord);

    // Update the instance
    const updated = await this.repository.updateInstance(instanceId, tenantId, {
      currentStateId: newStateId,
      status: newStatus,
      approvals: updatedApprovals,
    });

    if (!updated) {
      throw new NotFoundError(`Workflow instance with id '${instanceId}' not found`);
    }

    // Schedule escalation for the new state if it changed (Requirement 13.6)
    if (this.escalationService && newStateId !== instance.currentStateId) {
      await this.escalationService.scheduleEscalation(
        tenantId,
        instanceId,
        newStateId,
        instance.workflowDefinitionId,
      );
    }

    return updated;
  }

  /**
   * Get the transition audit history for a workflow instance.
   *
   * @throws NotFoundError if instance not found
   */
  async getAuditHistory(tenantId: string, instanceId: string): Promise<TransitionAuditEntity[]> {
    const instance = await this.repository.findInstanceById(instanceId, tenantId);
    if (!instance) {
      throw new NotFoundError(`Workflow instance with id '${instanceId}' not found`);
    }

    return this.repository.getAuditHistory(instanceId, tenantId);
  }

  /**
   * List workflow instances with pagination and filtering.
   */
  async listInstances(
    tenantId: string,
    filter: WorkflowInstanceFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<WorkflowInstanceEntity>> {
    return this.repository.listInstances(tenantId, filter, pagination);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Validates the structural integrity of a workflow definition.
   *
   * Ensures:
   * - Exactly one INITIAL state
   * - At least one FINAL state
   * - All transition references point to valid states
   * - Escalation rules reference valid states
   * - No duplicate state IDs
   */
  private validateDefinitionStructure(
    states: WorkflowStateInput[],
    transitions: WorkflowTransitionInput[],
    escalationRules: { stateId: string; escalateToStateId: string; durationMinutes: number; notifyRoleId?: string }[],
  ): void {
    const stateIds = new Set(states.map((s) => s.id));

    // Check for duplicate state IDs
    if (stateIds.size !== states.length) {
      throw new ValidationError('Duplicate state IDs found in workflow definition');
    }

    // Validate exactly one INITIAL state
    const initialStates = states.filter((s) => s.type === WorkflowStateType.INITIAL);
    if (initialStates.length === 0) {
      throw new ValidationError('Workflow definition must have exactly one INITIAL state');
    }
    if (initialStates.length > 1) {
      throw new ValidationError('Workflow definition must have exactly one INITIAL state, found multiple');
    }

    // Validate at least one FINAL state
    const finalStates = states.filter((s) => s.type === WorkflowStateType.FINAL);
    if (finalStates.length === 0) {
      throw new ValidationError('Workflow definition must have at least one FINAL state');
    }

    // Validate transition references
    for (const transition of transitions) {
      if (!stateIds.has(transition.fromStateId)) {
        throw new ValidationError(
          `Transition '${transition.id}' references unknown fromStateId '${transition.fromStateId}'`,
        );
      }
      if (!stateIds.has(transition.toStateId)) {
        throw new ValidationError(
          `Transition '${transition.id}' references unknown toStateId '${transition.toStateId}'`,
        );
      }
    }

    // Validate escalation rule references
    for (const rule of escalationRules) {
      if (!stateIds.has(rule.stateId)) {
        throw new ValidationError(
          `Escalation rule references unknown stateId '${rule.stateId}'`,
        );
      }
      if (!stateIds.has(rule.escalateToStateId)) {
        throw new ValidationError(
          `Escalation rule references unknown escalateToStateId '${rule.escalateToStateId}'`,
        );
      }
    }
  }
}

/**
 * Resolve isActive from optional pause/resume fields on an update payload.
 * Priority: explicit `isActive` > `paused` > `status`.
 */
function resolveIsActive(input: UpdateWorkflowDefinitionInput): boolean | undefined {
  if (input.isActive !== undefined) return input.isActive;
  if (input.paused !== undefined) return !input.paused;
  if (input.status !== undefined) {
    const normalized = input.status.toLowerCase();
    if (normalized === 'paused') return false;
    if (normalized === 'active') return true;
  }
  return undefined;
}
