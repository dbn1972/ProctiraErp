/**
 * PRC-M457 / NEW-g7_platform-010 / PRC-M463: workflow transitions must be atomic.
 * Two concurrent transitions reading the same instance must not both win — the
 * optimistic guard rejects the loser with a 409 instead of recording a lost update
 * or a double transition past a required-approval gate.
 */
import { ConflictError } from '@proctira/common';
import { describe, it, expect, beforeEach } from 'vitest';

import { InMemoryWorkflowRepository } from './in-memory-repository.js';
import type {
  InstanceUpdateGuard,
  WorkflowInstanceEntity,
  WorkflowRepository,
} from './workflow-repository.js';
import { WorkflowService } from './workflow-service.js';
import type { CreateWorkflowDefinitionInput } from './schemas.js';

const TENANT_ID = 'tenant-conc';

function twoApproverDefinition(): CreateWorkflowDefinitionInput {
  return {
    name: 'Two-approver gate',
    entityType: 'change_request',
    description: 'Requires two approvals to advance',
    states: [
      { id: 'draft', name: 'Draft', type: 'INITIAL', assigneeType: 'role', assigneeId: 'any' },
      {
        id: 'review',
        name: 'Review',
        type: 'INTERMEDIATE',
        assigneeType: 'role',
        assigneeId: 'approver',
      },
      { id: 'done', name: 'Done', type: 'FINAL', assigneeType: 'role', assigneeId: 'approver' },
    ],
    transitions: [
      { id: 't1', fromStateId: 'draft', toStateId: 'review', action: 'submit' },
      {
        id: 't2',
        fromStateId: 'review',
        toStateId: 'done',
        action: 'approve',
        requiredApprovals: 2,
      },
    ],
    escalationRules: [],
  };
}

/**
 * Repository decorator that lets a test hold the FIRST updateInstance call open
 * until a second transition has read the (now stale) instance, forcing a real
 * read-modify-write interleaving.
 */
class PausableRepository implements WorkflowRepository {
  private release: (() => void) | null = null;
  private paused: Promise<void> | null = null;
  private armed = false;

  constructor(private readonly delegate: InMemoryWorkflowRepository) {}

  arm(): void {
    this.armed = true;
    this.paused = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  async waitUntilPaused(): Promise<void> {
    // Yield so the pending update reaches its await point.
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  }

  releasePause(): void {
    this.release?.();
  }

  async updateInstance(
    id: string,
    tenantId: string,
    data: Partial<WorkflowInstanceEntity>,
    expected?: InstanceUpdateGuard,
  ): Promise<WorkflowInstanceEntity | null> {
    if (this.armed) {
      this.armed = false;
      await this.paused;
    }
    return this.delegate.updateInstance(id, tenantId, data, expected);
  }

  // ─── pass-throughs ───
  createDefinition: WorkflowRepository['createDefinition'] = (e) =>
    this.delegate.createDefinition(e);
  findDefinitionById: WorkflowRepository['findDefinitionById'] = (id, t) =>
    this.delegate.findDefinitionById(id, t);
  updateDefinition: WorkflowRepository['updateDefinition'] = (id, t, d) =>
    this.delegate.updateDefinition(id, t, d);
  deleteDefinition: WorkflowRepository['deleteDefinition'] = (id, t) =>
    this.delegate.deleteDefinition(id, t);
  listDefinitions: WorkflowRepository['listDefinitions'] = (t, f, p) =>
    this.delegate.listDefinitions(t, f, p);
  createInstance: WorkflowRepository['createInstance'] = (e) => this.delegate.createInstance(e);
  findInstanceById: WorkflowRepository['findInstanceById'] = (id, t) =>
    this.delegate.findInstanceById(id, t);
  listInstances: WorkflowRepository['listInstances'] = (t, f, p) =>
    this.delegate.listInstances(t, f, p);
  createAuditRecord: WorkflowRepository['createAuditRecord'] = (e) =>
    this.delegate.createAuditRecord(e);
  getAuditHistory: WorkflowRepository['getAuditHistory'] = (id, t) =>
    this.delegate.getAuditHistory(id, t);
}

describe('workflow transition concurrency (PRC-M457 / NEW-g7_platform-010)', () => {
  let inner: InMemoryWorkflowRepository;
  let repo: PausableRepository;
  let service: WorkflowService;

  beforeEach(() => {
    inner = new InMemoryWorkflowRepository();
    repo = new PausableRepository(inner);
    service = new WorkflowService(repo);
  });

  it('repository guard rejects a stale conditional update', async () => {
    const def = await inner.createDefinition({
      id: 'd1',
      tenantId: TENANT_ID,
      name: 'x',
      entityType: 'e',
      description: null,
      states: [],
      transitions: [],
      escalationRules: null,
    });
    const instance = await inner.createInstance({
      id: 'i1',
      tenantId: TENANT_ID,
      workflowDefinitionId: def.id,
      entityType: 'e',
      entityId: 'x',
      currentStateId: 'review',
      status: 'ACTIVE',
      metadata: null,
      approvals: [],
    });

    // First update advances the state (guard matches).
    const first = await inner.updateInstance(
      instance.id,
      TENANT_ID,
      { currentStateId: 'done' },
      { currentStateId: 'review', approvalCount: 0 },
    );
    expect(first).not.toBeNull();

    // Second update using the STALE guard (still expects 'review') must fail.
    const second = await inner.updateInstance(
      instance.id,
      TENANT_ID,
      { currentStateId: 'rejected' },
      { currentStateId: 'review', approvalCount: 0 },
    );
    expect(second).toBeNull();
  });

  it('two concurrent transitions do not both advance a two-approval gate', async () => {
    const def = await service.createDefinition(TENANT_ID, twoApproverDefinition());
    const instance = await service.createInstance(TENANT_ID, {
      workflowDefinitionId: def.id,
      entityType: 'change_request',
      entityId: 'cr-1',
    });
    await service.transition(TENANT_ID, instance.id, { action: 'submit', actorId: 'u0' });

    // Arm the pause so the first approve holds its update open.
    repo.arm();
    const firstApprove = service.transition(TENANT_ID, instance.id, {
      action: 'approve',
      actorId: 'approver-1',
    });
    await repo.waitUntilPaused();

    // Second approver reads the same (pre-first-write) instance, then we release.
    const secondApprove = service.transition(TENANT_ID, instance.id, {
      action: 'approve',
      actorId: 'approver-2',
    });
    await repo.waitUntilPaused();
    repo.releasePause();

    const results = await Promise.allSettled([firstApprove, secondApprove]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one wins; the other is rejected with a conflict (fail closed).
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);

    // The instance recorded exactly one approval FOR THE REVIEW STATE and did NOT
    // reach 'done' (the submit transition also leaves one draft-stage approval).
    const final = await inner.findInstanceById(instance.id, TENANT_ID);
    const reviewApprovals = (final?.approvals ?? []).filter(
      (a) => a.stateId === 'review' && a.action === 'approve',
    );
    expect(reviewApprovals).toHaveLength(1);
    expect(final?.currentStateId).toBe('review');
  });
});
