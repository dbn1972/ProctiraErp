/**
 * DocumentTaskQueue backed by @proctira/queue-abstraction.
 * Publishes durable exam document generation jobs for background workers.
 */
import type { QueueAdapter, QueueMessage } from '@proctira/queue-abstraction';
import { EXAM_DOCUMENT_JOB_TYPE } from '@proctira/queue-abstraction';
import { randomUUID } from 'node:crypto';

import type { DocumentGenerationJob } from './document-repository.js';
import type { DocumentTaskQueue } from './document-generation-service.js';

export interface ExamDocumentJobPayload {
  jobId: string;
  examinationId: string;
  documentType: string;
}

/**
 * Publishes document generation jobs via QueueAdapter.dispatch.
 * Routing key: tenant.{tenantId}.exam.document.generate
 */
export class QueueDocumentTaskQueue implements DocumentTaskQueue {
  constructor(private readonly queue: QueueAdapter) {}

  async publishDocumentTask(job: DocumentGenerationJob): Promise<void> {
    const message: QueueMessage<ExamDocumentJobPayload> = {
      id: randomUUID(),
      tenantId: job.tenantId,
      type: EXAM_DOCUMENT_JOB_TYPE,
      payload: {
        jobId: job.id,
        examinationId: job.examinationId,
        documentType: job.documentType,
      },
      timestamp: new Date().toISOString(),
      metadata: {
        correlationId: job.id,
        maxRetries: 3,
      },
    };

    await this.queue.dispatch(message);
  }
}
