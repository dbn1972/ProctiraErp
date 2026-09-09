/**
 * G-924 — `/workflows/*` UI aggregates served by the real workflow engine.
 *
 * Until now the redesign UI kept its own definitions/instances/approvals store
 * (`workflow-ui-pg-store.ts`) next to `@proctira/backend-workflow` under
 * `/workflow-engine`, so an approval in one never touched the other. This
 * adapter implements the UI store contract on top of the engine's repository +
 * service: UI "steps" are a linear chain of engine states joined by `approve`
 * transitions (every step can also `reject` to a FINAL `rejected` state), UI
 * instances are engine instances, and a UI "pending approval" is an ACTIVE
 * engine instance whose next action is decided through the engine's audited
 * `transition()`.
 */
import type {
  WorkflowDefinitionEntity,
  WorkflowInstanceEntity,
  WorkflowRepository,
  WorkflowService,
  WorkflowStateInput,
  WorkflowTransitionInput,
} from '@proctira/backend-workflow';
import { WorkflowStateType } from '@proctira/common';

import { shouldSeedDemoData } from './demo-seed-policy.js';
import type { WorkflowUiStore } from './workflow-ui-pg-store.js';
import {
  createWorkflowUiSeed,
  type UiWorkflowApproval,
  type UiWorkflowDefinition,
  type UiWorkflowInstance,
  type UiWorkflowStep,
} from './workflow-ui-seed.js';

export const APPROVED_STATE_ID = 'approved';
export const REJECTED_STATE_ID = 'rejected';
const APPROVE = 'approve';
const REJECT = 'reject';
const PAGE = { page: 1, pageSize: 200 } as const;

/** Linear approval chain → engine states + transitions. */
export function stepsToEngine(steps: UiWorkflowStep[]): {
  states: WorkflowStateInput[];
  transitions: WorkflowTransitionInput[];
} {
  const ordered = [...steps].sort((a, b) => a.order - b.order);
  const states: WorkflowStateInput[] = ordered.map((step, index) => ({
    id: step.id,
    name: step.name,
    type: index === 0 ? WorkflowStateType.INITIAL : WorkflowStateType.INTERMEDIATE,
    assigneeType: 'role',
    assigneeId: step.approverRole,
  }));
  states.push(
    {
      id: APPROVED_STATE_ID,
      name: 'Approved',
      type: WorkflowStateType.FINAL,
      assigneeType: 'role',
      assigneeId: 'system',
    },
    {
      id: REJECTED_STATE_ID,
      name: 'Rejected',
      type: WorkflowStateType.FINAL,
      assigneeType: 'role',
      assigneeId: 'system',
    },
  );
  const transitions: WorkflowTransitionInput[] = [];
  ordered.forEach((step, index) => {
    const next = ordered[index + 1];
    transitions.push({
      id: `${step.id}-${APPROVE}`,
      fromStateId: step.id,
      toStateId: next ? next.id : APPROVED_STATE_ID,
      action: APPROVE,
    });
    transitions.push({
      id: `${step.id}-${REJECT}`,
      fromStateId: step.id,
      toStateId: REJECTED_STATE_ID,
      action: REJECT,
    });
  });
  return { states, transitions };
}

/** Engine states → UI steps by following `approve` transitions from the INITIAL state. */
export function engineToSteps(definition: WorkflowDefinitionEntity): UiWorkflowStep[] {
  const byId = new Map(definition.states.map((s) => [s.id, s]));
  const approveFrom = new Map(
    definition.transitions
      .filter((t) => t.action === APPROVE)
      .map((t) => [t.fromStateId, t.toStateId]),
  );
  const steps: UiWorkflowStep[] = [];
  const seen = new Set<string>();
  let current = definition.states.find((s) => s.type === WorkflowStateType.INITIAL)?.id;
  while (current && !seen.has(current)) {
    const state = byId.get(current);
    if (!state || state.type === WorkflowStateType.FINAL) break;
    seen.add(current);
    steps.push({
      id: state.id,
      order: steps.length + 1,
      name: state.name,
      approverRole: state.assigneeId,
    });
    current = approveFrom.get(current);
  }
  if (steps.length === 0) {
    // Non-linear definitions authored directly on the engine: expose every
    // non-final state so the UI still lists them.
    definition.states
      .filter((s) => s.type !== WorkflowStateType.FINAL)
      .forEach((s, i) =>
        steps.push({ id: s.id, order: i + 1, name: s.name, approverRole: s.assigneeId }),
      );
  }
  return steps;
}

