/**
 * Workflow escalation consumer helper (P1-WF).
 *
 * Consumes `tenant.*.workflow.escalation` jobs and calls
 * EscalationService.processEscalation. Survives process restart when the
 * queue backend retains unacked messages (RabbitMQ) or a shared durable store
 * (InMemoryDurableQueueAdapter for proofs).
 */
import type { QueueAdapter, QueueMessage } from '@proctira/queue-abstraction';
import {
  WORKFLOW_ESCALATION_CONSUME_TOPIC,
  WORKFLOW_ESCALATION_JOB_TYPE,
} from '@proctira/queue-abstraction';

import type { EscalationService, EscalationTaskPayload } from './escalation-service.js';

export interface WorkflowEscalationWorkerLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface WorkflowEscalationProcessor {
  processEscalation(payload: EscalationTaskPayload): Promise<boolean>;
}

export interface WorkflowEscalationWorkerOptions {
  queue: QueueAdapter;
  processor: WorkflowEscalationProcessor | EscalationService;
  /** RabbitMQ / memory consume topic pattern (default: all tenants). */
  topic?: string;
  groupId?: string;
  logger?: WorkflowEscalationWorkerLogger;
}

export interface WorkflowEscalationWorker {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly running: boolean;
}

function isEscalationPayload(payload: unknown): payload is EscalationTaskPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as EscalationTaskPayload).instanceId === 'string' &&
    typeof (payload as EscalationTaskPayload).stateId === 'string' &&
    typeof (payload as EscalationTaskPayload).escalateToStateId === 'string' &&
    typeof (payload as EscalationTaskPayload).tenantId === 'string'
  );
}

export function createWorkflowEscalationWorker(
  options: WorkflowEscalationWorkerOptions,
): WorkflowEscalationWorker {
  let running = false;

  return {
    get running() {
      return running;
    },
    async start() {
      if (running) return;
      const topic = options.topic ?? WORKFLOW_ESCALATION_CONSUME_TOPIC;
      if (!options.queue.isConnected()) {
        await options.queue.connect();
      }
      await options.queue.consume(
        {
          topic,
          groupId: options.groupId ?? 'workflow-escalation-workers',
          autoAck: false,
        },
        async (message: QueueMessage) => {
          if (
            message.type !== WORKFLOW_ESCALATION_JOB_TYPE &&
            !isEscalationPayload(message.payload)
          ) {
            options.logger?.error(
              { type: message.type, id: message.id },
              'workflow-escalation worker ignored unexpected message',
            );
            return;
          }
          if (!isEscalationPayload(message.payload)) {
            throw new Error(`Invalid workflow escalation payload on message ${message.id}`);
          }
          options.logger?.info(
            {
              tenantId: message.tenantId,
              instanceId: message.payload.instanceId,
              messageId: message.id,
            },
            'workflow-escalation worker processing task',
          );
          await options.processor.processEscalation(message.payload);
          options.logger?.info(
            { tenantId: message.tenantId, instanceId: message.payload.instanceId },
            'workflow-escalation worker completed task',
          );
        },
      );
      running = true;
      options.logger?.info({ topic }, 'workflow-escalation worker started');
    },
    async stop() {
      if (!running) return;
      await options.queue.disconnect();
      running = false;
      options.logger?.info({}, 'workflow-escalation worker stopped');
    },
  };
}
