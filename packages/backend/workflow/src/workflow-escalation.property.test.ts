/**
 * Property-Based Test: Workflow Escalation on Timeout (Property 26)
 *
 * **Validates: Requirements 13.6**
 *
 * Tests that the EscalationService correctly handles timeout-based escalation:
 * 1. When a workflow instance remains in a state beyond the configured duration, escalation is triggered
 * 2. After escalation, the instance moves to the escalation target state
 * 3. If the instance has already transitioned away from the state before the timer fires, escalation is skipped
 * 4. Escalation produces an audit record with actor "SYSTEM_ESCALATION"
 *
 * Uses fast-check to generate arbitrary workflow definitions with escalation rules
 * and verify escalation behavior across many configurations.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { WorkflowStateType } from '@proctira/common';

import { WorkflowService } from './workflow-service.js';
import { EscalationService, InMemoryEscalationPublisher } from './escalation-service.js';
import type { EscalationTaskPayload } from './escalation-service.js';
import { InMemoryWorkflowRepository } from './in-memory-repository.js';
import type {
  WorkflowStateInput,
  WorkflowTransitionInput,
  EscalationRuleInput,
} from './schemas.js';

const TENANT_ID = 'tenant-escalation-pbt-001';

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Generates a valid workflow definition with escalation rules.
 * The definition has:
 * - 1 INITIAL state
 * - 1-3 INTERMEDIATE states (at least one with an escalation rule)
 * - 1-2 FINAL states
 * - Transitions connecting states
 * - Escalation rules on at least one intermediate state
 */
function arbWorkflowWithEscalation() {
  return fc
    .record({
      intermediateCount: fc.integer({ min: 1, max: 3 }),
      finalCount: fc.integer({ min: 1, max: 2 }),
      durationMinutes: fc.integer({ min: 1, max: 1440 }),
    })
    .chain(({ intermediateCount, finalCount, durationMinutes }) => {
      const states: WorkflowStateInput[] = [];

      // INITIAL state
      states.push({
        id: 'state-initial',
        name: 'Initial',
        type: WorkflowStateType.INITIAL,
        assigneeType: 'user',
        assigneeId: 'creator',
      });

      // INTERMEDIATE states
      for (let i = 0; i < intermediateCount; i++) {
        states.push({
          id: `state-intermediate-${i}`,
          name: `Intermediate ${i}`,
          type: WorkflowStateType.INTERMEDIATE,
          assigneeType: 'role',
          assigneeId: `role-${i}`,
        });
      }

      // Escalation target state (always an intermediate state)
      states.push({
        id: 'state-escalated',
        name: 'Escalated',
        type: WorkflowStateType.INTERMEDIATE,
        assigneeType: 'role',
        assigneeId: 'escalation-role',
      });

      // FINAL states
      for (let i = 0; i < finalCount; i++) {
        states.push({
          id: `state-final-${i}`,
          name: `Final ${i}`,
          type: WorkflowStateType.FINAL,
          assigneeType: 'role',
          assigneeId: `role-final-${i}`,
        });
      }

      // Build transitions
      const transitions: WorkflowTransitionInput[] = [];
      let tCounter = 0;

      // From initial to first intermediate
      transitions.push({
        id: `t-${tCounter++}`,
        fromStateId: 'state-initial',
        toStateId: 'state-intermediate-0',
        action: 'submit',
      });

      // From each intermediate to the next or to final
      for (let i = 0; i < intermediateCount; i++) {
        // Transition to approve (go to final)
        transitions.push({
          id: `t-${tCounter++}`,
          fromStateId: `state-intermediate-${i}`,
          toStateId: 'state-final-0',
          action: `approve-${i}`,
        });

        // Transition to reject (go to final if multiple finals)
        if (finalCount > 1) {
          transitions.push({
            id: `t-${tCounter++}`,
            fromStateId: `state-intermediate-${i}`,
            toStateId: 'state-final-1',
            action: `reject-${i}`,
          });
        }
      }

      // From escalated state to final
      transitions.push({
        id: `t-${tCounter++}`,
        fromStateId: 'state-escalated',
        toStateId: 'state-final-0',
        action: 'escalated-approve',
      });

      // Escalation rule: first intermediate state escalates to escalated state
      const escalationRules: EscalationRuleInput[] = [
        {
          stateId: 'state-intermediate-0',
          durationMinutes,
          escalateToStateId: 'state-escalated',
          notifyRoleId: 'escalation-role',
        },
      ];

      return fc.constant({
        name: 'PBT Escalation Workflow',
        entityType: 'pbt_escalation_entity',
        states,
        transitions,
        escalationRules,
        durationMinutes,
      });
    });
}