export function toUiDefinition(definition: WorkflowDefinitionEntity): UiWorkflowDefinition {
  return {
    id: definition.id,
    tenantId: definition.tenantId,
    name: definition.name,
    module: definition.entityType,
    version: 1,
    steps: engineToSteps(definition),
    active: true,
    updatedAt: definition.updatedAt.toISOString(),
  };
}

function uiStatus(instance: WorkflowInstanceEntity): UiWorkflowInstance['status'] {
  if (instance.status === 'CANCELLED') return 'CANCELLED';
  if (instance.status === 'ACTIVE') return 'PENDING';
  return instance.currentStateId === REJECTED_STATE_ID ||
    instance.approvals.at(-1)?.action === REJECT
    ? 'REJECTED'
    : 'APPROVED';
}

function stateName(definition: WorkflowDefinitionEntity | undefined, stateId: string): string {
  return definition?.states.find((s) => s.id === stateId)?.name ?? stateId;
}

function meta(instance: WorkflowInstanceEntity, key: string): string | undefined {
  const value = instance.metadata?.[key];
  return typeof value === 'string' ? value : undefined;
}

export function toUiInstance(
  instance: WorkflowInstanceEntity,
  definition: WorkflowDefinitionEntity | undefined,
): UiWorkflowInstance {
  return {
    id: instance.id,
    tenantId: instance.tenantId,
    definitionId: instance.workflowDefinitionId,
    definitionName: definition?.name ?? instance.workflowDefinitionId,
    subjectType: instance.entityType,
    subjectId: instance.entityId,
    initiatedBy: meta(instance, 'initiatedBy') ?? 'system',
    initiatedAt: instance.createdAt.toISOString(),
    currentStep:
      instance.status === 'ACTIVE' ? stateName(definition, instance.currentStateId) : 'Completed',
    status: uiStatus(instance),
  };
}

export function toUiApproval(
  instance: WorkflowInstanceEntity,
  definition: WorkflowDefinitionEntity | undefined,
): UiWorkflowApproval {
  const last = instance.approvals.at(-1);
  return {
    // One pending decision per active instance: the approval id is the instance id.
    id: instance.id,
    tenantId: instance.tenantId,
    instanceId: instance.id,
    definitionName: definition?.name ?? instance.workflowDefinitionId,
    subjectType: instance.entityType,
    subjectId: instance.entityId,
    stepName: stateName(definition, instance.currentStateId),
    requestedAt: (last?.timestamp ?? instance.updatedAt).toISOString(),
    requestedBy: last?.actorId ?? meta(instance, 'initiatedBy') ?? 'system',
  };
}

export class EngineBackedWorkflowUiStore implements WorkflowUiStore {
  private seeded = false;

  constructor(
    private readonly repository: WorkflowRepository,
    private readonly service: WorkflowService,
    readonly persistence: 'postgres' | 'memory',
  ) {}

  private async definitionsFor(tenantId: string): Promise<Map<string, WorkflowDefinitionEntity>> {
    await this.ensureSeed();
    const result = await this.repository.listDefinitions(tenantId, {}, PAGE);
    return new Map(result.data.map((d) => [d.id, d]));
  }

  async listDefinitions(tenantId: string): Promise<UiWorkflowDefinition[]> {
    const defs = await this.definitionsFor(tenantId);
    return [...defs.values()]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(toUiDefinition);
  }

  async getDefinition(tenantId: string, id: string): Promise<UiWorkflowDefinition | null> {
    await this.ensureSeed();
    const definition = await this.repository.findDefinitionById(id, tenantId);
    return definition ? toUiDefinition(definition) : null;
  }

