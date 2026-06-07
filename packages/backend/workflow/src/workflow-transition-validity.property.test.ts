/**
 * Property-Based Test: Workflow Transition Validity (Property 25)
 *
 * **Validates: Requirements 13.1**
 *
 * Tests that the WorkflowService correctly enforces transition rules:
 * 1. Only transitions defined in the workflow definition are allowed from the current state
 * 2. Attempting an undefined transition from the current state is always rejected
 * 3. Transitions from a FINAL state are always rejected (instance is COMPLETED)
 * 4. The instance's current state is always updated to the transition's target state after a valid transition
 *
 * Uses fast-check to generate arbitrary workflow definitions and transition attempts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { BusinessRuleError, WorkflowStateType } from '@proctira/common';

import { WorkflowService } from './workflow-service.js';
import { InMemoryWorkflowRepository } from './in-memory-repository.js';
import type { WorkflowStateInput, WorkflowTransitionInput } from './schemas.js';

const TENANT_ID = 'tenant-pbt-001';

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Generates a valid workflow definition with at least one INITIAL state,
 * one FINAL state, and well-formed transitions between them.
 */
function arbWorkflowDefinition() {
  return fc
    .record({
      intermediateCount: fc.integer({ min: 0, max: 4 }),
      finalCount: fc.integer({ min: 1, max: 3 }),
      transitionsPerState: fc.integer({ min: 1, max: 3 }),
    })
    .chain(({ intermediateCount, finalCount, transitionsPerState }) => {
      // Build states: 1 INITIAL + N INTERMEDIATE + M FINAL
      const states: WorkflowStateInput[] = [];

      states.push({
        id: 'state-initial',
        name: 'Initial',
        type: WorkflowStateType.INITIAL,
        assigneeType: 'user',
        assigneeId: 'creator',
      });

      for (let i = 0; i < intermediateCount; i++) {
        states.push({
          id: `state-intermediate-${i}`,
          name: `Intermediate ${i}`,
          type: WorkflowStateType.INTERMEDIATE,
          assigneeType: 'role',
          assigneeId: `role-${i}`,
        });
      }

      for (let i = 0; i < finalCount; i++) {
        states.push({
          id: `state-final-${i}`,
          name: `Final ${i}`,
          type: WorkflowStateType.FINAL,
          assigneeType: 'role',
          assigneeId: `role-final-${i}`,
        });
      }

      // Build transitions: from each non-final state, create transitions to other states
      const nonFinalStates = states.filter((s) => s.type !== WorkflowStateType.FINAL);
      const transitions: WorkflowTransitionInput[] = [];
      let transitionCounter = 0;

      for (const fromState of nonFinalStates) {
        // Possible targets: all states except the fromState itself
        const possibleTargets = states.filter((s) => s.id !== fromState.id);
        const numTransitions = Math.min(transitionsPerState, possibleTargets.length);

        for (let i = 0; i < numTransitions; i++) {
          const target = possibleTargets[i]!;
          transitions.push({
            id: `t-${transitionCounter}`,
            fromStateId: fromState.id,
            toStateId: target.id,
            action: `action-${transitionCounter}`,
          });
          transitionCounter++;
        }
      }

      return fc.constant({
        name: 'PBT Workflow',
        entityType: 'pbt_entity',
        states,
        transitions,
      });
    });
}

/**
 * Generates an action string that is NOT in the set of valid actions for a given state.
 */
