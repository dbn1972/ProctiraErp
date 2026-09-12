/**
 * Restart-safe integration proof for workflow escalation via queue-abstraction (P1-WF).
 *
 * Simulates a consumer crash mid-processEscalation using InMemoryDurableQueueStore,
 * then restarts the worker against the same durable store and asserts the instance
 * escalates after redelivery.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
  WORKFLOW_ESCALATION_CONSUME_TOPIC,
} from '@proctira/queue-abstraction';

import { EscalationService } from './escalation-service.js';
import { createWorkflowEscalationWorker } from './escalation-worker.js';
import { InMemoryWorkflowRepository } from './in-memory-repository.js';
import { QueueEscalationPublisher } from './queue-escalation-publisher.js';
import { WorkflowService } from './workflow-service.js';
import type { CreateWorkflowDefinitionInput } from './schemas.js';

const TENANT_ID = 'tenant-esc-spine';

function createDefinitionWithEscalation(): CreateWorkflowDefinitionInput {
  return {
    name: 'Escalation spine',
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

async function waitUntil(pred: () => boolean | Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!(await pred())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out');
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe('workflow escalation restart-safe spine', () => {
  let store: InMemoryDurableQueueStore;
  let repository: InMemoryWorkflowRepository;

  beforeEach(() => {
    store = new InMemoryDurableQueueStore();
    repository = new InMemoryWorkflowRepository();
  });

  it('redelivers and escalates after consumer crash before ack', async () => {
    const publishAdapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    await publishAdapter.connect();
    const publisher = new QueueEscalationPublisher(publishAdapter);
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
      entityId: 'leave-spine-1',
    });
    await workflowService.transition(TENANT_ID, instance.id, {
      action: 'submit',
      actorId: 'user-1',
    });

    // scheduleEscalation already published via QueueEscalationPublisher
    expect(store.pendingCount).toBeGreaterThanOrEqual(1);

    let hangResolve!: () => void;
    const hang = new Promise<void>((r) => {
      hangResolve = r;
    });
    let firstAttempts = 0;

    const crashAdapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    const crashWorker = createWorkflowEscalationWorker({
      queue: crashAdapter,
      topic: WORKFLOW_ESCALATION_CONSUME_TOPIC,
      processor: {
        processEscalation: async () => {
          firstAttempts += 1;
          await hang;
          return false;
        },
      },
    });
    await crashWorker.start();
    await waitUntil(() => store.inFlightCount === 1);
    expect(firstAttempts).toBe(1);

    await crashWorker.stop();
    expect(store.pendingCount).toBeGreaterThanOrEqual(1);
    expect(store.inFlightCount).toBe(0);

    const resumeAdapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    const resumePublisher = new QueueEscalationPublisher(resumeAdapter);
    const resumeService = new EscalationService(repository, resumePublisher);
    const resumeWorker = createWorkflowEscalationWorker({
      queue: resumeAdapter,
      topic: WORKFLOW_ESCALATION_CONSUME_TOPIC,
      processor: resumeService,
    });
    await resumeWorker.start();

    await waitUntil(async () => {
      const current = await repository.findInstanceById(instance.id, TENANT_ID);
      return current?.currentStateId === 'escalated_review';
    });

    const final = await repository.findInstanceById(instance.id, TENANT_ID);
    expect(final?.currentStateId).toBe('escalated_review');

    const audit = await repository.getAuditHistory(instance.id, TENANT_ID);
    expect(audit.some((a) => a.action === 'escalate' && a.actorId === 'SYSTEM_ESCALATION')).toBe(
      true,
    );

    hangResolve();
    await resumeWorker.stop();
    await publishAdapter.disconnect();
  });
});
