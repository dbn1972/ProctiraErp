/**
 * ImportQueue backed by @proctira/queue-abstraction (W2-JOB-06).
 *
 * Publishes student bulk-import jobs onto the durable queue spine so a
 * consumer can call ImportService.processQueuedImport — surviving
 * gateway/worker restarts when the backend retains unacked messages.
 *
 * PRC-H092: progress snapshots go through an ImportProgressStore keyed by
 * (tenantId, jobId) — Redis-backed when REDIS_URL is set, so every gateway
 * instance answers polls identically.
 */
import { randomUUID } from 'node:crypto';

import type { QueueAdapter, QueueMessage } from '@proctira/queue-abstraction';
import { STUDENT_IMPORT_JOB_TYPE } from '@proctira/queue-abstraction';

import { InMemoryImportProgressStore } from './progress-store.js';
import type { ImportOptions, ImportProgress, ImportProgressStore, ImportQueue } from './types.js';

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
  constructor(
    private readonly queue: QueueAdapter,
    /** PRC-H092: persisted (Redis) progress so any instance can answer polls. */
    private readonly progressStore: ImportProgressStore = new InMemoryImportProgressStore(),
  ) {}

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

  async getProgress(tenantId: string, jobId: string): Promise<ImportProgress | null> {
    return this.progressStore.get(tenantId, jobId);
  }

  async updateProgress(
    tenantId: string,
    jobId: string,
    progress: Partial<ImportProgress>,
  ): Promise<void> {
    await this.progressStore.update(tenantId, jobId, progress);
  }
}
