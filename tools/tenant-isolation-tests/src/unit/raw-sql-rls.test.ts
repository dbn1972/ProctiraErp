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
      expect(policy).toMatch(
        /USING \(tenant_id::text = NULLIF\(current_setting\('app.tenant_id', true\), ''\)\)/,
      );
      expect(policy).toMatch(
        /WITH CHECK \(tenant_id::text = NULLIF\(current_setting\('app.tenant_id', true\), ''\)\)/,
      );
    }
  });

  it('every LMS table carries tenant_id and scoped tables carry the board|school target check', () => {
    for (const table of LMS_TABLES_WITH_RLS) {
      const ddl = sql.match(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`),
      );
      expect(ddl, `missing CREATE TABLE for ${table}`).not.toBeNull();
      expect(ddl?.[1]).toMatch(/tenant_id UUID NOT NULL/);
    }
    for (const scoped of ['lms_skills', 'lms_assignments']) {
      expect(sql).toMatch(new RegExp(`CONSTRAINT ${scoped}_scope_target CHECK`));
    }
  });
});

describe('Wave 9 institution infrastructure raw-SQL RLS (027_institution_infrastructure_schema.sql)', () => {
  const sql = loadSql('027_institution_infrastructure_schema.sql');
  const tables = ['institution_infrastructure', 'institution_condition_options'];

  it('every infrastructure table enables + forces RLS with the tenant_isolation policy', () => {
    for (const table of tables) {
      expect(sql, `missing ENABLE RLS for ${table}`).toMatch(
        new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`),
      );
      expect(sql, `missing FORCE RLS for ${table}`).toMatch(
        new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`),
      );
      expect(sql, `missing tenant_isolation policy for ${table}`).toMatch(
        new RegExp(`CREATE POLICY tenant_isolation ON ${table}`),
      );
      const ddl = sql.match(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`),
      );
      expect(ddl, `missing CREATE TABLE for ${table}`).not.toBeNull();
      expect(ddl?.[1]).toMatch(/tenant_id UUID NOT NULL/);
    }
  });
});

describe('Wave 9 audit hash chain raw-SQL RLS (028_audit_hash_chain.sql)', () => {
  const sql = loadSql('028_audit_hash_chain.sql');

  it('audit_chain_heads enables + forces RLS with the tenant_isolation / platform_admin policy', () => {
    expect(sql).toMatch(/ALTER TABLE audit_chain_heads ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE audit_chain_heads FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/CREATE POLICY tenant_isolation ON audit_chain_heads/);
    expect(sql).toMatch(/current_setting\('app\.platform_admin', true\) = '1'/);
  });

  it('adds chain columns to both the active and archive audit tables', () => {
    for (const table of ['audit_log_entries', 'audit_log_archive']) {
      const alter = sql.match(new RegExp(`ALTER TABLE ${table}\\s+([\\s\\S]*?);`));
      expect(alter, `missing ALTER TABLE for ${table}`).not.toBeNull();
      for (const col of ['chain_seq', 'prev_hash', 'entry_hash']) {
        expect(alter?.[1]).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}`));
      }
    }
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS audit_log_entries_tenant_chain_seq_idx/);
  });
});

describe('Wave 9 classes / subjects raw-SQL RLS (029_academics_classes_subjects_schema.sql)', () => {
  const sql = loadSql('029_academics_classes_subjects_schema.sql');

  it('creates the three Prisma-mapped tables with tenant_id and forces RLS on each', () => {
    for (const table of ['classes', 'subjects', 'institution_subjects']) {
      const ddl = sql.match(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`),
      );
      expect(ddl, `missing CREATE TABLE for ${table}`).not.toBeNull();
      expect(ddl?.[1]).toMatch(/tenant_id\s+UUID NOT NULL REFERENCES tenants\(id\)/);
      expect(sql).toMatch(new RegExp(`'${table}'`));
    }
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/CREATE POLICY tenant_isolation ON %I/);
  });
});

