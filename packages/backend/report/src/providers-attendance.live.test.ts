/**
 * PRC-H081 — attendance_summary against the real migrated schema.
 * student_attendance has no grade_id; the grade is derived via classes -> grades
 * and the catalogue `date` filter is honoured. Query errors are never swallowed.
 */
import { randomUUID } from 'node:crypto';
import { getSharedPgPool, withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';
import { fetchCatalogueTable } from './providers.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'providers-attendance.live.test' });
const pool = DATABASE_URL ? getSharedPgPool(DATABASE_URL) : null;
const live = Boolean(DATABASE_URL) && pool !== null;

async function seedAttendance(): Promise<{ tenantId: string }> {
  const tenantId = randomUUID();
  const areaId = randomUUID();
  const institutionId = randomUUID();
  const periodId = randomUUID();
  const gradeId = randomUUID();
  const classId = randomUUID();
  const suffix = tenantId.slice(0, 8);
  const students = [randomUUID(), randomUUID(), randomUUID()];
  await ensurePgTestTenant(pool!, tenantId);
  await withPgTenant(pool!, tenantId, async (client) => {
    await client.query(
      `INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
       VALUES ($1, $2, 'Root', 'ROOT', 0, NULL, '/', 1, 2)`,
      [areaId, tenantId],
    );
    await client.query(
      `INSERT INTO institutions (id, tenant_id, name, code, area_id, type, sector, ownership, status)
       VALUES ($1, $2, 'Report School', $3, $4, 'SCHOOL', 'PUBLIC', 'GOVERNMENT', 'active')`,
      [institutionId, tenantId, `RPT-${suffix}`, areaId],
    );
    await client.query(
      `INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date, status)
       VALUES ($1, $2, 'AY 2026-27', $3, '2026-04-01', '2027-03-31', 'active')`,
      [periodId, tenantId, `AY-${suffix}`],
    );
    await client.query(
      `INSERT INTO grades (id, tenant_id, name, code, "order")
       VALUES ($1, $2, 'Grade 8', $3, 8)`,
      [gradeId, tenantId, `G8-${suffix}`],
    );
    await client.query(
      `INSERT INTO classes (id, tenant_id, institution_id, grade_id, academic_period_id, name, capacity)
       VALUES ($1, $2, $3, $4, $5, '8-A', 40)`,
      [classId, tenantId, institutionId, gradeId, periodId],
    );
    for (const id of students) {
      await client.query(
        `INSERT INTO students (id, tenant_id, first_name, last_name, date_of_birth, gender)
         VALUES ($1, $2, 'Live', 'Student', '2012-01-01', 'female')`,
        [id, tenantId],
      );
    }
    const marks: Array<[string, string, string]> = [
      [students[0]!, '2026-06-01', 'PRESENT'],
      [students[1]!, '2026-06-01', 'ABSENT'],
      [students[2]!, '2026-06-01', 'LATE'],
      [students[0]!, '2026-06-02', 'ABSENT'],
      [students[1]!, '2026-06-02', 'ABSENT'],
    ];
    for (const [studentId, date, status] of marks) {
      await client.query(
        `INSERT INTO student_attendance
           (id, tenant_id, student_id, institution_id, class_id, academic_period_id,
            date, status, recorded_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, now())`,
        [
          randomUUID(),
          tenantId,
          studentId,
          institutionId,
          classId,
          periodId,
          date,
          status,
          randomUUID(),
        ],
      );
    }
  });
  return { tenantId };
}

describe('PRC-H081 attendance_summary (live Postgres)', () => {
  it.skipIf(!live)('returns real counts by grade (not demo values)', async () => {
    const { tenantId } = await seedAttendance();
    const table = await fetchCatalogueTable(tenantId, 'attendance_summary');
    expect(table.rows).toEqual([{ grade: 'Grade 8', present: 2, absent: 3, late: 1, tenantId }]);
  });

  it.skipIf(!live)('respects the date filter', async () => {
    const { tenantId } = await seedAttendance();
    const day1 = await fetchCatalogueTable(tenantId, 'attendance_summary', { date: '2026-06-01' });
    expect(day1.rows).toEqual([{ grade: 'Grade 8', present: 2, absent: 1, late: 1, tenantId }]);
    const none = await fetchCatalogueTable(tenantId, 'attendance_summary', { date: '2026-07-01' });
    expect(none.rows).toEqual([]);
    expect(none.columns.map((c) => c.name)).toContain('grade');
  });

  it.skipIf(!live)('rejects a malformed date filter', async () => {
    const { tenantId } = await seedAttendance();
    await expect(
      fetchCatalogueTable(tenantId, 'attendance_summary', { date: "2026-06-01' OR 1=1" }),
    ).rejects.toThrow(/date filter/);
  });
});
