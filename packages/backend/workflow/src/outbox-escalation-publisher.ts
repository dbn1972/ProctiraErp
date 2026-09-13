/**
 * EscalationPublisher that writes to the transactional outbox (W2-JOB-03).
 *
 * Instance create/transition commits an outbox row instead of dual-writing
 * createInstance → QueueAdapter.dispatch. OutboxRelay publishes afterward;
 * crash between commit and broker publish is recovered by the relay.
 */
import type { TaskMessage } from '@proctira/events';
import type { OutboxStore, QueueAdapter, QueueMessage } from '@proctira/queue-abstraction';
import {
  WORKFLOW_ESCALATION_NOTIFY_TYPE,
  buildWorkflowEscalationOutboxEntry,
} from '@proctira/queue-abstraction';

import type {
  EscalationNotification,
  EscalationPublisher,
  EscalationTaskPayload,
} from './escalation-service.js';

/**
 * Schedules escalation tasks via outbox; notifications still dispatch on the
 * queue (side-channel after processEscalation already committed state).
 */
export class OutboxEscalationPublisher implements EscalationPublisher {
  constructor(
    private readonly outbox: OutboxStore,
    private readonly queue: QueueAdapter,
  ) {}

  async publishEscalationTask(task: TaskMessage<EscalationTaskPayload>): Promise<void> {
    const delayMs = task.options.delay;
    const availableAt =
      typeof delayMs === 'number' && delayMs > 0 ? new Date(Date.now() + delayMs) : undefined;

    await this.outbox.enqueue({
      ...buildWorkflowEscalationOutboxEntry({
        tenantId: task.tenantId,
        taskId: task.id,
        payload: task.payload,
        delayMs,
      }),
      // Preserve message id for consumer idempotency / correlation.
      aggregateId: task.id,
      metadata: {
        correlationId: task.payload.instanceId,
        priority: task.options.priority,
        delay: delayMs,
        maxRetries: task.options.maxRetries,
        retryCount: task.options.retryCount,
        headers: {
          'x-escalation-task-id': task.id,
        },
      },
      availableAt,
    });
  }

  async publishEscalationNotification(notification: EscalationNotification): Promise<void> {
    const message: QueueMessage<EscalationNotification> = {
      id: `esc-notify-${notification.instanceId}-${notification.escalatedAt}`,
      tenantId: notification.tenantId,
      type: WORKFLOW_ESCALATION_NOTIFY_TYPE,
      payload: notification,
      timestamp: notification.escalatedAt,
      metadata: {
        correlationId: notification.instanceId,
      },
    };

    await this.queue.dispatch(message);
  }
}