describe('Wave 9 academic calendar raw-SQL RLS (030_academic_calendar_schema.sql)', () => {
  const sql = loadSql('030_academic_calendar_schema.sql');

  it('adds the hierarchy columns idempotently and forces RLS on calendar events', () => {
    expect(sql).toMatch(/ALTER TABLE academic_periods\s+ADD COLUMN IF NOT EXISTS kind/);
    expect(sql).toMatch(/ALTER TABLE academic_periods\s+ADD COLUMN IF NOT EXISTS parent_id UUID/);
    const ddl = sql.match(/CREATE TABLE IF NOT EXISTS academic_calendar_events \(([\s\S]*?)\n\);/);
    expect(ddl).not.toBeNull();
    expect(ddl?.[1]).toMatch(/tenant_id UUID NOT NULL/);
    expect(ddl?.[1]).toMatch(/CHECK \(end_date >= start_date\)/);
    expect(sql).toMatch(/ALTER TABLE academic_calendar_events ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE academic_calendar_events FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(
      /CREATE POLICY tenant_isolation ON academic_calendar_events[\s\S]*?USING \(tenant_id::text = NULLIF\(current_setting\('app\.tenant_id', true\), ''\)\)[\s\S]*?WITH CHECK \(tenant_id::text = NULLIF\(current_setting\('app\.tenant_id', true\), ''\)\)/,
    );
  });
});

const GRADEBOOK_032_TABLES = [
  'grade_change_audit',
  'comments_bank',
  'class_rank_snapshots',
] as const;

describe('Wave 9 gradebook rank/comments/audit raw-SQL RLS (032_gradebook_rank_comments_audit_schema.sql)', () => {
  const sql = loadSql('032_gradebook_rank_comments_audit_schema.sql');

  it('adds published_at and forces RLS on audit, comments bank, and rank snapshots', () => {
    expect(sql).toMatch(/ALTER TABLE grade_entries\s+ADD COLUMN IF NOT EXISTS published_at/);
    for (const table of GRADEBOOK_032_TABLES) {
      const ddl = sql.match(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`),
      );
      expect(ddl, `missing CREATE TABLE for ${table}`).not.toBeNull();
      expect(ddl?.[1]).toMatch(/tenant_id UUID NOT NULL/);
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
      expect(sql).toMatch(
        new RegExp(
          `CREATE POLICY tenant_isolation ON ${table}[\\s\\S]*?USING \\(tenant_id::text = NULLIF\\(current_setting\\('app\\.tenant_id', true\\), ''\\)\\)[\\s\\S]*?WITH CHECK \\(tenant_id::text = NULLIF\\(current_setting\\('app\\.tenant_id', true\\), ''\\)\\)`,
        ),
      );
    }
  });
});

const CURRICULUM_033_TABLES = [
  'syllabus_units',
  'lesson_plans',
  'learning_outcomes',
  'unit_coverage',
] as const;

describe('Wave 9 curriculum raw-SQL RLS (033_curriculum_schema.sql)', () => {
  const sql = loadSql('033_curriculum_schema.sql');

  it('creates syllabus/lesson/outcome/coverage tables with tenant_id and forces RLS on each', () => {
    for (const table of CURRICULUM_033_TABLES) {
      const ddl = sql.match(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`),
      );
      expect(ddl, `missing CREATE TABLE for ${table}`).not.toBeNull();
      expect(ddl?.[1]).toMatch(/tenant_id UUID NOT NULL/);
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
      expect(sql).toMatch(
        new RegExp(
          `CREATE POLICY tenant_isolation ON ${table}[\\s\\S]*?USING \\(tenant_id::text = NULLIF\\(current_setting\\('app\\.tenant_id', true\\), ''\\)\\)[\\s\\S]*?WITH CHECK \\(tenant_id::text = NULLIF\\(current_setting\\('app\\.tenant_id', true\\), ''\\)\\)`,
        ),
      );
    }
  });
});

const ADMISSIONS_CRM_TABLES = [
  'admission_enquiries',
  'enquiry_followups',
  'seat_matrix',
  'merit_lists',
  'merit_list_entries',
  'admission_offers',
] as const;

describe('Wave 9 admissions CRM raw-SQL RLS (034_admissions_crm_schema.sql)', () => {
  const sql = loadSql('034_admissions_crm_schema.sql');

  it('creates enquiry/seat/merit/offer tables with tenant_id and forces RLS on each', () => {
    for (const table of ADMISSIONS_CRM_TABLES) {
      const ddl = sql.match(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`),
      );
      expect(ddl, `missing CREATE TABLE for ${table}`).not.toBeNull();
      expect(ddl?.[1]).toMatch(/tenant_id UUID NOT NULL/);
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
      expect(sql).toMatch(
        new RegExp(
          `CREATE POLICY tenant_isolation ON ${table}[\\s\\S]*?USING \\(tenant_id::text = NULLIF\\(current_setting\\('app\\.tenant_id', true\\), ''\\)\\)[\\s\\S]*?WITH CHECK \\(tenant_id::text = NULLIF\\(current_setting\\('app\\.tenant_id', true\\), ''\\)\\)`,
        ),
      );
    }
  });
});

describe('Wave 9 fee structures raw-SQL RLS (031_fees_structures_schema.sql)', () => {
  const sql = loadSql('031_fees_structures_schema.sql');

  it('creates structure / concession / refund / reconciliation tables with tenant_id and forces RLS on each', () => {
    for (const table of [
      'fee_structures',
      'fee_structure_components',
      'fee_structure_instalments',
      'fee_concessions',
      'fee_refunds',
      'fee_reconciliation_batches',
      'fee_reconciliation_rows',
    ]) {
      const ddl = sql.match(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`),
      );
      expect(ddl, `missing CREATE TABLE for ${table}`).not.toBeNull();
      expect(ddl?.[1]).toMatch(/tenant_id UUID NOT NULL/);
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
      expect(sql).toMatch(
        new RegExp(
          `CREATE POLICY tenant_isolation ON ${table}[\\s\\S]*?USING \\(tenant_id::text = NULLIF\\(current_setting\\('app\\.tenant_id', true\\), ''\\)\\)[\\s\\S]*?WITH CHECK \\(tenant_id::text = NULLIF\\(current_setting\\('app\\.tenant_id', true\\), ''\\)\\)`,
        ),
      );
    }
    expect(sql).toMatch(
      /ALTER TABLE parent_fee_invoices\s+ADD COLUMN IF NOT EXISTS invoice_number TEXT/,
    );
    expect(sql).toMatch(
      /ALTER TABLE parent_fee_invoices\s+ADD COLUMN IF NOT EXISTS structure_id UUID/,
    );
  });
});

