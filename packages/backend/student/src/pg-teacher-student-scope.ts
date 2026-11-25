/**
 * PRC-M121: Postgres teacher → taught-students lookup for discipline access.
 *
 * A principal teaches a student when staff linked to the principal (`staff.user_id`, 098) is the
 * primary teacher, or teaches an active non-expired meeting, of a section the student is
 * currently enrolled in (section_enrollments status ENROLLED). Same teacher rule as the gradebook
 * PRC-H066 section scope. Runs with the tenant GUC bound so RLS applies; `::text` comparisons
 * keep a non-UUID id from raising (it matches nothing). Query errors propagate so the route
 * fails closed.
 */
import { withPgTenant, type PgPoolWithConnect, type PgQueryable } from '@proctira/database';

import type { TeacherStudentScope } from './student-portal-access.js';

export function createPgTeacherStudentScope(
  pool: PgPoolWithConnect | PgQueryable,
): TeacherStudentScope {
  return {
    async teachesStudent(tenantId, principalIds, studentId) {
      const ids = [
        ...new Set(principalIds.filter((id) => typeof id === 'string' && id.length > 0)),
      ];
      if (ids.length === 0 || !studentId) return false;
      const result = await withPgTenant(pool, tenantId, (client) =>
        client.query(
          `SELECT 1
             FROM section_enrollments se
             JOIN sections s
               ON s.tenant_id = se.tenant_id AND s.id = se.section_id AND s.deleted_at IS NULL
             JOIN staff st
               ON st.tenant_id = s.tenant_id AND st.deleted_at IS NULL
              AND st.user_id IS NOT NULL AND st.user_id::text = ANY($3::text[])
            WHERE se.tenant_id::text = $1
              AND se.student_id::text = $2
              AND se.status = 'ENROLLED'
              AND (
                s.primary_teacher_id = st.id
                OR EXISTS (
                  SELECT 1 FROM section_meetings sm
                   WHERE sm.tenant_id = s.tenant_id
                     AND sm.section_id = s.id
                     AND sm.teacher_staff_id = st.id
                     AND sm.deleted_at IS NULL
                     AND lower(sm.status) = 'active'
                     AND (sm.effective_to IS NULL OR sm.effective_to >= CURRENT_DATE)
                )
              )
            LIMIT 1`,
          [tenantId, studentId, ids],
        ),
      );
      return result.rows.length > 0;
    },
  };
}
