/**
 * PRC-H036 — PgReportCardDirectory against the migrated schema under RLS.
 */
import { randomUUID } from 'node:crypto';
import { getSharedPgPool, withPgTenant } from '@proctira/database';
import { ensurePgTestStudent, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';
import { PgReportCardDirectory } from './report-card-directory.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'report-card-directory.live.test' });
const pool = DATABASE_URL ? getSharedPgPool(DATABASE_URL) : null;
const live = Boolean(DATABASE_URL) && pool !== null;

describe('PRC-H036 PgReportCardDirectory (live Postgres)', () => {
  it.skipIf(!live)('resolves names in-tenant and hides other tenants', async () => {
    const tenantId = randomUUID();
    const otherTenant = randomUUID();
    const studentId = randomUUID();
    const subjectId = randomUUID();
    const periodId = randomUUID();
    await ensurePgTestStudent(pool!, tenantId, studentId);
    await ensurePgTestTenant(pool!, otherTenant);
    await withPgTenant(pool!, tenantId, async (c) => {
      await c.query(
        `INSERT INTO subjects (id, tenant_id, name, code) VALUES ($1, $2, 'Mathematics', $3)`,
        [subjectId, tenantId, `MATH-${tenantId.slice(0, 8)}`],
      );
      await c.query(
        `INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date, status)
         VALUES ($1, $2, 'Term 1', $3, '2026-04-01', '2026-09-30', 'active')`,
        [periodId, tenantId, `T1-${tenantId.slice(0, 8)}`],
      );
    });
    const dir = new PgReportCardDirectory(pool!);
    expect(await dir.findStudentName(tenantId, studentId)).toBe('Test Student');
    expect(await dir.findSubjectNames(tenantId, [subjectId, randomUUID()])).toEqual(
      new Map([[subjectId, 'Mathematics']]),
    );
    expect(await dir.findAcademicPeriodName(tenantId, periodId)).toBe('Term 1');
    expect(await dir.findStudentName(otherTenant, studentId)).toBeNull();
    expect(await dir.findStudentName(tenantId, randomUUID())).toBeNull();
  });
});
