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

function loadRlsSql(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../db/sql/015_rls_policies.sql'),
    join(process.cwd(), 'db/sql/015_rls_policies.sql'),
    join(process.cwd(), '../../db/sql/015_rls_policies.sql'),
  ];
  for (const path of candidates) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      // try next
    }
  }
  throw new Error('Could not locate db/sql/015_rls_policies.sql');
}

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
