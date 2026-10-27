/**
 * PRC-M631 — PgReportStore tenant isolation against the real migrated schema (app role, RLS on).
 * Also executes the PRC-L143 batched `getArtifactsByIds` (`id = ANY($2::uuid[])`) SQL.
 */
import { randomUUID } from 'node:crypto';
import { getSharedPgPool, withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';
import { PgReportStore } from './pg-report-store.js';
import type { ReportRunRecord } from './report-store.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-report-store.live.test' });
const pool = DATABASE_URL ? getSharedPgPool(DATABASE_URL) : null;
const live = Boolean(DATABASE_URL) && pool !== null;

function run(tenantId: string, over: Partial<ReportRunRecord>): ReportRunRecord {
  return {
    id: randomUUID(),
    tenantId,
    scheduleId: null,
    artifactId: null,
    reportKey: 'attendance_summary',
    format: 'csv',
    source: 'manual',
    status: 'completed',
    sha256: null,
    objectKey: null,
    sizeBytes: null,
    error: null,
    createdAt: new Date(),
    completedAt: null,
    ...over,
  };
}

async function seed() {
  const store = new PgReportStore(pool!);
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  await ensurePgTestTenant(pool!, tenantA);
  await ensurePgTestTenant(pool!, tenantB);
  const now = new Date();
  const artifact = await store.insertArtifact({
    id: randomUUID(),
    tenantId: tenantA,
    reportKey: 'attendance_summary',
    format: 'csv',
    objectKey: `reports/${tenantA}/a.csv`,
    sha256: 'a'.repeat(64),
    sizeBytes: 10,
    requestedBy: 'user-a',
    createdAt: now,
  });
  const schedule = await store.insertSchedule({
    id: randomUUID(),
    tenantId: tenantA,
    reportKey: 'attendance_summary',
    format: 'csv',
    cadence: 'daily',
    hour: 6,
    nextRunAt: now,
    recipients: [],
    enabled: true,
    createdBy: 'user-a',
    lastRunAt: null,
    createdAt: now,
    updatedAt: now,
  });
  const scheduled = await store.insertRun(
    run(tenantA, { scheduleId: schedule.id, artifactId: artifact.id, source: 'schedule' }),
  );
  const other = await store.insertRun(run(tenantA, { reportKey: 'fee_dues' }));
  return { store, tenantA, tenantB, artifact, schedule, scheduled, other };
}

describe('PRC-M631 PgReportStore tenant isolation (live Postgres)', () => {
  it.skipIf(!live)('tenant B cannot see tenant A runs or artifacts', async () => {
    const { store, tenantB, artifact, scheduled, other } = await seed();
    const bRuns = await store.listRuns(tenantB);
    expect(bRuns.map((r) => r.id)).not.toContain(scheduled.id);
    expect(bRuns.map((r) => r.id)).not.toContain(other.id);
    expect(await store.getArtifact(tenantB, artifact.id)).toBeNull();
    expect(await store.getArtifactsByIds(tenantB, [artifact.id])).toEqual([]);
    expect(await store.listArtifacts(tenantB)).toEqual([]);
  });

  it.skipIf(!live)('RLS hides tenant A rows from a raw query scoped to tenant B', async () => {
    const { tenantB, artifact, scheduled } = await seed();
    const counts = await withPgTenant(pool!, tenantB, async (client) => {
      const a = await client.query(
        `SELECT count(*)::int AS n FROM report_artifacts WHERE id = $1`,
        [artifact.id],
      );
      const r = await client.query(`SELECT count(*)::int AS n FROM report_runs WHERE id = $1`, [
        scheduled.id,
      ]);
      return [a.rows[0].n, r.rows[0].n];
    });
    expect(counts).toEqual([0, 0]);
  });

  it.skipIf(!live)(
    'tenant A batched getArtifactsByIds returns its artifact (PRC-L143 SQL)',
    async () => {
      const { store, tenantA, artifact } = await seed();
      const found = await store.getArtifactsByIds(tenantA, [artifact.id, randomUUID()]);
      expect(found.map((a) => a.id)).toEqual([artifact.id]);
      expect(found[0]!.tenantId).toBe(tenantA);
    },
  );

  it.skipIf(!live)('listRuns honours reportKey and scheduleId filters', async () => {
    const { store, tenantA, schedule, scheduled, other } = await seed();
    const byKey = await store.listRuns(tenantA, { reportKey: 'fee_dues' });
    expect(byKey.map((r) => r.id)).toEqual([other.id]);
    const bySchedule = await store.listRuns(tenantA, { scheduleId: schedule.id });
    expect(bySchedule.map((r) => r.id)).toEqual([scheduled.id]);
    const all = await store.listRuns(tenantA);
    expect(all.map((r) => r.id).sort()).toEqual([scheduled.id, other.id].sort());
  });
});
