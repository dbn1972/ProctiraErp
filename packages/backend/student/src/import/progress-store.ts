/**
 * PRC-H092: student import progress stores, keyed by (tenantId, jobId).
 *
 * - InMemoryImportProgressStore: per-process (tests / single instance).
 * - CacheImportProgressStore: Redis via @proctira/cache, tenant-namespaced
 *   (`t:<tenant>:student-import:<job>`) with a TTL, so a poll on any gateway
 *   instance returns the same progress and another tenant's job id never
 *   resolves.
 *
 * A relational `import_jobs` table (durable audit of results beyond the TTL)
 * is a separate schema migration.
 */
import { CacheClient, tenantKey } from '@proctira/cache';

import type { ImportProgress, ImportProgressStore } from './types.js';

/** Default retention for polled progress/results (24 h). */
export const IMPORT_PROGRESS_TTL_SECONDS = 24 * 60 * 60;

function merge(existing: ImportProgress | null, progress: Partial<ImportProgress>): ImportProgress {
  return (existing ? { ...existing, ...progress } : progress) as ImportProgress;
}

export class InMemoryImportProgressStore implements ImportProgressStore {
  private readonly rows = new Map<string, ImportProgress>();

  private key(tenantId: string, jobId: string): string {
    return `${tenantId}\u0000${jobId}`;
  }

  async get(tenantId: string, jobId: string): Promise<ImportProgress | null> {
    const row = this.rows.get(this.key(tenantId, jobId));
    return row ? { ...row } : null;
  }

  async update(tenantId: string, jobId: string, progress: Partial<ImportProgress>): Promise<void> {
    const key = this.key(tenantId, jobId);
    this.rows.set(key, merge(this.rows.get(key) ?? null, progress));
  }

  clear(): void {
    this.rows.clear();
  }
}

/** Minimal cache surface (CacheClient satisfies it; tests may pass a fake). */
export interface ImportProgressCache {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
}

export class CacheImportProgressStore implements ImportProgressStore {
  constructor(
    private readonly cache: ImportProgressCache,
    private readonly ttlSeconds = IMPORT_PROGRESS_TTL_SECONDS,
  ) {}

  private key(tenantId: string, jobId: string): string {
    return tenantKey(tenantId, 'student-import', jobId);
  }

  async get(tenantId: string, jobId: string): Promise<ImportProgress | null> {
    return this.cache.get<ImportProgress>(this.key(tenantId, jobId));
  }

  /**
   * Read-merge-write. Only the single consumer processing a job writes its
   * progress after the initial `queued` snapshot, so no cross-writer race.
   */
  async update(tenantId: string, jobId: string, progress: Partial<ImportProgress>): Promise<void> {
    const key = this.key(tenantId, jobId);
    const existing = await this.cache.get<ImportProgress>(key);
    await this.cache.set(key, merge(existing, progress), this.ttlSeconds);
  }
}

/**
 * Redis-backed store when REDIS_URL is set; per-process memory otherwise.
 */
export function createImportProgressStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ImportProgressStore {
  const redisUrl = env['REDIS_URL'];
  if (!redisUrl) return new InMemoryImportProgressStore();
  return new CacheImportProgressStore(new CacheClient({ redisUrl }));
}
