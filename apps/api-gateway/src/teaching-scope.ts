/**
 * Topic 3 Option A (owner decision 2026-10-27): ownership-scoped checks.
 * Teacher -> assigned subject / section / student, learner -> enrolment.
 *
 * One Postgres directory answers the ownership questions the assessment,
 * curriculum and LMS packages ask through their own ports (PRC-M160, PRC-L274,
 * PRC-M194, PRC-M299). The sources are the same as the gradebook PRC-H066
 * check:
 *  - a principal is a staff member through `staff.user_id`;
 *  - a staff member teaches a subject through an active, unexpired
 *    `section_meetings` row with that `subject_id`;
 *  - a staff member teaches a student when the student is ENROLLED in a section
 *    whose primary teacher or active meeting teacher they are;
 *  - a learner principal is the student whose id is the principal id or whose
 *    `custom_data.user_id` is the principal id (same rule as the student portal);
 *    the learner is in a section through an ENROLLED `section_enrollments` row
 *    and in an institution through an ENROLLED `enrollments` row.
 *
 * Every query runs under the tenant GUC (RLS) and also filters `tenant_id`.
 * `::text` comparisons keep a non-UUID id from raising a cast error (it simply
 * matches nothing). Without a database there is no directory (null) and each
 * package decides: production-like environments fail closed.
 */
import { getSharedPgPool, withPgTenant, type PgQueryable } from '@proctira/database';

export interface TeachingScopeDirectory {
  teachesSubject(
    tenantId: string,
    principalIds: readonly string[],
    subjectId: string,
  ): Promise<boolean>;
  teachesStudent(
    tenantId: string,
    principalIds: readonly string[],
    studentId: string,
  ): Promise<boolean>;
  learnerInSection(tenantId: string, learnerUserId: string, sectionId: string): Promise<boolean>;
  learnerInInstitution(
    tenantId: string,
    learnerUserId: string,
    institutionId: string,
  ): Promise<boolean>;
}

type Runner = <T>(tenantId: string, fn: (db: PgQueryable) => Promise<T>) => Promise<T>;

function ids(principalIds: readonly string[]): string[] {
  return [...new Set(principalIds.filter((id) => typeof id === 'string' && id.length > 0))];
}

async function exists(db: PgQueryable, sql: string, params: unknown[]): Promise<boolean> {
  const res = await db.query(sql, params);
  return res.rows.length > 0;
}

const ACTIVE_MEETING = `sm.deleted_at IS NULL
  AND lower(sm.status) = 'active'
  AND (sm.effective_to IS NULL OR sm.effective_to >= CURRENT_DATE)`;

const LEARNER_STUDENT = `SELECT st.id FROM students st
  WHERE st.tenant_id = $1::uuid AND st.deleted_at IS NULL
    AND (st.id::text = $2 OR st.custom_data @> jsonb_build_object('user_id', $2::text))`;

export function createPgTeachingScopeDirectory(run: Runner): TeachingScopeDirectory {
  return {
    async teachesSubject(tenantId, principalIds, subjectId) {
      const principals = ids(principalIds);
      if (principals.length === 0 || !subjectId) return false;
      return run(tenantId, (db) =>
        exists(
          db,
          `SELECT 1
             FROM staff s
             JOIN section_meetings sm
               ON sm.tenant_id = s.tenant_id AND sm.teacher_staff_id = s.id
            WHERE s.tenant_id = $1::uuid
              AND s.deleted_at IS NULL
              AND s.user_id::text = ANY($2::text[])
              AND sm.subject_id::text = $3
              AND ${ACTIVE_MEETING}
            LIMIT 1`,
          [tenantId, principals, subjectId],
        ),
      );
    },

    async teachesStudent(tenantId, principalIds, studentId) {
      const principals = ids(principalIds);
      if (principals.length === 0 || !studentId) return false;
      return run(tenantId, (db) =>
        exists(
          db,
          `SELECT 1
             FROM staff s
             JOIN sections sec
               ON sec.tenant_id = s.tenant_id AND sec.deleted_at IS NULL
             JOIN section_enrollments se
               ON se.tenant_id = sec.tenant_id AND se.section_id = sec.id
              AND se.status = 'ENROLLED' AND se.student_id::text = $3
            WHERE s.tenant_id = $1::uuid
              AND s.deleted_at IS NULL
              AND s.user_id::text = ANY($2::text[])
              AND (
                sec.primary_teacher_id = s.id
                OR EXISTS (
                  SELECT 1 FROM section_meetings sm
                   WHERE sm.tenant_id = sec.tenant_id
                     AND sm.section_id = sec.id
                     AND sm.teacher_staff_id = s.id
                     AND ${ACTIVE_MEETING}
                )
              )
            LIMIT 1`,
          [tenantId, principals, studentId],
        ),
      );
    },

    async learnerInSection(tenantId, learnerUserId, sectionId) {
      if (!learnerUserId || !sectionId) return false;
      return run(tenantId, (db) =>
        exists(
          db,
          `SELECT 1 FROM section_enrollments se
            WHERE se.tenant_id = $1::uuid
              AND se.section_id::text = $3
              AND se.status = 'ENROLLED'
              AND se.student_id IN (${LEARNER_STUDENT})
            LIMIT 1`,
          [tenantId, learnerUserId, sectionId],
        ),
      );
    },

    async learnerInInstitution(tenantId, learnerUserId, institutionId) {
      if (!learnerUserId || !institutionId) return false;
      return run(tenantId, (db) =>
        exists(
          db,
          `SELECT 1 FROM enrollments e
            WHERE e.tenant_id = $1::uuid
              AND e.institution_id::text = $3
              AND e.status = 'ENROLLED'
              AND e.student_id IN (${LEARNER_STUDENT})
            LIMIT 1`,
          [tenantId, learnerUserId, institutionId],
        ),
      );
    },
  };
}

let shared: TeachingScopeDirectory | null | undefined;

/** The Postgres directory when DATABASE_URL gives a shared pool, else null. */
export function sharedTeachingScopeDirectory(): TeachingScopeDirectory | null {
  if (shared !== undefined) return shared;
  const pool = process.env.DATABASE_URL?.trim() ? getSharedPgPool() : null;
  shared = pool
    ? createPgTeachingScopeDirectory((tenantId, fn) => withPgTenant(pool, tenantId, fn))
    : null;
  return shared;
}
