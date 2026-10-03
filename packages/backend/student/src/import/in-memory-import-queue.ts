/**
 * In-Memory Import Queue
 *
 * Used for unit testing the import service without RabbitMQ dependencies.
 * Simulates the queue behavior for async import processing.
 */

import { InMemoryImportProgressStore } from './progress-store.js';
import type { ImportOptions, ImportProgress, ImportProgressStore, ImportQueue } from './types.js';

export type InMemoryImportEnqueueHook = (
  tenantId: string,
  jobId: string,
  fileBuffer: Buffer,
  options: ImportOptions,
) => void;

export class InMemoryImportQueue implements ImportQueue {
  /**
   * PRC-H092: optional in-process processor hook. When set (gateway fallback
   * without a durable queue) each enqueued job is handed to it so async /
   * >1000-row imports are processed instead of staying `queued` forever.
   */
  constructor(
    private readonly onEnqueue?: InMemoryImportEnqueueHook,
    /** PRC-H092: shared/persisted progress (defaults to per-process memory). */
    private readonly progressStore: ImportProgressStore = new InMemoryImportProgressStore(),
  ) {}

  private jobs: Map<string, { tenantId: string; fileBuffer: Buffer; options: ImportOptions }> =
    new Map();

  async enqueue(
    tenantId: string,
    jobId: string,
    fileBuffer: Buffer,
    options: ImportOptions,
  ): Promise<void> {
    this.jobs.set(jobId, { tenantId, fileBuffer, options });
    this.onEnqueue?.(tenantId, jobId, fileBuffer, options);
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

  /** Helper: get enqueued jobs (for test assertions) */
  getEnqueuedJobs(): Map<string, { tenantId: string; fileBuffer: Buffer; options: ImportOptions }> {
    return new Map(this.jobs);
  }

  /** Helper: clear all state */
  clear(): void {
    this.jobs.clear();
    if (this.progressStore instanceof InMemoryImportProgressStore) this.progressStore.clear();
  }
}