describe('Wave 9 examination ops raw-SQL RLS (036_examination_ops_schema.sql)', () => {
  const sql = loadSql('036_examination_ops_schema.sql');
  const tables = [
    'exam_sessions',
    'exam_invigilators',
    'exam_seating',
    'exam_marks_entries',
    'exam_reevaluation_requests',
  ] as const;

  it('every exam-ops table enables + forces RLS with the tenant_isolation policy', () => {
    for (const table of tables) {
      expect(sql, `missing ENABLE RLS for ${table}`).toMatch(
        new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`),
      );
      expect(sql, `missing FORCE RLS for ${table}`).toMatch(
        new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`),
      );
      expect(sql, `missing tenant_isolation policy for ${table}`).toMatch(
        new RegExp(`CREATE POLICY tenant_isolation ON ${table}`),
      );
      const ddl = sql.match(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`),
      );
      expect(ddl, `missing CREATE TABLE for ${table}`).not.toBeNull();
      expect(ddl?.[1]).toMatch(/tenant_id UUID NOT NULL/);
    }
  });

  it('policies use the app.tenant_id session contract for both USING and WITH CHECK', () => {
    const policies =
      sql.match(/CREATE POLICY tenant_isolation ON exam_[a-z_]+[\s\S]*?;/g) ?? [];
    expect(policies).toHaveLength(tables.length);
    for (const policy of policies) {
      expect(policy).toMatch(
        /USING \(tenant_id::text = NULLIF\(current_setting\('app.tenant_id', true\), ''\)\)/,
      );
      expect(policy).toMatch(
        /WITH CHECK \(tenant_id::text = NULLIF\(current_setting\('app.tenant_id', true\), ''\)\)/,
      );
    }
  });
});

describe('Wave 9 students 360 raw-SQL RLS (035_students_360_schema.sql)', () => {
  const sql = loadSql('035_students_360_schema.sql');
  const tables = [
    'student_photos',
    'student_siblings',
    'student_consents',
    'student_discipline_incidents',
  ] as const;

  it('creates the four 360 tables with tenant_id and forces RLS on each', () => {
    for (const table of tables) {
      const ddl = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`));
      expect(ddl, `missing CREATE TABLE for ${table}`).not.toBeNull();
      expect(ddl?.[1]).toMatch(/tenant_id UUID NOT NULL/);
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
      expect(sql).toMatch(new RegExp(`CREATE POLICY tenant_isolation ON ${table}`));
      expect(sql).toMatch(
        /USING \(tenant_id::text = NULLIF\(current_setting\('app\.tenant_id', true\), ''\)\)/,
      );
      expect(sql).toMatch(
        /WITH CHECK \(tenant_id::text = NULLIF\(current_setting\('app\.tenant_id', true\), ''\)\)/,
      );
    }
  });
});

describe('Wave 9 LMS depth raw-SQL RLS (038_lms_depth_schema.sql)', () => {
  const sql = loadSql('038_lms_depth_schema.sql');
  const tables = [
    'lms_question_bank',
    'lms_rubrics',
    'lms_rubric_criteria',
    'lms_rubric_scores',
    'lms_assignment_files',
    'lms_discussions',
    'lms_discussion_posts',
    'lms_lessons',
    'lms_lesson_resources',
  ] as const;

  it('every LMS-depth table enables + forces RLS with the tenant_isolation policy', () => {
    for (const table of tables) {
      expect(sql, `missing ENABLE RLS for ${table}`).toMatch(
        new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`),
      );
      expect(sql, `missing FORCE RLS for ${table}`).toMatch(
        new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`),
      );
      expect(sql, `missing tenant_isolation policy for ${table}`).toMatch(
        new RegExp(`CREATE POLICY tenant_isolation ON ${table}`),
      );
      const ddl = sql.match(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`),
      );
      expect(ddl, `missing CREATE TABLE for ${table}`).not.toBeNull();
      expect(ddl?.[1]).toMatch(/tenant_id UUID NOT NULL/);
    }
  });

  it('policies use the app.tenant_id session contract for both USING and WITH CHECK', () => {
    const policies =
      sql.match(/CREATE POLICY tenant_isolation ON lms_(question_bank|rubrics|rubric_criteria|rubric_scores|assignment_files|discussions|discussion_posts|lessons|lesson_resources)[\s\S]*?;/g) ??
      [];
    expect(policies).toHaveLength(tables.length);
    for (const policy of policies) {
      expect(policy).toMatch(
        /USING \(tenant_id::text = NULLIF\(current_setting\('app.tenant_id', true\), ''\)\)/,
      );
      expect(policy).toMatch(
        /WITH CHECK \(tenant_id::text = NULLIF\(current_setting\('app.tenant_id', true\), ''\)\)/,
      );
    }
  });
});
