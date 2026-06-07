/**
 * In-Memory Import Queue
 *
 * Used for unit testing the import service without RabbitMQ dependencies.
 * Simulates the queue behavior for async import processing.
 */

import type { ImportOptions, ImportProgress, ImportQueue } from './types.js';

export class InMemoryImportQueue implements ImportQueue {
  private jobs: Map<string, { tenantId: string; fileBuffer: Buffer; options: ImportOptions }> =
    new Map();
  private progress: Map<string, ImportProgress> = new Map();

  async enqueue(
    tenantId: string,
    jobId: string,
    fileBuffer: Buffer,
    options: ImportOptions,
  ): Promise<void> {
    this.jobs.set(jobId, { tenantId, fileBuffer, options });
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

  /** Helper: get enqueued jobs (for test assertions) */
  getEnqueuedJobs(): Map<string, { tenantId: string; fileBuffer: Buffer; options: ImportOptions }> {
    return new Map(this.jobs);
  }

  /** Helper: clear all state */
  clear(): void {
    this.jobs.clear();
    this.progress.clear();
  }
}
