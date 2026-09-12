/**
 * EscalationPublisher backed by @proctira/queue-abstraction (P1-WF).
 *
 * Publishes delayed escalation tasks onto the durable queue spine so a
 * consumer/worker can call EscalationService.processEscalation after the
 * configured timeout — surviving gateway/worker restarts when the backend
 * retains unacked messages.
 */
import type { TaskMessage } from '@proctira/events';
import type { QueueAdapter, QueueMessage } from '@proctira/queue-abstraction';
import {
  WORKFLOW_ESCALATION_JOB_TYPE,
  WORKFLOW_ESCALATION_NOTIFY_TYPE,
} from '@proctira/queue-abstraction';

import type {
  EscalationNotification,
  EscalationPublisher,
  EscalationTaskPayload,
} from './escalation-service.js';

/**
 * Maps TaskMessage escalation tasks onto QueueAdapter.dispatch with delay
 * metadata (RabbitMQ x-delay / SQS DelaySeconds when the backend supports it).
 */
export class QueueEscalationPublisher implements EscalationPublisher {
  constructor(private readonly queue: QueueAdapter) {}

  async publishEscalationTask(task: TaskMessage<EscalationTaskPayload>): Promise<void> {
    const message: QueueMessage<EscalationTaskPayload> = {
      id: task.id,
      tenantId: task.tenantId,
      type: WORKFLOW_ESCALATION_JOB_TYPE,
      payload: task.payload,
      timestamp: new Date().toISOString(),
      metadata: {
        correlationId: task.payload.instanceId,
        priority: task.options.priority,
        delay: task.options.delay,
        maxRetries: task.options.maxRetries,
        retryCount: task.options.retryCount,
      },
    };

    await this.queue.dispatch(message, {
      delay: task.options.delay,
      priority: task.options.priority,
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