function arbInvalidAction(validActions: string[]) {
  return fc
    .string({ minLength: 1, maxLength: 50 })
    .filter((action) => !validActions.includes(action) && action.trim().length > 0);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Property 25: Workflow Transition Validity', () => {
  let service: WorkflowService;
  let repository: InMemoryWorkflowRepository;

  beforeEach(() => {
    repository = new InMemoryWorkflowRepository();
    service = new WorkflowService(repository);
  });

  it('only defined transitions are allowed from the current state', async () => {
    await fc.assert(
      fc.asyncProperty(arbWorkflowDefinition(), async (defInput) => {
        repository.clear();

        // Create the workflow definition
        const definition = await service.createDefinition(TENANT_ID, defInput);

        // Create an instance (starts at INITIAL state)
        const instance = await service.createInstance(TENANT_ID, {
          workflowDefinitionId: definition.id,
          entityType: 'pbt_entity',
          entityId: 'entity-001',
        });

        // Find valid transitions from the initial state
        const validTransitions = defInput.transitions.filter(
          (t) => t.fromStateId === instance.currentStateId,
        );

        // Each valid transition should succeed
        for (const validTransition of validTransitions) {
          // Create a fresh instance for each test to avoid state changes
          const freshInstance = await service.createInstance(TENANT_ID, {
            workflowDefinitionId: definition.id,
            entityType: 'pbt_entity',
            entityId: `entity-valid-${validTransition.id}`,
          });

          const result = await service.transition(TENANT_ID, freshInstance.id, {
            action: validTransition.action,
            actorId: 'actor-001',
          });

          // The transition should succeed (no error thrown)
          expect(result).toBeDefined();
          expect(result.currentStateId).toBe(validTransition.toStateId);
        }
      }),
      { numRuns: 50 },
    );
  });

  it('attempting an undefined transition from the current state is always rejected', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbWorkflowDefinition(),
        fc.string({ minLength: 1, maxLength: 30 }),
        async (defInput, randomSuffix) => {
          repository.clear();

          const definition = await service.createDefinition(TENANT_ID, defInput);

          const instance = await service.createInstance(TENANT_ID, {
            workflowDefinitionId: definition.id,
            entityType: 'pbt_entity',
            entityId: 'entity-invalid-001',
          });

          // Get valid actions from the current state
          const validActions = defInput.transitions
            .filter((t) => t.fromStateId === instance.currentStateId)
            .map((t) => t.action);

          // Generate an action that is definitely not valid
          const invalidAction = `invalid-action-${randomSuffix}-${Date.now()}`;

          // Skip if by some chance the generated action matches a valid one
          if (validActions.includes(invalidAction)) {
            return;
          }

          // Attempting an undefined transition should throw BusinessRuleError
          await expect(
            service.transition(TENANT_ID, instance.id, {
              action: invalidAction,
              actorId: 'actor-001',
            }),
          ).rejects.toThrow(BusinessRuleError);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('transitions from a FINAL state are always rejected (instance is COMPLETED)', async () => {
    await fc.assert(
      fc.asyncProperty(arbWorkflowDefinition(), async (defInput) => {
        repository.clear();

        const definition = await service.createDefinition(TENANT_ID, defInput);

        // Find a path from INITIAL to a FINAL state
        const initialStateId = defInput.states.find(
          (s) => s.type === WorkflowStateType.INITIAL,
        )!.id;
        const finalStateIds = new Set(
          defInput.states.filter((s) => s.type === WorkflowStateType.FINAL).map((s) => s.id),
        );

        // BFS to find a path to a FINAL state
        const path = findPathToFinal(initialStateId, finalStateIds, defInput.transitions);

        // If no path exists to a final state, skip this test case
        if (!path || path.length === 0) {
          return;
        }

        // Create instance and walk it to the FINAL state
        const instance = await service.createInstance(TENANT_ID, {
          workflowDefinitionId: definition.id,
          entityType: 'pbt_entity',
          entityId: 'entity-final-001',
        });

        for (const action of path) {
          await service.transition(TENANT_ID, instance.id, {
            action,
            actorId: 'actor-001',
          });
        }

        // Verify instance is now COMPLETED
        const completedInstance = await service.getInstance(TENANT_ID, instance.id);
        expect(completedInstance.status).toBe('COMPLETED');

        // Any transition attempt should now be rejected
        const anyAction = defInput.transitions[0]?.action ?? 'some-action';
        await expect(
          service.transition(TENANT_ID, instance.id, {
            action: anyAction,
            actorId: 'actor-001',
          }),
        ).rejects.toThrow(BusinessRuleError);
      }),
      { numRuns: 50 },
    );
  });

  it("instance's current state is updated to the transition's target state after a valid transition", async () => {
    await fc.assert(
      fc.asyncProperty(arbWorkflowDefinition(), async (defInput) => {
        repository.clear();

        const definition = await service.createDefinition(TENANT_ID, defInput);

        const instance = await service.createInstance(TENANT_ID, {
          workflowDefinitionId: definition.id,
          entityType: 'pbt_entity',
          entityId: 'entity-state-update-001',
        });

        // Find a valid transition from the initial state
        const validTransition = defInput.transitions.find(
          (t) => t.fromStateId === instance.currentStateId,
        );

        // If there's no transition from initial state, skip
        if (!validTransition) {
          return;
        }

        // Perform the transition
        const result = await service.transition(TENANT_ID, instance.id, {
          action: validTransition.action,
          actorId: 'actor-001',
        });

        // Verify the current state was updated to the target state
        expect(result.currentStateId).toBe(validTransition.toStateId);

        // Also verify by re-fetching the instance
        const refetched = await service.getInstance(TENANT_ID, instance.id);
        expect(refetched.currentStateId).toBe(validTransition.toStateId);
      }),
      { numRuns: 50 },
    );
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * BFS to find a sequence of actions that leads from the initial state to any final state.
 */
function findPathToFinal(
  initialStateId: string,
  finalStateIds: Set<string>,
  transitions: WorkflowTransitionInput[],
): string[] | null {
  const queue: Array<{ stateId: string; actions: string[] }> = [
    { stateId: initialStateId, actions: [] },
  ];
  const visited = new Set<string>();
  visited.add(initialStateId);

  while (queue.length > 0) {
    const current = queue.shift()!;

    // Find all transitions from the current state
    const outgoing = transitions.filter((t) => t.fromStateId === current.stateId);

    for (const t of outgoing) {
      const newPath = [...current.actions, t.action];

      if (finalStateIds.has(t.toStateId)) {
        return newPath;
      }

      if (!visited.has(t.toStateId)) {
        visited.add(t.toStateId);
        queue.push({ stateId: t.toStateId, actions: newPath });
      }
    }
  }

  return null;
}
