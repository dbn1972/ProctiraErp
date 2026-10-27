/**
 * PRC-L101 — PgPipelineRepository cross-tenant isolation on a real, migrated Postgres
 * (runtime app role, RLS enforced). Tenant B can neither read nor update tenant A's run.
 *
 * Fails closed when CI=true or REQUIRE_LIVE_TESTS=1 and DATABASE_URL is unset (W3-TEST-03);
 * otherwise skips loudly for local unit-only runs.
 */
import { randomUUID } from 'node:crypto';
import { closeSharedPgPools, getSharedPgPool } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { afterAll, describe, expect, it } from 'vitest';
import { PgPipelineRepository } from './pg-pipeline-repository.js';
import type { Pipeline, PipelineExecution } from './schemas.js';

const SUITE = 'pg-pipeline-repository.live.test';
const DATABASE_URL = process.env['DATABASE_URL']?.trim();
const liveRequired =
  process.env['ALLOW_LIVE_TEST_SKIP'] !== '1' &&
  (process.env['REQUIRE_LIVE_TESTS'] === '1' ||
    process.env['CI'] === 'true' ||
    process.env['CI'] === '1');
if (!DATABASE_URL && liveRequired) {
  throw new Error(`[W3-TEST-03] Live suite "${SUITE}" has no DATABASE_URL.`);
}
if (!DATABASE_URL) console.warn(`WARNING: [W3-TEST-03] ${SUITE} skipped (no DATABASE_URL).`);
const pool = DATABASE_URL ? getSharedPgPool() : null;

afterAll(async () => {
  await closeSharedPgPools();
});

function pipeline(tenantId: string): Pipeline {
  const now = new Date();
  return {
    id: randomUUID(),
    tenantId,
    name: 'live-l101',
    description: null,
    source: { type: 'csv', fileContent: 'a\n1\n', delimiter: ',', hasHeader: true },
    destination: {
      type: 'postgresql',
      host: 'localhost',
      port: 5432,
      database: 'db',
      username: 'u',
      password: 'p',
      table: 't',
      writeMode: 'insert',
    },
    fieldMappings: [{ sourceField: 'a', destinationField: 'a' }],
    schedule: null,
    retryPolicy: { maxRetries: 0, backoffMs: 1 },
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

describe.skipIf(!pool)('PgPipelineRepository live cross-tenant isolation (PRC-L101)', () => {
  it("tenant B cannot read or update tenant A's execution; A's row is unchanged", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    await ensurePgTestTenant(pool!, tenantA);
    await ensurePgTestTenant(pool!, tenantB);
    const repo = new PgPipelineRepository(pool!);
    const p = await repo.create(pipeline(tenantA));
    const run: PipelineExecution = {
      id: randomUUID(),
      pipelineId: p.id,
      tenantId: tenantA,
      status: 'running',
      startedAt: new Date(),
      completedAt: null,
      extractedCount: 0,
      transformedCount: 0,
      loadedCount: 0,
      errorCount: 0,
      errors: [],
    };
    expect(await repo.createExecutionIfIdle(run, new Date(0))).toBe(true);

    expect(await repo.getExecution(run.id, tenantB)).toBeNull();
    expect(await repo.findById(p.id, tenantB)).toBeNull();
    expect((await repo.listExecutions(p.id, tenantB, 1, 50)).total).toBe(0);
    await expect(
      repo.updateExecution(run.id, { tenantId: tenantB, status: 'failed' }),
    ).rejects.toThrow(/Execution not found/);

    const own = await repo.getExecution(run.id, tenantA);
    expect(own?.tenantId).toBe(tenantA);
    expect(own?.status).toBe('running');
  });
});