  async createDefinition(definition: UiWorkflowDefinition): Promise<UiWorkflowDefinition> {
    const { states, transitions } = stepsToEngine(definition.steps);
    const created = await this.service.createDefinition(definition.tenantId, {
      name: definition.name,
      entityType: definition.module,
      description: `Approval chain (${definition.steps.length} step${definition.steps.length === 1 ? '' : 's'})`,
      states,
      transitions,
    });
    return toUiDefinition(created);
  }

  async listInstances(tenantId: string): Promise<UiWorkflowInstance[]> {
    const defs = await this.definitionsFor(tenantId);
    const result = await this.repository.listInstances(tenantId, {}, PAGE);
    return result.data
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((i) => toUiInstance(i, defs.get(i.workflowDefinitionId)));
  }

  async listPendingApprovals(tenantId: string): Promise<UiWorkflowApproval[]> {
    const defs = await this.definitionsFor(tenantId);
    const result = await this.repository.listInstances(tenantId, { status: 'ACTIVE' }, PAGE);
    return result.data.map((i) => toUiApproval(i, defs.get(i.workflowDefinitionId)));
  }

  async decideApproval(
    tenantId: string,
    approvalId: string,
    decision: 'APPROVED' | 'REJECTED',
    actorId = 'workflow-ui',
  ): Promise<{ id: string; instanceId: string; status: 'APPROVED' | 'REJECTED' } | null> {
    await this.ensureSeed();
    const instance = await this.repository.findInstanceById(approvalId, tenantId);
    if (!instance || instance.status !== 'ACTIVE') return null;
    await this.service.transition(tenantId, approvalId, {
      action: decision === 'APPROVED' ? APPROVE : REJECT,
      actorId,
    });
    return { id: approvalId, instanceId: approvalId, status: decision };
  }

  /**
   * Demo rows for the E2E/demo tenant (same fixed ids the specs probe), written
   * through the engine repository so they are ordinary engine definitions.
   * Never in production (`shouldSeedDemoData`).
   */
  private async ensureSeed(): Promise<void> {
    if (this.seeded) return;
    this.seeded = true;
    if (!shouldSeedDemoData()) return;
    const seed = createWorkflowUiSeed();
    for (const def of seed.definitions) {
      if (await this.repository.findDefinitionById(def.id, def.tenantId)) continue;
      const { states, transitions } = stepsToEngine(def.steps);
      await this.repository.createDefinition({
        id: def.id,
        tenantId: def.tenantId,
        name: def.name,
        entityType: def.module,
        description: 'Demo approval chain',
        states,
        transitions,
        escalationRules: null,
      });
    }
    for (const inst of seed.instances) {
      if (await this.repository.findInstanceById(inst.id, inst.tenantId)) continue;
      const def = seed.definitions.find((d) => d.id === inst.definitionId);
      if (!def) continue;
      const steps = [...def.steps].sort((a, b) => a.order - b.order);
      const currentStep = steps.find((s) => s.name === inst.currentStep);
      const active = inst.status === 'PENDING';
      const currentStateId = active
        ? (currentStep?.id ?? steps[0]!.id)
        : inst.status === 'REJECTED'
          ? REJECTED_STATE_ID
          : APPROVED_STATE_ID;
      // Earlier steps were approved on the way to the current one.
      const approvals = steps
        .slice(
          0,
          active
            ? Math.max(
                0,
                steps.findIndex((s) => s.id === currentStateId),
              )
            : steps.length,
        )
        .map((s, i) => ({
          stateId: s.id,
          actorId: inst.initiatedBy,
          action: APPROVE,
          timestamp: new Date(new Date(inst.initiatedAt).getTime() + (i + 1) * 3_600_000),
        }));
      await this.repository.createInstance({
        id: inst.id,
        tenantId: inst.tenantId,
        workflowDefinitionId: inst.definitionId,
        entityType: inst.subjectType,
        entityId: inst.subjectId,
        currentStateId,
        status: active ? 'ACTIVE' : 'COMPLETED',
        metadata: { initiatedBy: inst.initiatedBy, initiatedAt: inst.initiatedAt },
        approvals,
      });
    }
  }
}
