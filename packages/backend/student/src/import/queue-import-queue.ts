/**
 * ImportQueue backed by @proctira/queue-abstraction (W2-JOB-06).
 *
 * Publishes student bulk-import jobs onto the durable queue spine so a
 * consumer can call ImportService.processQueuedImport — surviving
 * gateway/worker restarts when the backend retains unacked messages.
 *
 * Progress snapshots remain in-process (honest residual); the job payload
 * itself is durable on the queue.
 */
import { randomUUID } from 'node:crypto';

import type { QueueAdapter, QueueMessage } from '@proctira/queue-abstraction';
import { STUDENT_IMPORT_JOB_TYPE } from '@proctira/queue-abstraction';

import type { ImportOptions, ImportProgress, ImportQueue } from './types.js';

/** Payload carried on `student.import` queue messages. */
export interface StudentImportJobPayload {
  jobId: string;
  tenantId: string;
  /** Base64-encoded Excel buffer (tests use small files). */
  fileBase64: string;
  options: ImportOptions;
}

/**
 * Durable import queue: progress Map for polling + QueueAdapter for jobs.
 */
export class QueueImportQueue implements ImportQueue {
  private readonly progress = new Map<string, ImportProgress>();

  constructor(private readonly queue: QueueAdapter) {}

  async enqueue(
    tenantId: string,
    jobId: string,
    fileBuffer: Buffer,
    options: ImportOptions,
  ): Promise<void> {
    const payload: StudentImportJobPayload = {
      jobId,
      tenantId,
      fileBase64: fileBuffer.toString('base64'),
      options,
    };

    const message: QueueMessage<StudentImportJobPayload> = {
      id: randomUUID(),
      tenantId,
      type: STUDENT_IMPORT_JOB_TYPE,
      payload,
      timestamp: new Date().toISOString(),
      metadata: {
        correlationId: jobId,
        maxRetries: 3,
        retryCount: 0,
      },
    };

    await this.queue.dispatch(message);
  }

  async getProgress(jobId: string): Promise<ImportProgress | null> {
    return this.progress.get(jobId) ?? null;
  }

  async updateProgress(jobId: string, progress: Partial<ImportProgress>): Promise<void> {
    const existing = this.progress.get(jobId);
    if (existing) {
      this.progress.set(jobId, { ...existing, ...progress });
    } else {
      this.progress.set(jobId, progress as ImportProgress);
    }
  }
}
