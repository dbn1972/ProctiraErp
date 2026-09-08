/**
 * G-103 — raw-SQL RLS contract (unit).
 *
 * Guards the session-variable contract used by `db/sql/015_rls_policies.sql`:
 * policies read `app.tenant_id` via `current_setting('app.tenant_id', true)`.
 * Application code must bind that variable with `withPgTenant` /
 * `set_config(..., true)` before querying RLS-protected tables.
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const TABLES_WITH_RLS = [
  // health
  'counselling_sessions',
  'health_measurements',
  'health_allergies',
  'health_conditions',
  'health_vaccinations',
  'health_insurance',
  'health_screening_programs',
  // timetable / gradebook
  'board_codes',
  'grading_scales',
  'grading_scale_bands',
  'rooms',
  'bell_schedules',
  'bell_periods',
  'sections',
  'section_enrollments',
  'section_meetings',
  'substitutions',
  'credit_rules',
  'grade_entries',
  'gpa_snapshots',
  'transcript_issuances',
  'board_export_jobs',
  // notifications
  'notification_preferences',
  'notification_devices',
  'notifications',
  // transport
  'transport_routes',
  'transport_stops',
  'transport_vehicles',
  'transport_driver_assignments',
  'transport_student_assignments',
  // communication
  'comms_campaigns',
  'comms_emergency_blasts',
  // hostel
  'hostels',
  'hostel_blocks',
  'hostel_rooms',
  'hostel_beds',
  'hostel_assignments',
  'hostel_leaves',
  'hostel_visitors',
  // library
  'library_items',
  'library_loans',
  // parent
  'parent_child_links',
  'parent_message_threads',
  'parent_messages',
  'parent_consents',
  'parent_fee_invoices',
  'parent_fee_payments',
  // fees
  'parent_fee_plans',
  'parent_fee_receipts',
  // hr leave
  'staff_leave_requests',
  // admissions
  'admission_applications',
  'admission_waitlist_entries',
  'admission_interview_slots',
  'admission_interview_bookings',
] as const;

/**
 * Wave 8 / G-801 / G-805 — LMS tables ship their RLS policies inside the domain
 * schema file (created after 015 ran) and FORCE RLS so the owning role cannot
 * bypass tenant isolation. Board vs. school visibility is enforced in
 * `LmsService` on top of this tenant boundary — never instead of it.
 */
const LMS_TABLES_WITH_RLS = [
  'lms_skills',
  'lms_assignments',
  'lms_quiz_questions',
  'lms_submissions',
  'lms_skill_mastery',
  'lms_practice_attempts',
] as const;

function loadSql(file: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, `../../../../db/sql/${file}`),
    join(process.cwd(), `db/sql/${file}`),
    join(process.cwd(), `../../db/sql/${file}`),
  ];
  for (const path of candidates) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      // try next
    }
  }
  throw new Error(`Could not locate db/sql/${file}`);
}

const loadRlsSql = (): string => loadSql('015_rls_policies.sql');

describe('G-103 raw-SQL RLS policies (015_rls_policies.sql)', () => {
  it('enables RLS and tenant_isolation policy using app.tenant_id for all domain tables', () => {
    const sql = loadRlsSql();

    expect(sql).toContain("current_setting('app.tenant_id', true)");
    expect(sql).toContain('withPgTenant');

    for (const table of TABLES_WITH_RLS) {
      expect(sql, `missing ENABLE RLS for ${table}`).toMatch(
        new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`),
      );
      expect(sql, `missing tenant_isolation policy for ${table}`).toMatch(
        new RegExp(`CREATE POLICY tenant_isolation ON ${table}`),
      );
    }
  });
});

describe('Wave 8 LMS raw-SQL RLS (026_lms_schema.sql)', () => {
  const sql = loadSql('026_lms_schema.sql');

  it('every LMS table enables + forces RLS with the tenant_isolation policy', () => {
    for (const table of LMS_TABLES_WITH_RLS) {
      expect(sql, `missing ENABLE RLS for ${table}`).toMatch(
        new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`),
      );
      expect(sql, `missing FORCE RLS for ${table}`).toMatch(
        new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`),
      );
      expect(sql, `missing tenant_isolation policy for ${table}`).toMatch(
        new RegExp(`CREATE POLICY tenant_isolation ON ${table}`),
      );
    }
  });

  it('policies use the app.tenant_id session contract for both USING and WITH CHECK', () => {
    const policies = sql.match(/CREATE POLICY tenant_isolation ON lms_[a-z_]+[\s\S]*?;/g) ?? [];
    expect(policies).toHaveLength(LMS_TABLES_WITH_RLS.length);
    for (const policy of policies) {
      expect(policy).toMatch(/USING \(tenant_id::text = NULLIF\(current_setting\('app.tenant_id', true\), ''\)\)/);
      expect(policy).toMatch(/WITH CHECK \(tenant_id::text = NULLIF\(current_setting\('app.tenant_id', true\), ''\)\)/);
    }
  });

  it('every LMS table carries tenant_id and scoped tables carry the board|school target check', () => {
    for (const table of LMS_TABLES_WITH_RLS) {
      const ddl = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`));
      expect(ddl, `missing CREATE TABLE for ${table}`).not.toBeNull();
      expect(ddl?.[1]).toMatch(/tenant_id UUID NOT NULL/);
    }
    for (const scoped of ['lms_skills', 'lms_assignments']) {
      expect(sql).toMatch(new RegExp(`CONSTRAINT ${scoped}_scope_target CHECK`));
    }
  });
});
