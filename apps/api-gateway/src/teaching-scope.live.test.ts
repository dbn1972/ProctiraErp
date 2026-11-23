/**
 * PRC-M160 / PRC-L274 / PRC-M194 / PRC-M299: the teaching-scope directory's
 * SQL against real Postgres, as the non-owner runtime role (RLS enforced).
 * Skipped without DATABASE_URL (required in CI).
 */
import { randomUUID } from 'node:crypto';

import { withPgTenant } from '@proctira/database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPgTeachingScopeDirectory, type TeachingScopeDirectory } from './teaching-scope.js';

const liveTestsRequired =
  process.env.ALLOW_LIVE_TEST_SKIP !== '1' &&
  (process.env.REQUIRE_LIVE_TESTS === '1' || process.env.CI === 'true' || process.env.CI === '1');
const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL && liveTestsRequired) {
  throw new Error('[W3-TEST-03] teaching-scope.live.test has no DATABASE_URL');
}
const pool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 4 }) : null;

describe.skipIf(!pool)('teaching-scope directory (live)', () => {
  const tenant = randomUUID();
  const otherTenant = randomUUID();
  const suffix = tenant.slice(0, 8);
  const ids = {
    area: randomUUID(),
    institution: randomUUID(),
    otherInstitution: randomUUID(),
    period: randomUUID(),
    grade: randomUUID(),
    klass: randomUUID(),
    maths: randomUUID(),
    history: randomUUID(),
    teacherStaff: randomUUID(),
    teacherUser: randomUUID(),
    formTutorStaff: randomUUID(),
    formTutorUser: randomUUID(),
    exTeacherStaff: randomUUID(),
    exTeacherUser: randomUUID(),
    schedule: randomUUID(),
    bell: randomUUID(),
    section: randomUUID(),
    otherSection: randomUUID(),
    pupil: randomUUID(),
    pupilUser: randomUUID(),
    otherPupil: randomUUID(),
  };
  let directory: TeachingScopeDirectory;

  beforeAll(async () => {
    directory = createPgTeachingScopeDirectory((tenantId, fn) => withPgTenant(pool!, tenantId, fn));
    for (const t of [tenant, otherTenant]) {
      await withPgTenant(pool!, t, (c) =>
        c.query(
          `INSERT INTO tenants (id, name, slug, config, status)
           VALUES ($1::uuid, $2, $3, '{}'::jsonb, 'active') ON CONFLICT (id) DO NOTHING`,
          [t, `Scope ${t.slice(0, 8)}`, `scope-${t}`],
        ),
      );
    }
    await withPgTenant(pool!, tenant, async (c) => {
      const q = (sql: string, params: unknown[]) => c.query(sql, params);
      await q(
        `INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
         VALUES ($1, $2, 'Root', $3, 0, NULL, '/', 1, 2)`,
        [ids.area, tenant, `R-${suffix}`],
      );
      for (const [id, code] of [
        [ids.institution, `S1-${suffix}`],
        [ids.otherInstitution, `S2-${suffix}`],
      ]) {
        await q(
          `INSERT INTO institutions (id, tenant_id, name, code, area_id, type, sector, ownership, status)
           VALUES ($1, $2, $3, $3, $4, 'SCHOOL', 'PUBLIC', 'GOVERNMENT', 'active')`,
          [id, tenant, code, ids.area],
        );
      }
      await q(
        `INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date, status)
         VALUES ($1, $2, 'AY', $3, '2026-04-01', '2027-03-31', 'active')`,
        [ids.period, tenant, `AY-${suffix}`],
      );
      await q(
        `INSERT INTO grades (id, tenant_id, name, code, "order") VALUES ($1, $2, 'G8', $3, 8)`,
        [ids.grade, tenant, `G8-${suffix}`],
      );
      for (const [id, code] of [
        [ids.maths, `MA-${suffix}`],
        [ids.history, `HI-${suffix}`],
      ]) {
        await q(`INSERT INTO subjects (id, tenant_id, name, code) VALUES ($1, $2, $3, $3)`, [
          id,
          tenant,
          code,
        ]);
      }
      for (const [id, user, n] of [
        [ids.teacherStaff, ids.teacherUser, 'T'],
        [ids.formTutorStaff, ids.formTutorUser, 'F'],
        [ids.exTeacherStaff, ids.exTeacherUser, 'X'],
      ]) {
        await q(
          `INSERT INTO staff (id, tenant_id, first_name, last_name, date_of_birth, identity_number, user_id)
           VALUES ($1, $2, $3, 'Staff', '1980-01-01', $4, $5)`,
          [id, tenant, n, `${n}-${suffix}`, user],
        );
      }
      await q(
        `INSERT INTO bell_schedules (id, tenant_id, institution_id, academic_period_id, code, name)
         VALUES ($1, $2, $3, $4, $5, 'Main')`,
        [ids.schedule, tenant, ids.institution, ids.period, `BS-${suffix}`],
      );
      await q(
        `INSERT INTO bell_periods (id, tenant_id, bell_schedule_id, code, name, period_order, start_time, end_time)
         VALUES ($1, $2, $3, 'P1', 'Period 1', 1, '09:00', '09:45')`,
        [ids.bell, tenant, ids.schedule],
      );
      for (const [id, code, tutor] of [
        [ids.section, `8A-${suffix}`, ids.formTutorStaff],
        [ids.otherSection, `8B-${suffix}`, null],
      ]) {
        await q(
          `INSERT INTO sections (id, tenant_id, institution_id, academic_period_id, grade_id, code, name, primary_teacher_id)
           VALUES ($1, $2, $3, $4, $5, $6, $6, $7)`,
          [id, tenant, ids.institution, ids.period, ids.grade, code, tutor],
        );
      }
      // The teacher teaches maths to 8A on Monday; the ex-teacher's meeting ended.
      await q(
        `INSERT INTO section_meetings (tenant_id, section_id, bell_period_id, day_of_week, teacher_staff_id, subject_id, status)
         VALUES ($1, $2, $3, 1, $4, $5, 'active')`,
        [tenant, ids.section, ids.bell, ids.teacherStaff, ids.maths],
      );
      await q(
        `INSERT INTO section_meetings (tenant_id, section_id, bell_period_id, day_of_week, teacher_staff_id, subject_id, status, effective_from, effective_to)
         VALUES ($1, $2, $3, 2, $4, $5, 'active', '2020-01-01', '2020-06-30')`,
        [tenant, ids.section, ids.bell, ids.exTeacherStaff, ids.history],
      );
      for (const [id, custom] of [
        [ids.pupil, JSON.stringify({ user_id: ids.pupilUser })],
        [ids.otherPupil, '{}'],
      ]) {
        await q(
          `INSERT INTO students (id, tenant_id, first_name, last_name, date_of_birth, gender, custom_data)
           VALUES ($1, $2, 'Pupil', 'One', '2012-01-01', 'female', $3::jsonb)`,
          [id, tenant, custom],
        );
      }
      await q(
        `INSERT INTO section_enrollments (tenant_id, section_id, student_id, status)
         VALUES ($1, $2, $3, 'ENROLLED'), ($1, $4, $5, 'ENROLLED')`,
        [tenant, ids.section, ids.pupil, ids.otherSection, ids.otherPupil],
      );
      await q(
        `INSERT INTO classes (id, tenant_id, institution_id, grade_id, academic_period_id, name, capacity)
         VALUES ($1, $2, $3, $4, $5, '8-A', 40)`,
        [ids.klass, tenant, ids.institution, ids.grade, ids.period],
      );
      await q(
        `INSERT INTO enrollments (id, tenant_id, student_id, institution_id, grade_id, class_id, academic_period_id, status, enrolled_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ENROLLED', '2026-04-01')`,
        [randomUUID(), tenant, ids.pupil, ids.institution, ids.grade, ids.klass, ids.period],
      );
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('teachesSubject: active meeting teacher only; ended meetings and other tenants do not count', async () => {
    expect(await directory.teachesSubject(tenant, [ids.teacherUser], ids.maths)).toBe(true);
    expect(await directory.teachesSubject(tenant, [ids.teacherUser], ids.history)).toBe(false);
    expect(await directory.teachesSubject(tenant, [ids.exTeacherUser], ids.history)).toBe(false);
    expect(await directory.teachesSubject(otherTenant, [ids.teacherUser], ids.maths)).toBe(false);
    expect(await directory.teachesSubject(tenant, ['not-a-uuid'], ids.maths)).toBe(false);
  });

  it('teachesStudent: meeting teacher or primary teacher of an ENROLLED section', async () => {
    expect(await directory.teachesStudent(tenant, [ids.teacherUser], ids.pupil)).toBe(true);
    expect(await directory.teachesStudent(tenant, [ids.formTutorUser], ids.pupil)).toBe(true);
    expect(await directory.teachesStudent(tenant, [ids.teacherUser], ids.otherPupil)).toBe(false);
    expect(await directory.teachesStudent(tenant, [ids.exTeacherUser], ids.pupil)).toBe(false);
    expect(await directory.teachesStudent(otherTenant, [ids.teacherUser], ids.pupil)).toBe(false);
  });

  it('learner lookups resolve the student by id or custom_data.user_id', async () => {
    expect(await directory.studentIdsForLearner(tenant, ids.pupilUser)).toEqual([ids.pupil]);
    expect(await directory.studentIdsForLearner(tenant, ids.pupil)).toEqual([ids.pupil]);
    expect(await directory.studentIdsForLearner(otherTenant, ids.pupilUser)).toEqual([]);
    expect(await directory.learnerInSection(tenant, ids.pupilUser, ids.section)).toBe(true);
    expect(await directory.learnerInSection(tenant, ids.pupilUser, ids.otherSection)).toBe(false);
    expect(await directory.learnerInInstitution(tenant, ids.pupilUser, ids.institution)).toBe(true);
    expect(await directory.learnerInInstitution(tenant, ids.pupilUser, ids.otherInstitution)).toBe(
      false,
    );
    expect(await directory.learnerInInstitution(tenant, ids.otherPupil, ids.institution)).toBe(
      false,
    );
  });
});
