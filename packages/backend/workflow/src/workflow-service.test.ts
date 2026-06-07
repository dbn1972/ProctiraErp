/**
 * Unit tests for WorkflowService
 *
 * Tests workflow definition CRUD, instance creation, state transitions,
 * transition validation, audit recording, and parallel approval paths.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ValidationError, NotFoundError, BusinessRuleError } from '@proctira/common';

import { WorkflowService } from './workflow-service.js';
import { InMemoryWorkflowRepository } from './in-memory-repository.js';
import type { CreateWorkflowDefinitionInput, CreateWorkflowInstanceInput } from './schemas.js';

const TENANT_ID = 'tenant-001';

function createValidDefinitionInput(overrides?: Partial<CreateWorkflowDefinitionInput>): CreateWorkflowDefinitionInput {
  return {
    name: 'Student Transfer Approval',
    entityType: 'student_transfer',
    description: 'Workflow for approving student transfers',
    states: [
      { id: 'draft', name: 'Draft', type: 'INITIAL', assigneeType: 'user', assigneeId: 'creator' },
      { id: 'pending_review', name: 'Pending Review', type: 'INTERMEDIATE', assigneeType: 'role', assigneeId: 'school_admin' },
      { id: 'approved', name: 'Approved', type: 'FINAL', assigneeType: 'role', assigneeId: 'district_admin' },
      { id: 'rejected', name: 'Rejected', type: 'FINAL', assigneeType: 'role', assigneeId: 'school_admin' },
    ],
    transitions: [
      { id: 't1', fromStateId: 'draft', toStateId: 'pending_review', action: 'submit' },
      { id: 't2', fromStateId: 'pending_review', toStateId: 'approved', action: 'approve' },
      { id: 't3', fromStateId: 'pending_review', toStateId: 'rejected', action: 'reject' },
    ],
    escalationRules: [
      { stateId: 'pending_review', durationMinutes: 1440, escalateToStateId: 'approved', notifyRoleId: 'district_admin' },
    ],
    ...overrides,
  };
}

describe('WorkflowService', () => {
  let service: WorkflowService;
  let repository: InMemoryWorkflowRepository;

  beforeEach(() => {
    repository = new InMemoryWorkflowRepository();
    service = new WorkflowService(repository);
  });

  // ─── Definition CRUD ─────────────────────────────────────────────────────

  describe('createDefinition', () => {
    it('should create a valid workflow definition', async () => {
      const input = createValidDefinitionInput();
      const result = await service.createDefinition(TENANT_ID, input);

      expect(result.id).toBeDefined();
      expect(result.tenantId).toBe(TENANT_ID);
      expect(result.name).toBe(input.name);
      expect(result.entityType).toBe(input.entityType);
      expect(result.states).toHaveLength(4);
      expect(result.transitions).toHaveLength(3);
      expect(result.escalationRules).toHaveLength(1);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should throw ValidationError when no INITIAL state exists', async () => {
      const input = createValidDefinitionInput({
        states: [
          { id: 'pending', name: 'Pending', type: 'INTERMEDIATE', assigneeType: 'role', assigneeId: 'admin' },
          { id: 'done', name: 'Done', type: 'FINAL', assigneeType: 'role', assigneeId: 'admin' },
        ],
        transitions: [
          { id: 't1', fromStateId: 'pending', toStateId: 'done', action: 'complete' },
        ],
      });

      await expect(service.createDefinition(TENANT_ID, input)).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError when multiple INITIAL states exist', async () => {
      const input = createValidDefinitionInput({
        states: [
          { id: 'start1', name: 'Start 1', type: 'INITIAL', assigneeType: 'user', assigneeId: 'u1' },
          { id: 'start2', name: 'Start 2', type: 'INITIAL', assigneeType: 'user', assigneeId: 'u2' },
          { id: 'done', name: 'Done', type: 'FINAL', assigneeType: 'role', assigneeId: 'admin' },
        ],
        transitions: [
          { id: 't1', fromStateId: 'start1', toStateId: 'done', action: 'complete' },
        ],
      });

      await expect(service.createDefinition(TENANT_ID, input)).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError when no FINAL state exists', async () => {
      const input = createValidDefinitionInput({
        states: [
          { id: 'start', name: 'Start', type: 'INITIAL', assigneeType: 'user', assigneeId: 'u1' },
          { id: 'middle', name: 'Middle', type: 'INTERMEDIATE', assigneeType: 'role', assigneeId: 'admin' },
        ],
        transitions: [
          { id: 't1', fromStateId: 'start', toStateId: 'middle', action: 'submit' },
        ],
      });

      await expect(service.createDefinition(TENANT_ID, input)).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError when transition references unknown state', async () => {
      const input = createValidDefinitionInput({
        transitions: [
          { id: 't1', fromStateId: 'draft', toStateId: 'nonexistent', action: 'submit' },
        ],
      });

      await expect(service.createDefinition(TENANT_ID, input)).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError when duplicate state IDs exist', async () => {
      const input = createValidDefinitionInput({
        states: [
          { id: 'same_id', name: 'State 1', type: 'INITIAL', assigneeType: 'user', assigneeId: 'u1' },
          { id: 'same_id', name: 'State 2', type: 'FINAL', assigneeType: 'role', assigneeId: 'admin' },
        ],
        transitions: [
          { id: 't1', fromStateId: 'same_id', toStateId: 'same_id', action: 'complete' },
        ],
      });

      await expect(service.createDefinition(TENANT_ID, input)).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError when escalation rule references unknown state', async () => {
      const input = createValidDefinitionInput({
        escalationRules: [
          { stateId: 'nonexistent', durationMinutes: 60, escalateToStateId: 'approved' },
        ],
      });

      await expect(service.createDefinition(TENANT_ID, input)).rejects.toThrow(ValidationError);
    });
  });

  describe('getDefinition', () => {
    it('should return a definition by ID', async () => {
      const created = await service.createDefinition(TENANT_ID, createValidDefinitionInput());
      const found = await service.getDefinition(TENANT_ID, created.id);

      expect(found.id).toBe(created.id);
      expect(found.name).toBe(created.name);
    });

    it('should throw NotFoundError for non-existent definition', async () => {
      await expect(
        service.getDefinition(TENANT_ID, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow(NotFoundError);
    });

    it('should not return definitions from other tenants', async () => {
      const created = await service.createDefinition('other-tenant', createValidDefinitionInput());

      await expect(service.getDefinition(TENANT_ID, created.id)).rejects.toThrow(NotFoundError);
    });
  });

  describe('updateDefinition', () => {
    it('should update definition name', async () => {
      const created = await service.createDefinition(TENANT_ID, createValidDefinitionInput());
      const updated = await service.updateDefinition(TENANT_ID, created.id, {
        name: 'Updated Workflow Name',
      });

      expect(updated.name).toBe('Updated Workflow Name');
      expect(updated.entityType).toBe(created.entityType);
    });

    it('should validate structure when states are updated', async () => {
      const created = await service.createDefinition(TENANT_ID, createValidDefinitionInput());

      await expect(
        service.updateDefinition(TENANT_ID, created.id, {
          states: [
            { id: 'only_intermediate', name: 'Only', type: 'INTERMEDIATE', assigneeType: 'role', assigneeId: 'admin' },
            { id: 'final', name: 'Final', type: 'FINAL', assigneeType: 'role', assigneeId: 'admin' },
          ],
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should throw NotFoundError for non-existent definition', async () => {
      await expect(
        service.updateDefinition(TENANT_ID, '00000000-0000-4000-8000-000000000000', { name: 'X' }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteDefinition', () => {
    it('should delete an existing definition', async () => {
      const created = await service.createDefinition(TENANT_ID, createValidDefinitionInput());
      await service.deleteDefinition(TENANT_ID, created.id);

      await expect(service.getDefinition(TENANT_ID, created.id)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError for non-existent definition', async () => {
      await expect(
        service.deleteDefinition(TENANT_ID, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('listDefinitions', () => {
    it('should list definitions with pagination', async () => {
      await service.createDefinition(TENANT_ID, createValidDefinitionInput({ name: 'WF 1' }));
      await service.createDefinition(TENANT_ID, createValidDefinitionInput({ name: 'WF 2' }));
      await service.createDefinition(TENANT_ID, createValidDefinitionInput({ name: 'WF 3' }));

      const result = await service.listDefinitions(TENANT_ID, {}, { page: 1, pageSize: 2 });

      expect(result.data).toHaveLength(2);
      expect(result.meta.totalItems).toBe(3);
      expect(result.meta.totalPages).toBe(2);
    });

    it('should filter by entityType', async () => {
      await service.createDefinition(TENANT_ID, createValidDefinitionInput({ entityType: 'student_transfer' }));
      await service.createDefinition(TENANT_ID, createValidDefinitionInput({ entityType: 'staff_leave' }));

      const result = await service.listDefinitions(
        TENANT_ID,
        { entityType: 'staff_leave' },
        { page: 1, pageSize: 20 },
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.entityType).toBe('staff_leave');
    });
  });

  // ─── Instance Operations ─────────────────────────────────────────────────

  describe('createInstance', () => {
    it('should create an instance starting at the INITIAL state', async () => {
      const definition = await service.createDefinition(TENANT_ID, createValidDefinitionInput());

      const instance = await service.createInstance(TENANT_ID, {
        workflowDefinitionId: definition.id,
        entityType: 'student_transfer',
        entityId: 'student-123',
      });

      expect(instance.id).toBeDefined();
      expect(instance.workflowDefinitionId).toBe(definition.id);
      expect(instance.entityType).toBe('student_transfer');
      expect(instance.entityId).toBe('student-123');
      expect(instance.currentStateId).toBe('draft');
      expect(instance.status).toBe('ACTIVE');
      expect(instance.approvals).toEqual([]);
    });

    it('should throw NotFoundError for non-existent workflow definition', async () => {
      await expect(
        service.createInstance(TENANT_ID, {
          workflowDefinitionId: '00000000-0000-4000-8000-000000000000',
          entityType: 'student_transfer',
          entityId: 'student-123',
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ─── Transitions ─────────────────────────────────────────────────────────

  describe('transition', () => {
    it('should transition to the next state when action is valid', async () => {
      const definition = await service.createDefinition(TENANT_ID, createValidDefinitionInput());
      const instance = await service.createInstance(TENANT_ID, {
        workflowDefinitionId: definition.id,
        entityType: 'student_transfer',
        entityId: 'student-123',
      });

      const transitioned = await service.transition(TENANT_ID, instance.id, {
        action: 'submit',
        actorId: 'user-001',
        comments: 'Submitting for review',
      });

      expect(transitioned.currentStateId).toBe('pending_review');
      expect(transitioned.status).toBe('ACTIVE');
    });

    it('should mark instance as COMPLETED when reaching a FINAL state', async () => {
      const definition = await service.createDefinition(TENANT_ID, createValidDefinitionInput());
      const instance = await service.createInstance(TENANT_ID, {
        workflowDefinitionId: definition.id,
        entityType: 'student_transfer',
        entityId: 'student-123',
      });

      // Submit: draft -> pending_review
      await service.transition(TENANT_ID, instance.id, {
        action: 'submit',
        actorId: 'user-001',
      });

      // Approve: pending_review -> approved (FINAL)
      const completed = await service.transition(TENANT_ID, instance.id, {
        action: 'approve',
        actorId: 'admin-001',
        comments: 'Looks good',
      });

      expect(completed.currentStateId).toBe('approved');
      expect(completed.status).toBe('COMPLETED');
    });

    it('should throw BusinessRuleError for invalid transition action', async () => {
      const definition = await service.createDefinition(TENANT_ID, createValidDefinitionInput());
      const instance = await service.createInstance(TENANT_ID, {
        workflowDefinitionId: definition.id,
        entityType: 'student_transfer',
        entityId: 'student-123',
      });

      // 'approve' is not valid from 'draft' state
      await expect(
        service.transition(TENANT_ID, instance.id, {
          action: 'approve',
          actorId: 'user-001',
        }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should throw BusinessRuleError when transitioning a COMPLETED instance', async () => {
      const definition = await service.createDefinition(TENANT_ID, createValidDefinitionInput());
      const instance = await service.createInstance(TENANT_ID, {
        workflowDefinitionId: definition.id,
        entityType: 'student_transfer',
        entityId: 'student-123',
      });

      await service.transition(TENANT_ID, instance.id, { action: 'submit', actorId: 'u1' });
      await service.transition(TENANT_ID, instance.id, { action: 'approve', actorId: 'u2' });

      // Instance is now COMPLETED, further transitions should fail
      await expect(
        service.transition(TENANT_ID, instance.id, { action: 'reject', actorId: 'u3' }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should throw NotFoundError for non-existent instance', async () => {
      await expect(
        service.transition(TENANT_ID, '00000000-0000-4000-8000-000000000000', {
          action: 'submit',
          actorId: 'user-001',
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ─── Parallel Approval Paths (Requirement 13.4) ──────────────────────────

  describe('parallel approval paths', () => {
    function createParallelDefinitionInput(): CreateWorkflowDefinitionInput {
      return {
        name: 'Parallel Approval Workflow',
        entityType: 'staff_leave',
        states: [
          { id: 'submitted', name: 'Submitted', type: 'INITIAL', assigneeType: 'user', assigneeId: 'creator' },
          { id: 'under_review', name: 'Under Review', type: 'INTERMEDIATE', assigneeType: 'role', assigneeId: 'reviewer' },
          { id: 'approved', name: 'Approved', type: 'FINAL', assigneeType: 'role', assigneeId: 'hr' },
        ],
        transitions: [
          { id: 't1', fromStateId: 'submitted', toStateId: 'under_review', action: 'submit' },
          { id: 't2', fromStateId: 'under_review', toStateId: 'approved', action: 'approve', requiredApprovals: 3 },
        ],
      };
    }

    it('should not transition until requiredApprovals is met', async () => {
      const definition = await service.createDefinition(TENANT_ID, createParallelDefinitionInput());
      const instance = await service.createInstance(TENANT_ID, {
        workflowDefinitionId: definition.id,
        entityType: 'staff_leave',
        entityId: 'leave-001',
      });

      // Submit to move to under_review
      await service.transition(TENANT_ID, instance.id, { action: 'submit', actorId: 'user-001' });

      // First approval (1 of 3)
      const after1 = await service.transition(TENANT_ID, instance.id, {
        action: 'approve',
        actorId: 'reviewer-001',
      });
      expect(after1.currentStateId).toBe('under_review'); // Still in review
      expect(after1.status).toBe('ACTIVE');

      // Second approval (2 of 3)
      const after2 = await service.transition(TENANT_ID, instance.id, {
        action: 'approve',
        actorId: 'reviewer-002',
      });
      expect(after2.currentStateId).toBe('under_review'); // Still in review
      expect(after2.status).toBe('ACTIVE');

      // Third approval (3 of 3) - should now transition
      const after3 = await service.transition(TENANT_ID, instance.id, {
        action: 'approve',
        actorId: 'reviewer-003',
      });
      expect(after3.currentStateId).toBe('approved');
      expect(after3.status).toBe('COMPLETED');
    });

    it('should track all approvals in the instance', async () => {
      const definition = await service.createDefinition(TENANT_ID, createParallelDefinitionInput());
      const instance = await service.createInstance(TENANT_ID, {
        workflowDefinitionId: definition.id,
        entityType: 'staff_leave',
        entityId: 'leave-002',
      });

      await service.transition(TENANT_ID, instance.id, { action: 'submit', actorId: 'user-001' });
      await service.transition(TENANT_ID, instance.id, { action: 'approve', actorId: 'r1' });
      const result = await service.transition(TENANT_ID, instance.id, { action: 'approve', actorId: 'r2' });

      // Should have 3 approvals total (submit + 2 approves)
      expect(result.approvals).toHaveLength(3);
      expect(result.approvals[1]!.actorId).toBe('r1');
      expect(result.approvals[2]!.actorId).toBe('r2');
    });
  });

  // ─── Audit History (Requirement 13.3) ────────────────────────────────────

  describe('getAuditHistory', () => {
    it('should record and return transition audit entries', async () => {
      const definition = await service.createDefinition(TENANT_ID, createValidDefinitionInput());
      const instance = await service.createInstance(TENANT_ID, {
        workflowDefinitionId: definition.id,
        entityType: 'student_transfer',
        entityId: 'student-456',
      });

      await service.transition(TENANT_ID, instance.id, {
        action: 'submit',
        actorId: 'user-001',
        comments: 'Please review',
      });

      await service.transition(TENANT_ID, instance.id, {
        action: 'approve',
        actorId: 'admin-001',
        comments: 'Approved',
      });

      const history = await service.getAuditHistory(TENANT_ID, instance.id);

      expect(history).toHaveLength(2);

      // First transition: draft -> pending_review
      expect(history[0]!.fromStateId).toBe('draft');
      expect(history[0]!.toStateId).toBe('pending_review');
      expect(history[0]!.action).toBe('submit');
      expect(history[0]!.actorId).toBe('user-001');
      expect(history[0]!.comments).toBe('Please review');
      expect(history[0]!.timestamp).toBeInstanceOf(Date);

      // Second transition: pending_review -> approved
      expect(history[1]!.fromStateId).toBe('pending_review');
      expect(history[1]!.toStateId).toBe('approved');
      expect(history[1]!.action).toBe('approve');
      expect(history[1]!.actorId).toBe('admin-001');
      expect(history[1]!.comments).toBe('Approved');
    });

    it('should throw NotFoundError for non-existent instance', async () => {
      await expect(
        service.getAuditHistory(TENANT_ID, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
