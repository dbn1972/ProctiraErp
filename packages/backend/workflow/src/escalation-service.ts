/**
 * Workflow Escalation Service
 *
 * Implements configurable timeout-based escalation via RabbitMQ delayed messages.
 * When a workflow instance remains in a state beyond the configured duration,
 * the service escalates to the next level and notifies the escalation target.
 *
 * Requirements:
 * - 13.6: IF a workflow item remains in a state beyond a configurable duration,
 *         THEN THE Workflow_Engine SHALL escalate to the next level and notify the escalation target
 */
import { v4 as uuidv4 } from 'uuid';
import type { TaskMessage } from '@proctira/events';

import type {
  WorkflowRepository,
  WorkflowInstanceEntity,
  WorkflowDefinitionEntity,
  TransitionAuditEntity,
} from './workflow-repository.js';
import type { EscalationRuleInput } from './schemas.js';

// ─── Escalation Types ────────────────────────────────────────────────────────

/**
 * Payload for an escalation delayed message published to RabbitMQ.
 */
export interface EscalationTaskPayload {
  tenantId: string;
  instanceId: string;
  stateId: string;
  escalateToStateId: string;
  notifyRoleId: string | undefined;
  durationMinutes: number;
  /** Timestamp when the instance entered the current state */
  stateEnteredAt: string;
}

/**
 * Notification payload emitted when escalation occurs.
 */
export interface EscalationNotification {
  tenantId: string;
  instanceId: string;
  entityType: string;
  entityId: string;
  fromStateId: string;
  toStateId: string;
  notifyRoleId: string | undefined;
  escalatedAt: string;
  durationMinutes: number;
}

/**
 * Interface for publishing delayed escalation tasks to RabbitMQ.
 */
export interface EscalationPublisher {
  /**
   * Publish a delayed escalation task.
   * The task will be delivered after the specified delay.
   */
  publishEscalationTask(task: TaskMessage<EscalationTaskPayload>): Promise<void>;

  /**
   * Publish an escalation notification event.
   */
  publishEscalationNotification(notification: EscalationNotification): Promise<void>;
}

/**
 * In-memory escalation publisher for testing.
 */
export class InMemoryEscalationPublisher implements EscalationPublisher {
  public publishedTasks: TaskMessage<EscalationTaskPayload>[] = [];
  public publishedNotifications: EscalationNotification[] = [];

  async publishEscalationTask(task: TaskMessage<EscalationTaskPayload>): Promise<void> {
    this.publishedTasks.push(task);
  }

  async publishEscalationNotification(notification: EscalationNotification): Promise<void> {
    this.publishedNotifications.push(notification);
  }

  clear(): void {
    this.publishedTasks = [];
    this.publishedNotifications = [];
  }
}

// ─── Escalation Service ──────────────────────────────────────────────────────

/**
 * Service handling workflow escalation logic.
 *
 * Responsibilities:
 * - Schedule escalation timers when instances enter states with escalation rules
 * - Process escalation when timer fires (validate state hasn't changed)
 * - Transition instance to escalation target state
 * - Notify escalation target role
 */
export class EscalationService {
  constructor(
    private readonly repository: WorkflowRepository,
    private readonly publisher: EscalationPublisher,
  ) {}

  /**
   * Schedule escalation for a workflow instance based on its current state.
   *
   * Looks up escalation rules for the current state in the workflow definition
   * and publishes a delayed message to RabbitMQ that will fire after the
   * configured duration.
   *
   * Called when:
   * - A new instance is created (enters initial state)
   * - An instance transitions to a new state
   */
  async scheduleEscalation(
    tenantId: string,
    instanceId: string,
    currentStateId: string,
    definitionId: string,
  ): Promise<void> {
    const definition = await this.repository.findDefinitionById(definitionId, tenantId);
    if (!definition || !definition.escalationRules) {
      return;
    }

    // Find escalation rules for the current state
    const rules = definition.escalationRules.filter((rule) => rule.stateId === currentStateId);

    if (rules.length === 0) {
      return;
    }

    // Schedule a delayed message for each applicable rule
    for (const rule of rules) {
      const delayMs = rule.durationMinutes * 60 * 1000;

      const task: TaskMessage<EscalationTaskPayload> = {
        id: uuidv4(),
        tenantId,
        type: 'workflow.escalation',
        payload: {
          tenantId,
          instanceId,
          stateId: currentStateId,
          escalateToStateId: rule.escalateToStateId,
          notifyRoleId: rule.notifyRoleId,
          durationMinutes: rule.durationMinutes,
          stateEnteredAt: new Date().toISOString(),
        },
        options: {
          priority: 5,
          delay: delayMs,
          maxRetries: 3,
          retryCount: 0,
        },
      };

      await this.publisher.publishEscalationTask(task);
    }
  }

  /**
   * Process an escalation task when the delayed message fires.
   *
   * Validates that the instance is still in the expected state (hasn't been
   * transitioned manually). If still in the same state, performs the escalation
   * transition and notifies the target.
   *
   * @returns true if escalation was performed, false if skipped (state already changed)
   */
  async processEscalation(payload: EscalationTaskPayload): Promise<boolean> {
    const { tenantId, instanceId, stateId, escalateToStateId, notifyRoleId, durationMinutes } =
      payload;

    // Fetch the current instance state
    const instance = await this.repository.findInstanceById(instanceId, tenantId);
    if (!instance) {
      // Instance no longer exists, skip
      return false;
    }

    // Check if instance is still in the expected state
    if (instance.currentStateId !== stateId) {
      // Instance has already moved to a different state, skip escalation
      return false;
    }

    // Check if instance is still active
    if (instance.status !== 'ACTIVE') {
      // Instance is completed or cancelled, skip
      return false;
    }

    // Perform the escalation transition
    const auditRecord: TransitionAuditEntity = {
      id: uuidv4(),
      tenantId,
      instanceId,
      fromStateId: stateId,
      toStateId: escalateToStateId,
      action: 'escalate',
      actorId: 'SYSTEM_ESCALATION',
      comments: `Automatically escalated after ${durationMinutes} minutes in state '${stateId}'`,
      timestamp: new Date(),
    };

    await this.repository.createAuditRecord(auditRecord);

    // Update instance to the escalation target state
    await this.repository.updateInstance(instanceId, tenantId, {
      currentStateId: escalateToStateId,
    });

    // Publish escalation notification
    const notification: EscalationNotification = {
      tenantId,
      instanceId,
      entityType: instance.entityType,
      entityId: instance.entityId,
      fromStateId: stateId,
      toStateId: escalateToStateId,
      notifyRoleId,
      escalatedAt: new Date().toISOString(),
      durationMinutes,
    };

    await this.publisher.publishEscalationNotification(notification);

    return true;
  }

  /**
   * Get escalation rules for a workflow definition's current state.
   * Useful for checking what escalation rules apply to a given state.
   */
  async getEscalationRulesForState(
    tenantId: string,
    definitionId: string,
    stateId: string,
  ): Promise<EscalationRuleInput[]> {
    const definition = await this.repository.findDefinitionById(definitionId, tenantId);
    if (!definition || !definition.escalationRules) {
      return [];
    }

    return definition.escalationRules.filter((rule) => rule.stateId === stateId);
  }
}
