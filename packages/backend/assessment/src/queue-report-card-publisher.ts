/**
 * TaskQueuePublisher backed by @proctira/queue-abstraction (W2-JOB-02).
 *
 * Publishes report-card generation jobs onto the durable queue spine so a
 * consumer can call ReportCardService.processReportCardJob — surviving
 * gateway/worker restarts when the backend retains unacked messages.
 */
import type { QueueAdapter, QueueMessage } from '@proctira/queue-abstraction';
import { REPORT_CARD_JOB_TYPE } from '@proctira/queue-abstraction';

import type { TaskQueuePublisher } from './report-card-service.js';

export interface ReportCardGenerateJobPayload {
  jobId: string;
  studentId: string;
  academicPeriodId: string;
  templateId: string;
  institutionId: string;
}

/**
 * Maps report-card generation tasks onto QueueAdapter.dispatch.
 */
export class QueueReportCardPublisher implements TaskQueuePublisher {
  constructor(private readonly queue: QueueAdapter) {}

  async publish(task: {
    id: string;
    tenantId: string;
    type: string;
    payload: unknown;
    options: { priority: number; delay: number; maxRetries: number; retryCount: number };
  }): Promise<void> {
    const message: QueueMessage<ReportCardGenerateJobPayload> = {
      id: task.id,
      tenantId: task.tenantId,
      type: REPORT_CARD_JOB_TYPE,
      payload: task.payload as ReportCardGenerateJobPayload,
      timestamp: new Date().toISOString(),
      metadata: {
        correlationId: task.id,
        priority: task.options.priority,
        delay: task.options.delay > 0 ? task.options.delay : undefined,
        maxRetries: task.options.maxRetries,
        retryCount: task.options.retryCount,
      },
    };

    await this.queue.dispatch(message, {
      delay: task.options.delay > 0 ? task.options.delay : undefined,
      priority: task.options.priority,
    });
  }
}
