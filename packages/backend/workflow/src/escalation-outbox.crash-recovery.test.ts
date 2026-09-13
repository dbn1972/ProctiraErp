/**
 * W2-JOB-03: workflow escalation schedules use transactional outbox.
 *
 * Tip verification (CONFIRMED dual-write without outbox):
 *   workflow-service.ts createInstance / transition → scheduleEscalation →
 *   QueueEscalationPublisher.queue.dispatch. Crash after DB commit leaves an
 *   active instance with no delayed message and no recovery.
 *
 * Fix: OutboxEscalationPublisher enqueues buildWorkflowEscalationOutboxEntry;
 *   OutboxRelay recovers post-commit publish loss.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
  InMemoryOutboxStore,
  OutboxRelay,
  WORKFLOW_ESCALATION_JOB_TYPE,
  buildTenantName,
} from '@proctira/queue-abstraction';

import { EscalationService } from './escalation-service.js';
import { OutboxEscalationPublisher } from './outbox-escalation-publisher.js';
import { QueueEscalationPublisher } from './queue-escalation-publisher.js';
import { InMemoryWorkflowRepository } from './in-memory-repository.js';
import { WorkflowService } from './workflow-service.js';
import type { CreateWorkflowDefinitionInput } from './schemas.js';

const TENANT_ID = 'tenant-esc-outbox';

function createDefinitionWithEscalation(): CreateWorkflowDefinitionInput {
  return {
    name: 'Escalation outbox',
    entityType: 'leave_request',
    states: [
      {
        id: 'submitted',
        name: 'Submitted',
        type: 'INITIAL',
        assigneeType: 'user',
        assigneeId: 'creator',
      },
      {
        id: 'pending_approval',
        name: 'Pending Approval',
        type: 'INTERMEDIATE',
        assigneeType: 'role',
        assigneeId: 'manager',
      },
      {
        id: 'escalated_review',
        name: 'Escalated Review',
        type: 'INTERMEDIATE',
        assigneeType: 'role',
        assigneeId: 'director',
      },
      {
        id: 'approved',
        name: 'Approved',
        type: 'FINAL',
        assigneeType: 'role',
        assigneeId: 'manager',
      },
    ],
    transitions: [
      { id: 't1', fromStateId: 'submitted', toStateId: 'pending_approval', action: 'submit' },
      { id: 't2', fromStateId: 'pending_approval', toStateId: 'approved', action: 'approve' },
      { id: 't3', fromStateId: 'escalated_review', toStateId: 'approved', action: 'approve' },
    ],
    escalationRules: [
      {
        stateId: 'pending_approval',
        durationMinutes: 1,
        escalateToStateId: 'escalated_review',
        notifyRoleId: 'director',
      },
    ],
  };
}

describe('W2-JOB-03 workflow escalation outbox cutover', () => {
  let repository: InMemoryWorkflowRepository;
  let durableStore: InMemoryDurableQueueStore;
  let queue: InMemoryDurableQueueAdapter;
  let outbox: InMemoryOutboxStore;

  beforeEach(async () => {
    repository = new InMemoryWorkflowRepository();
    durableStore = new InMemoryDurableQueueStore();
    queue = new InMemoryDurableQueueAdapter({ store: durableStore, pollIntervalMs: 5 });
    await queue.connect();
    outbox = new InMemoryOutboxStore();
  });

  it('CONFIRMED tip dual-write: transition then publish leaves orphan state on crash', async () => {
    const crashingQueue = {
      async dispatch(): Promise<void> {
        throw new Error('broker unavailable after instance commit');
      },
      async publish(): Promise<void> {
        throw new Error('broker unavailable');
      },
      async connect(): Promise<void> {},
      async disconnect(): Promise<void> {},
      isConnected(): boolean {
        return true;
      },
      async subscribe(): Promise<() => Promise<void>> {
        return async () => {};
      },
      async consume(): Promise<() => Promise<void>> {
        return async () => {};
      },
      async healthCheck() {
        return { healthy: true, latencyMs: 0 };
      },
    };

    const publisher = new QueueEscalationPublisher(crashingQueue as never);
    const escalationService = new EscalationService(repository, publisher);
    const workflowService = new WorkflowService(repository);
    workflowService.setEscalationService(escalationService);

    const definition = await workflowService.createDefinition(
      TENANT_ID,
      createDefinitionWithEscalation(),
    );

    // Initial state has no escalation rule — create succeeds without publish.
    const instance = await workflowService.createInstance(TENANT_ID, {
      workflowDefinitionId: definition.id,
      entityType: 'leave_request',
      entityId: 'leave-1',
    });

    // Transition into pending_approval: DB update commits, then scheduleEscalation
    // dual-writes to the broker and crashes — message lost, state already changed.
    await expect(
      workflowService.transition(TENANT_ID, instance.id, {
        action: 'submit',
        actorId: 'user-1',
      }),
    ).rejects.toThrow(/broker unavailable/);

    const updated = await repository.findInstanceById(instance.id, TENANT_ID);
    expect(updated?.currentStateId).toBe('pending_approval');
    expect(durableStore.pendingCount).toBe(0);
  });

  it('recovers escalation task committed to outbox before broker publish', async () => {
    const publisher = new OutboxEscalationPublisher(outbox, queue);
    const escalationService = new EscalationService(repository, publisher);
    const workflowService = new WorkflowService(repository);
    workflowService.setEscalationService(escalationService);

    const definition = await workflowService.createDefinition(
      TENANT_ID,
      createDefinitionWithEscalation(),
    );

    const instance = await workflowService.createInstance(TENANT_ID, {
      workflowDefinitionId: definition.id,
      entityType: 'leave_request',
      entityId: 'leave-2',
    });
    await workflowService.transition(TENANT_ID, instance.id, {
      action: 'submit',
      actorId: 'user-1',
    });

    // Outbox has the delayed row; broker has nothing yet (availableAt in future).
    const pending = await outbox.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.eventType).toBe(WORKFLOW_ESCALATION_JOB_TYPE);
    expect(durableStore.pendingCount).toBe(0);

    // Simulate crash + new relay process with availableAt forced due.
    const due = pending[0]!;
    outbox.clear();
    await outbox.enqueue({
      id: due.id,
      tenantId: due.tenantId,
      aggregateType: due.aggregateType,
      aggregateId: due.aggregateId,
      eventType: due.eventType,
      payload: due.payload,
      metadata: due.metadata,
      dispatchMode: due.dispatchMode,
      availableAt: new Date(Date.now() - 1000),
    });

    const relay = new OutboxRelay({ store: outbox, queue, batchSize: 10 });
    const published = await relay.tick();
    expect(published).toBe(1);
    expect(await outbox.listPending()).toHaveLength(0);
    expect(durableStore.pendingCount).toBe(1);

    const leased = durableStore.leaseMatching(
      buildTenantName(TENANT_ID, WORKFLOW_ESCALATION_JOB_TYPE),
    );
    expect(leased).not.toBeNull();
    expect(leased!.message.type).toBe(WORKFLOW_ESCALATION_JOB_TYPE);
    expect((leased!.message.payload as { instanceId: string }).instanceId).toBe(instance.id);
  });

  it('scheduleEscalation with outbox survives publish crash after enqueue', async () => {
    const publisher = new OutboxEscalationPublisher(outbox, queue);
    const escalationService = new EscalationService(repository, publisher);

    const definition = await new WorkflowService(repository).createDefinition(
      TENANT_ID,
      createDefinitionWithEscalation(),
    );
    const instance = await repository.createInstance({
      id: 'inst-orphan',
      tenantId: TENANT_ID,
      workflowDefinitionId: definition.id,
      entityType: 'leave_request',
      entityId: 'leave-3',
      currentStateId: 'pending_approval',
      status: 'ACTIVE',
      metadata: null,
      approvals: [],
    });

    await escalationService.scheduleEscalation(
      TENANT_ID,
      instance.id,
      'pending_approval',
      definition.id,
    );

    expect(await outbox.listPending()).toHaveLength(1);
    expect(durableStore.pendingCount).toBe(0);

    const [row] = await outbox.listPending();
    outbox.clear();
    await outbox.enqueue({
      ...row!,
      availableAt: new Date(0),
    });

    const failingAdapter = new InMemoryDurableQueueAdapter({
      store: durableStore,
      pollIntervalMs: 5,
    });
    await failingAdapter.connect();
    const originalDispatch = failingAdapter.dispatch.bind(failingAdapter);
    let failOnce = true;
    failingAdapter.dispatch = async (message, options) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('transient broker blip');
      }
      return originalDispatch(message, options);
    };

    const relay = new OutboxRelay({
      store: outbox,
      queue: failingAdapter,
      batchSize: 10,
      maxAttempts: 5,
      retryBackoffMs: 1,
    });

    expect(await relay.tick()).toBe(0);
    expect((await outbox.listPending()).length).toBeGreaterThanOrEqual(1);

    for (const p of await outbox.listPending()) {
      await outbox.markFailed(p.id, 'retry-now', new Date(0));
    }
    expect(await relay.tick()).toBeGreaterThanOrEqual(1);
    expect(durableStore.pendingCount).toBe(1);
  });
});
