import { execFileSync } from 'node:child_process';
const SUNRISE = '00000000-0000-4000-8000-00000000a501';

/**
 * Each Sunrise live spec cleans only the rows it writes. `fullyParallel` runs
 * these specs (and each test's beforeAll/afterAll) in concurrent workers, so a
 * shared "delete every E2E row" sweep from one spec deleted another spec's
 * in-flight rows — e.g. the timetable spec's afterAll removed the tabs spec's
 * grade entry between "Unpublish" and the post-reload "Draft" check.
 */
export type SunriseE2EScope = 'gradebook' | 'curriculum' | 'infrastructure' | 'timetable';

const SCOPE_SQL: Record<SunriseE2EScope, string> = {
  gradebook: `
ALTER TABLE grade_change_audit DISABLE TRIGGER trg_grade_change_audit_append_only;
DELETE FROM grade_change_audit
 WHERE grade_entry_id IN (
   SELECT id FROM grade_entries
    WHERE tenant_id = '${SUNRISE}' AND assessment_code LIKE 'E2E%'
 );
DELETE FROM grade_entries
 WHERE tenant_id = '${SUNRISE}' AND assessment_code LIKE 'E2E%';
ALTER TABLE grade_change_audit ENABLE TRIGGER trg_grade_change_audit_append_only;`,
  curriculum: `
DELETE FROM lesson_plans
 WHERE tenant_id = '${SUNRISE}' AND title LIKE 'E2E lesson %';
DELETE FROM learning_outcomes
 WHERE tenant_id = '${SUNRISE}' AND statement = 'E2E outcome statement';`,
  // The migrator role is required because institution_repair_requests is
  // append-only for the app role.
  infrastructure: `
DELETE FROM institution_repair_requests
 WHERE tenant_id = '${SUNRISE}' AND summary LIKE 'E2E %';
DELETE FROM institution_infrastructure
 WHERE tenant_id = '${SUNRISE}' AND name LIKE 'E2E Room %';`,
  // The Monday P1 Hindi meeting the timetable spec adds.
  timetable: `
DELETE FROM section_meetings
 WHERE tenant_id = '${SUNRISE}'
   AND section_id = uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-hin')
   AND day_of_week = 1
   AND bell_period_id = uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-period-mv-1');`,
};

export function cleanupSunriseE2E(scope: SunriseE2EScope): void {
  const url = process.env.MIGRATOR_DATABASE_URL;
  if (!url) return;
  const sql = `
BEGIN;
SELECT set_config('app.tenant_id', '${SUNRISE}', true);
${SCOPE_SQL[scope]}
COMMIT;
`;
  execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: 'inherit' });
}
