/**
 * PRC-H110: with an escalation publisher + worker queue, workflowPlugin starts
 * the escalation consumer so a due escalation moves the instance and
 * dispatches the escalation notification.
 *
 * Note: InMemoryDurableQueueAdapter does not honour `delay` (PRO-S19-03), so
 * the 1-minute rule fires as soon as the consumer drains the task.
 */
import {
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
  WORKFLOW_ESCALATION_NOTIFY_TYPE,
} from '@proctira/queue-abstraction';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryWorkflowRepository } from './in-memory-repository.js';
import { QueueEscalationPublisher } from './queue-escalation-publisher.js';
import type { CreateWorkflowDefinitionInput } from './schemas.js';
import { workflowPlugin } from './workflow-plugin.js';

const TENANT_ID = 'tenant-esc-wiring';

const definitionInput: CreateWorkflowDefinitionInput = {
  name: 'Escalation wiring',
  entityType: 'leave_request',
  states: [
    { id: 'submitted', name: 'Submitted', type: 'INITIAL', assigneeType: 'user', assigneeId: 'u' },
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
    { id: 'approved', name: 'Approved', type: 'FINAL', assigneeType: 'role', assigneeId: 'm' },
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

async function buildApp(withWorker: boolean) {
  const store = new InMemoryDurableQueueStore();
  const publisherQueue = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
  await publisherQueue.connect();
  const repository = new InMemoryWorkflowRepository();
  const app = Fastify();
  await app.register(workflowPlugin, {
    repository,
    escalationPublisher: new QueueEscalationPublisher(publisherQueue),
    escalationWorkerQueue: withWorker
      ? new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 })
      : undefined,
    prefix: '/workflow-engine',
  });
  app.addHook('onClose', async () => {
    await publisherQueue.disconnect();
  });
  await app.ready();
  return { app, store, repository };
}

async function startEscalatingInstance(app: FastifyInstance) {
  const def = await app.workflowService.createDefinition(TENANT_ID, definitionInput);
  const instance = await app.workflowService.createInstance(TENANT_ID, {
    workflowDefinitionId: def.id,
    entityType: 'leave_request',
    entityId: 'leave-1',
  });
  await app.workflowService.transition(TENANT_ID, instance.id, {
    action: 'submit',
    actorId: 'user-1',
  });
  return instance.id;
}

async function waitFor(pred: () => Promise<boolean>, timeoutMs = 3000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return pred();
}

describe('PRC-H110 workflow escalation worker wiring', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('due escalation moves the instance and dispatches the notification', async () => {
    const built = await buildApp(true);
    app = built.app;
    expect(app.escalationWorker?.running).toBe(true);
    const instanceId = await startEscalatingInstance(app);
    const moved = await waitFor(async () => {
      const inst = await built.repository.findInstanceById(instanceId, TENANT_ID);
      return inst?.currentStateId === 'escalated_review';
    });
    expect(moved).toBe(true);
    // Escalation task consumed; notification published to its topic.
    expect(built.store.inFlightCount).toBe(0);
    const notifications = built.store.pending.filter(
      (e) => e.message.type === WORKFLOW_ESCALATION_NOTIFY_TYPE,
    );
    expect(notifications.length).toBeGreaterThanOrEqual(1);
  });

  it('without a worker queue the task stays pending (no consumer registered)', async () => {
    const built = await buildApp(false);
    app = built.app;
    expect(app.escalationWorker).toBeUndefined();
    const instanceId = await startEscalatingInstance(app);
    await new Promise((r) => setTimeout(r, 50));
    const inst = await built.repository.findInstanceById(instanceId, TENANT_ID);
    expect(inst?.currentStateId).toBe('pending_approval');
  });

  it('stops the worker on close', async () => {
    const built = await buildApp(true);
    const worker = built.app.escalationWorker!;
    await built.app.close();
    expect(worker.running).toBe(false);
  });
});