/**
 * Generates a valid workflow definition with escalation on the INITIAL state.
 * Used to test escalation scheduling at instance creation time.
 */
function arbWorkflowWithInitialEscalation() {
  return fc
    .record({
      durationMinutes: fc.integer({ min: 1, max: 1440 }),
    })
    .map(({ durationMinutes }) => {
      const states: WorkflowStateInput[] = [
        {
          id: 'state-initial',
          name: 'New',
          type: WorkflowStateType.INITIAL,
          assigneeType: 'role',
          assigneeId: 'support',
        },
        {
          id: 'state-escalated',
          name: 'Escalated',
          type: WorkflowStateType.INTERMEDIATE,
          assigneeType: 'role',
          assigneeId: 'supervisor',
        },
        {
          id: 'state-resolved',
          name: 'Resolved',
          type: WorkflowStateType.FINAL,
          assigneeType: 'role',
          assigneeId: 'support',
        },
      ];

      const transitions: WorkflowTransitionInput[] = [
        { id: 't-1', fromStateId: 'state-initial', toStateId: 'state-resolved', action: 'resolve' },
        {
          id: 't-2',
          fromStateId: 'state-escalated',
          toStateId: 'state-resolved',
          action: 'resolve',
        },
      ];

      const escalationRules: EscalationRuleInput[] = [
        {
          stateId: 'state-initial',
          durationMinutes,
          escalateToStateId: 'state-escalated',
          notifyRoleId: 'supervisor',
        },
      ];

      return {
        name: 'PBT Initial Escalation Workflow',
        entityType: 'pbt_initial_escalation',
        states,
        transitions,
        escalationRules,
        durationMinutes,
      };
    });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Property 26: Workflow Escalation on Timeout', () => {
  let workflowService: WorkflowService;
  let escalationService: EscalationService;
  let publisher: InMemoryEscalationPublisher;
  let repository: InMemoryWorkflowRepository;

  beforeEach(() => {
    repository = new InMemoryWorkflowRepository();
    publisher = new InMemoryEscalationPublisher();
    escalationService = new EscalationService(repository, publisher);
    workflowService = new WorkflowService(repository);
    workflowService.setEscalationService(escalationService);
  });

  it('escalation is triggered when instance remains in a state beyond the configured duration', async () => {
    await fc.assert(
      fc.asyncProperty(arbWorkflowWithEscalation(), async (defInput) => {
        repository.clear();
        publisher.clear();

        const { durationMinutes, ...definitionInput } = defInput;

        // Create the workflow definition
        const definition = await workflowService.createDefinition(TENANT_ID, definitionInput);

        // Create an instance and transition to the state with escalation rules
        const instance = await workflowService.createInstance(TENANT_ID, {
          workflowDefinitionId: definition.id,
          entityType: defInput.entityType,
          entityId: 'entity-escalation-001',
        });

        publisher.clear(); // Clear any tasks from instance creation

        // Transition to the intermediate state that has escalation rules
        await workflowService.transition(TENANT_ID, instance.id, {
          action: 'submit',
          actorId: 'user-001',
        });

        // Verify escalation task was scheduled
        expect(publisher.publishedTasks.length).toBeGreaterThanOrEqual(1);

        const escalationTask = publisher.publishedTasks.find(
          (t) => t.payload.stateId === 'state-intermediate-0',
        );
        expect(escalationTask).toBeDefined();
        expect(escalationTask!.payload.escalateToStateId).toBe('state-escalated');
        expect(escalationTask!.options.delay).toBe(durationMinutes * 60 * 1000);

        // Simulate the timer firing by processing the escalation
        const result = await escalationService.processEscalation(escalationTask!.payload);

        // Escalation should be triggered (returns true)
        expect(result).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it('after escalation, the instance moves to the escalation target state', async () => {
    await fc.assert(
      fc.asyncProperty(arbWorkflowWithEscalation(), async (defInput) => {
        repository.clear();
        publisher.clear();

        const { durationMinutes, ...definitionInput } = defInput;

        const definition = await workflowService.createDefinition(TENANT_ID, definitionInput);

        const instance = await workflowService.createInstance(TENANT_ID, {
          workflowDefinitionId: definition.id,
          entityType: defInput.entityType,
          entityId: 'entity-target-state-001',
        });

        publisher.clear();

        // Transition to the state with escalation rules
        await workflowService.transition(TENANT_ID, instance.id, {
          action: 'submit',
          actorId: 'user-001',
        });

        // Build the escalation payload (simulating timer fire)
        const payload: EscalationTaskPayload = {
          tenantId: TENANT_ID,
          instanceId: instance.id,
          stateId: 'state-intermediate-0',
          escalateToStateId: 'state-escalated',
          notifyRoleId: 'escalation-role',
          durationMinutes,
          stateEnteredAt: new Date().toISOString(),
        };

        // Process escalation
        await escalationService.processEscalation(payload);

        // Verify instance moved to the escalation target state
        const escalatedInstance = await workflowService.getInstance(TENANT_ID, instance.id);
        expect(escalatedInstance.currentStateId).toBe('state-escalated');
      }),
      { numRuns: 50 },
    );
  });

  it('escalation is skipped if the instance has already transitioned away from the state', async () => {
    await fc.assert(
      fc.asyncProperty(arbWorkflowWithEscalation(), async (defInput) => {
        repository.clear();
        publisher.clear();

        const { durationMinutes, ...definitionInput } = defInput;

        const definition = await workflowService.createDefinition(TENANT_ID, definitionInput);

        const instance = await workflowService.createInstance(TENANT_ID, {
          workflowDefinitionId: definition.id,
          entityType: defInput.entityType,
          entityId: 'entity-already-moved-001',
        });

        publisher.clear();

        // Transition to the state with escalation rules
        await workflowService.transition(TENANT_ID, instance.id, {
          action: 'submit',
          actorId: 'user-001',
        });

        // Now transition AWAY from that state (approve it before escalation fires)
        await workflowService.transition(TENANT_ID, instance.id, {
          action: 'approve-0',
          actorId: 'manager-001',
        });

        // Verify instance is no longer in the escalation source state
        const movedInstance = await workflowService.getInstance(TENANT_ID, instance.id);
        expect(movedInstance.currentStateId).not.toBe('state-intermediate-0');

        // Now simulate the escalation timer firing for the old state
        const payload: EscalationTaskPayload = {
          tenantId: TENANT_ID,
          instanceId: instance.id,
          stateId: 'state-intermediate-0', // Instance is no longer here
          escalateToStateId: 'state-escalated',
          notifyRoleId: 'escalation-role',
          durationMinutes,
          stateEnteredAt: new Date().toISOString(),
        };

        const result = await escalationService.processEscalation(payload);

        // Escalation should be skipped (returns false)
        expect(result).toBe(false);

        // Instance should remain in its current state (not moved to escalated)
        const afterEscalation = await workflowService.getInstance(TENANT_ID, instance.id);
        expect(afterEscalation.currentStateId).toBe(movedInstance.currentStateId);
      }),
      { numRuns: 50 },
    );
  });

  it('escalation produces an audit record with actor "SYSTEM_ESCALATION"', async () => {
    await fc.assert(
      fc.asyncProperty(arbWorkflowWithEscalation(), async (defInput) => {
        repository.clear();
        publisher.clear();

        const { durationMinutes, ...definitionInput } = defInput;

        const definition = await workflowService.createDefinition(TENANT_ID, definitionInput);

        const instance = await workflowService.createInstance(TENANT_ID, {
          workflowDefinitionId: definition.id,
          entityType: defInput.entityType,
          entityId: 'entity-audit-001',
        });

        publisher.clear();

        // Transition to the state with escalation rules
        await workflowService.transition(TENANT_ID, instance.id, {
          action: 'submit',
          actorId: 'user-001',
        });

        // Process escalation
        const payload: EscalationTaskPayload = {
          tenantId: TENANT_ID,
          instanceId: instance.id,
          stateId: 'state-intermediate-0',
          escalateToStateId: 'state-escalated',
          notifyRoleId: 'escalation-role',
          durationMinutes,
          stateEnteredAt: new Date().toISOString(),
        };

        await escalationService.processEscalation(payload);

        // Verify audit record was created with SYSTEM_ESCALATION actor
        const auditHistory = await workflowService.getAuditHistory(TENANT_ID, instance.id);
        const escalationAudit = auditHistory.find((a) => a.action === 'escalate');

        expect(escalationAudit).toBeDefined();
        expect(escalationAudit!.actorId).toBe('SYSTEM_ESCALATION');
        expect(escalationAudit!.fromStateId).toBe('state-intermediate-0');
        expect(escalationAudit!.toStateId).toBe('state-escalated');
        expect(escalationAudit!.comments).toContain(`${durationMinutes} minutes`);
      }),
      { numRuns: 50 },
    );
  });
});
