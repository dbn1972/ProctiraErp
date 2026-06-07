/**
 * Unit tests for EscalationService
 *
 * Tests escalation scheduling, processing, and notification.
 *
 * Requirements: 13.6
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { EscalationService, InMemoryEscalationPublisher } from './escalation-service.js';
import type { EscalationTaskPayload } from './escalation-service.js';
import { InMemoryWorkflowRepository } from './in-memory-repository.js';
import { WorkflowService } from './workflow-service.js';
import type { CreateWorkflowDefinitionInput } from './schemas.js';

const TENANT_ID = 'tenant-escalation-001';

function createDefinitionWithEscalation(): CreateWorkflowDefinitionInput {
  return {
    name: 'Approval with Escalation',
    entityType: 'leave_request',
    states: [
      { id: 'submitted', name: 'Submitted', type: 'INITIAL', assigneeType: 'user', assigneeId: 'creator' },
      { id: 'pending_approval', name: 'Pending Approval', type: 'INTERMEDIATE', assigneeType: 'role', assigneeId: 'manager' },
      { id: 'escalated_review', name: 'Escalated Review', type: 'INTERMEDIATE', assigneeType: 'role', assigneeId: 'director' },
      { id: 'approved', name: 'Approved', type: 'FINAL', assigneeType: 'role', assigneeId: 'manager' },
      { id: 'rejected', name: 'Rejected', type: 'FINAL', assigneeType: 'role', assigneeId: 'manager' },
    ],
    transitions: [
      { id: 't1', fromStateId: 'submitted', toStateId: 'pending_approval', action: 'submit' },
      { id: 't2', fromStateId: 'pending_approval', toStateId: 'approved', action: 'approve' },
      { id: 't3', fromStateId: 'pending_approval', toStateId: 'rejected', action: 'reject' },
      { id: 't4', fromStateId: 'escalated_review', toStateId: 'approved', action: 'approve' },
      { id: 't5', fromStateId: 'escalated_review', toStateId: 'rejected', action: 'reject' },
    ],
    escalationRules: [
      {
        stateId: 'pending_approval',
        durationMinutes: 60,
        escalateToStateId: 'escalated_review',
        notifyRoleId: 'director',
      },
    ],
  };
}

describe('EscalationService', () => {
  let escalationService: EscalationService;
  let publisher: InMemoryEscalationPublisher;
  let repository: InMemoryWorkflowRepository;
  let workflowService: WorkflowService;

  beforeEach(() => {
    repository = new InMemoryWorkflowRepository();
    publisher = new InMemoryEscalationPublisher();
    escalationService = new EscalationService(repository, publisher);
    workflowService = new WorkflowService(repository);
    workflowService.setEscalationService(escalationService);
  });

  describe('scheduleEscalation', () => {
    it('should publish a delayed escalation task when state has escalation rules', async () => {
      const definition = await workflowService.createDefinition(TENANT_ID, createDefinitionWithEscalation());

      await escalationService.scheduleEscalation(
        TENANT_ID,
        'instance-001',
        'pending_approval',
        definition.id,
      );

      expect(publisher.publishedTasks).toHaveLength(1);
      const task = publisher.publishedTasks[0]!;
      expect(task.tenantId).toBe(TENANT_ID);
      expect(task.type).toBe('workflow.escalation');
      expect(task.payload.instanceId).toBe('instance-001');
      expect(task.payload.stateId).toBe('pending_approval');
      expect(task.payload.escalateToStateId).toBe('escalated_review');
      expect(task.payload.notifyRoleId).toBe('director');
      expect(task.payload.durationMinutes).toBe(60);
      expect(task.options.delay).toBe(60 * 60 * 1000); // 60 minutes in ms
    });

    it('should not publish tasks when state has no escalation rules', async () => {
      const definition = await workflowService.createDefinition(TENANT_ID, createDefinitionWithEscalation());

      await escalationService.scheduleEscalation(
        TENANT_ID,
        'instance-001',
        'submitted', // No escalation rule for this state
        definition.id,
      );

      expect(publisher.publishedTasks).toHaveLength(0);
    });

    it('should not publish tasks when definition has no escalation rules', async () => {
      const input = createDefinitionWithEscalation();
      input.escalationRules = undefined;
      const definition = await workflowService.createDefinition(TENANT_ID, input);

      await escalationService.scheduleEscalation(
        TENANT_ID,
        'instance-001',
        'pending_approval',
        definition.id,
      );

      expect(publisher.publishedTasks).toHaveLength(0);
    });

    it('should not publish tasks when definition does not exist', async () => {
      await escalationService.scheduleEscalation(
        TENANT_ID,
        'instance-001',
        'pending_approval',
        'non-existent-def',
      );

      expect(publisher.publishedTasks).toHaveLength(0);
    });
  });

  describe('processEscalation', () => {
    it('should escalate instance when still in expected state', async () => {
      const definition = await workflowService.createDefinition(TENANT_ID, createDefinitionWithEscalation());

      // Create instance and transition to pending_approval
      const instance = await workflowService.createInstance(TENANT_ID, {
        workflowDefinitionId: definition.id,
        entityType: 'leave_request',
        entityId: 'leave-001',
      });

      // Transition to pending_approval
      const transitioned = await workflowService.transition(TENANT_ID, instance.id, {
        action: 'submit',
        actorId: 'user-001',
      });

      expect(transitioned.currentStateId).toBe('pending_approval');

      // Process escalation
      const payload: EscalationTaskPayload = {
        tenantId: TENANT_ID,
        instanceId: instance.id,
        stateId: 'pending_approval',
        escalateToStateId: 'escalated_review',
        notifyRoleId: 'director',
        durationMinutes: 60,
        stateEnteredAt: new Date().toISOString(),
      };

      const result = await escalationService.processEscalation(payload);

      expect(result).toBe(true);

      // Verify instance was escalated
      const escalated = await workflowService.getInstance(TENANT_ID, instance.id);
      expect(escalated.currentStateId).toBe('escalated_review');

      // Verify notification was published
      expect(publisher.publishedNotifications).toHaveLength(1);
      const notification = publisher.publishedNotifications[0]!;
      expect(notification.tenantId).toBe(TENANT_ID);
      expect(notification.instanceId).toBe(instance.id);
      expect(notification.fromStateId).toBe('pending_approval');
      expect(notification.toStateId).toBe('escalated_review');
      expect(notification.notifyRoleId).toBe('director');
    });

    it('should skip escalation when instance has already moved to a different state', async () => {
      const definition = await workflowService.createDefinition(TENANT_ID, createDefinitionWithEscalation());

      const instance = await workflowService.createInstance(TENANT_ID, {
        workflowDefinitionId: definition.id,
        entityType: 'leave_request',
        entityId: 'leave-002',
      });

      // Transition to pending_approval then approve (moves to final state)
      await workflowService.transition(TENANT_ID, instance.id, {
        action: 'submit',
        actorId: 'user-001',
      });
      await workflowService.transition(TENANT_ID, instance.id, {
        action: 'approve',
        actorId: 'manager-001',
      });

      // Try to process escalation for the old state
      const payload: EscalationTaskPayload = {
        tenantId: TENANT_ID,
        instanceId: instance.id,
        stateId: 'pending_approval', // Instance is no longer in this state
        escalateToStateId: 'escalated_review',
        notifyRoleId: 'director',
        durationMinutes: 60,
        stateEnteredAt: new Date().toISOString(),
      };

      const result = await escalationService.processEscalation(payload);

      expect(result).toBe(false);
      expect(publisher.publishedNotifications).toHaveLength(0);
    });

    it('should skip escalation when instance does not exist', async () => {
      const payload: EscalationTaskPayload = {
        tenantId: TENANT_ID,
        instanceId: 'non-existent-instance',
        stateId: 'pending_approval',
        escalateToStateId: 'escalated_review',
        notifyRoleId: 'director',
        durationMinutes: 60,
        stateEnteredAt: new Date().toISOString(),
      };

      const result = await escalationService.processEscalation(payload);

      expect(result).toBe(false);
    });

    it('should skip escalation when instance is completed', async () => {
      const definition = await workflowService.createDefinition(TENANT_ID, createDefinitionWithEscalation());

      const instance = await workflowService.createInstance(TENANT_ID, {
        workflowDefinitionId: definition.id,
        entityType: 'leave_request',
        entityId: 'leave-003',
      });

      // Complete the workflow
      await workflowService.transition(TENANT_ID, instance.id, {
        action: 'submit',
        actorId: 'user-001',
      });
      await workflowService.transition(TENANT_ID, instance.id, {
        action: 'approve',
        actorId: 'manager-001',
      });

      const payload: EscalationTaskPayload = {
        tenantId: TENANT_ID,
        instanceId: instance.id,
        stateId: 'approved', // Instance is in final state
        escalateToStateId: 'escalated_review',
        notifyRoleId: 'director',
        durationMinutes: 60,
        stateEnteredAt: new Date().toISOString(),
      };

      const result = await escalationService.processEscalation(payload);

      expect(result).toBe(false);
    });

    it('should record audit entry when escalation occurs', async () => {
      const definition = await workflowService.createDefinition(TENANT_ID, createDefinitionWithEscalation());

      const instance = await workflowService.createInstance(TENANT_ID, {
        workflowDefinitionId: definition.id,
        entityType: 'leave_request',
        entityId: 'leave-004',
      });

      await workflowService.transition(TENANT_ID, instance.id, {
        action: 'submit',
        actorId: 'user-001',
      });

      const payload: EscalationTaskPayload = {
        tenantId: TENANT_ID,
        instanceId: instance.id,
        stateId: 'pending_approval',
        escalateToStateId: 'escalated_review',
        notifyRoleId: 'director',
        durationMinutes: 60,
        stateEnteredAt: new Date().toISOString(),
      };

      await escalationService.processEscalation(payload);

      // Check audit history
      const audit = await workflowService.getAuditHistory(TENANT_ID, instance.id);
      const escalationAudit = audit.find((a) => a.action === 'escalate');
      expect(escalationAudit).toBeDefined();
      expect(escalationAudit!.actorId).toBe('SYSTEM_ESCALATION');
      expect(escalationAudit!.fromStateId).toBe('pending_approval');
      expect(escalationAudit!.toStateId).toBe('escalated_review');
      expect(escalationAudit!.comments).toContain('60 minutes');
    });
  });

  describe('getEscalationRulesForState', () => {
    it('should return escalation rules for a specific state', async () => {
      const definition = await workflowService.createDefinition(TENANT_ID, createDefinitionWithEscalation());

      const rules = await escalationService.getEscalationRulesForState(
        TENANT_ID,
        definition.id,
        'pending_approval',
      );

      expect(rules).toHaveLength(1);
      expect(rules[0]!.durationMinutes).toBe(60);
      expect(rules[0]!.escalateToStateId).toBe('escalated_review');
    });

    it('should return empty array for state without escalation rules', async () => {
      const definition = await workflowService.createDefinition(TENANT_ID, createDefinitionWithEscalation());

      const rules = await escalationService.getEscalationRulesForState(
        TENANT_ID,
        definition.id,
        'submitted',
      );

      expect(rules).toHaveLength(0);
    });
  });

  describe('integration with WorkflowService', () => {
    it('should schedule escalation when instance is created at initial state with rules', async () => {
      // Create definition with escalation on initial state
      const input: CreateWorkflowDefinitionInput = {
        name: 'Auto-escalate Workflow',
        entityType: 'complaint',
        states: [
          { id: 'new', name: 'New', type: 'INITIAL', assigneeType: 'role', assigneeId: 'support' },
          { id: 'escalated', name: 'Escalated', type: 'INTERMEDIATE', assigneeType: 'role', assigneeId: 'supervisor' },
          { id: 'resolved', name: 'Resolved', type: 'FINAL', assigneeType: 'role', assigneeId: 'support' },
        ],
        transitions: [
          { id: 't1', fromStateId: 'new', toStateId: 'resolved', action: 'resolve' },
          { id: 't2', fromStateId: 'escalated', toStateId: 'resolved', action: 'resolve' },
        ],
        escalationRules: [
          { stateId: 'new', durationMinutes: 30, escalateToStateId: 'escalated', notifyRoleId: 'supervisor' },
        ],
      };

      const definition = await workflowService.createDefinition(TENANT_ID, input);

      publisher.clear();

      await workflowService.createInstance(TENANT_ID, {
        workflowDefinitionId: definition.id,
        entityType: 'complaint',
        entityId: 'complaint-001',
      });

      // Escalation should be scheduled for the initial state
      expect(publisher.publishedTasks).toHaveLength(1);
      expect(publisher.publishedTasks[0]!.payload.stateId).toBe('new');
      expect(publisher.publishedTasks[0]!.options.delay).toBe(30 * 60 * 1000);
    });

    it('should schedule escalation when instance transitions to a state with rules', async () => {
      const definition = await workflowService.createDefinition(TENANT_ID, createDefinitionWithEscalation());

      const instance = await workflowService.createInstance(TENANT_ID, {
        workflowDefinitionId: definition.id,
        entityType: 'leave_request',
        entityId: 'leave-005',
      });

      publisher.clear();

      // Transition to pending_approval (which has escalation rules)
      await workflowService.transition(TENANT_ID, instance.id, {
        action: 'submit',
        actorId: 'user-001',
      });

      // Escalation should be scheduled for pending_approval
      expect(publisher.publishedTasks).toHaveLength(1);
      expect(publisher.publishedTasks[0]!.payload.stateId).toBe('pending_approval');
      expect(publisher.publishedTasks[0]!.payload.escalateToStateId).toBe('escalated_review');
    });
  });
});
