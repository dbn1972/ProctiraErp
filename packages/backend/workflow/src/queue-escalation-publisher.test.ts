/**
 * Unit tests for QueueEscalationPublisher (P1-WF queue bridge).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  WORKFLOW_ESCALATION_JOB_TYPE,
  WORKFLOW_ESCALATION_NOTIFY_TYPE,
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
  buildTenantName,
} from '@proctira/queue-abstraction';
import type { TaskMessage } from '@proctira/events';

import { QueueEscalationPublisher } from './queue-escalation-publisher.js';
import type { EscalationTaskPayload } from './escalation-service.js';

describe('QueueEscalationPublisher', () => {
  let store: InMemoryDurableQueueStore;
  let adapter: InMemoryDurableQueueAdapter;

  beforeEach(async () => {
    store = new InMemoryDurableQueueStore();
    adapter = new InMemoryDurableQueueAdapter({ store });
    await adapter.connect();
  });

  afterEach(async () => {
    if (adapter.isConnected()) await adapter.disconnect();
  });

  it('dispatches workflow.escalation with delay metadata', async () => {
    const publisher = new QueueEscalationPublisher(adapter);
    const task: TaskMessage<EscalationTaskPayload> = {
      id: 'task-esc-1',
      tenantId: 't1',
      type: 'workflow.escalation',
      payload: {
        tenantId: 't1',
        instanceId: 'inst-1',
        stateId: 'pending',
        escalateToStateId: 'escalated',
        notifyRoleId: 'director',
        durationMinutes: 60,
        stateEnteredAt: new Date().toISOString(),
      },
      options: {
        priority: 5,
        delay: 60 * 60 * 1000,
        maxRetries: 3,
        retryCount: 0,
      },
    };

    await publisher.publishEscalationTask(task);

    expect(store.pendingCount).toBe(1);
    const entry = store.pending[0]!;
    expect(entry.routingKey).toBe(buildTenantName('t1', WORKFLOW_ESCALATION_JOB_TYPE));
    expect(entry.message.type).toBe(WORKFLOW_ESCALATION_JOB_TYPE);
    expect(entry.message.metadata?.delay).toBe(60 * 60 * 1000);
    expect(entry.message.payload).toMatchObject({
      instanceId: 'inst-1',
      escalateToStateId: 'escalated',
    });
  });

  it('dispatches escalation notifications on notify topic', async () => {
    const publisher = new QueueEscalationPublisher(adapter);
    await publisher.publishEscalationNotification({
      tenantId: 't1',
      instanceId: 'inst-1',
      entityType: 'leave_request',
      entityId: 'leave-1',
      fromStateId: 'pending',
      toStateId: 'escalated',
      notifyRoleId: 'director',
      escalatedAt: '2026-09-12T00:00:00.000Z',
      durationMinutes: 60,
    });

    expect(store.pendingCount).toBe(1);
    expect(store.pending[0]!.message.type).toBe(WORKFLOW_ESCALATION_NOTIFY_TYPE);
    expect(store.pending[0]!.routingKey).toBe(
      buildTenantName('t1', WORKFLOW_ESCALATION_NOTIFY_TYPE),
    );
  });
});
