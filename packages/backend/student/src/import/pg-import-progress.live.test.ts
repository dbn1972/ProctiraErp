/**
 * Live Postgres proof for PRC-H092: import progress persisted in student_import_jobs
 * (migration 152) is visible to another store instance (another gateway) and never to
 * another tenant. Skipped unless DATABASE_URL is set.
 */
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { afterAll, describe, expect, it } from 'vitest';

import { PgImportProgressStore } from './progress-store.js';

const DATABASE_URL = process.env['DATABASE_URL']?.trim();
const poolA = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 2 }) : null;
const poolB = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 2 }) : null;
const live = poolA !== null && poolB !== null;

afterAll(async () => {
  await poolA?.end();
  await poolB?.end();
});

describe('PgImportProgressStore (live, PRC-H092)', () => {
  it.skipIf(!live)(
    'progress written by one instance is read by another, tenant-scoped',
    async () => {
      const tenantA = randomUUID();
      const tenantB = randomUUID();
      await ensurePgTestTenant(poolA!, tenantA);
      await ensurePgTestTenant(poolA!, tenantB);
      const writer = new PgImportProgressStore(poolA!);
      const reader = new PgImportProgressStore(poolB!);
      const jobId = randomUUID();
      await writer.update(tenantA, jobId, {
        jobId,
        status: 'queued',
        totalRows: 1200,
        processedRows: 0,
        progressPercent: 0,
        startedAt: new Date().toISOString(),
      });
      await writer.update(tenantA, jobId, { status: 'processing', progressPercent: 10 });
      await writer.update(tenantA, jobId, {
        status: 'completed',
        processedRows: 1200,
        progressPercent: 100,
        completedAt: new Date().toISOString(),
      });
      const seen = await reader.get(tenantA, jobId);
      expect(seen).toMatchObject({
        jobId,
        status: 'completed',
        totalRows: 1200,
        processedRows: 1200,
        progressPercent: 100,
      });
      expect(seen?.completedAt).toBeTruthy();
      expect(await reader.get(tenantB, jobId)).toBeNull();
    },
  );
});
