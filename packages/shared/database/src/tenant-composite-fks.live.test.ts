/**
 * PRC-M195 / PRC-M208 / PRC-L095 / PRC-M548 / PRC-L289 — live Postgres proof
 * that a child row can no longer reference another tenant's parent row.
 *
 * Before db/sql/254-256: every FK into students / staff / fee_structures /
 * parent_fee_invoices / classes / subjects (and the other parents) was
 * id-only. The RI check runs as the table owner without RLS, so a tenant-A row
 * pointing at a tenant-B parent id was accepted (RED: these inserts succeed).
 * After: the composite (tenant_id, <fk>) -> parent (tenant_id, id) twins reject
 * it with 23503 naming the `<child>_<col>_tenant_fk` constraint (GREEN), while
 * the same-tenant control insert still succeeds.
 *
 * Every probe runs as the runtime role (proctira_app, RLS enforced) inside a
 * transaction that is always rolled back, so RED runs leave no rows behind.
 */
import { randomUUID } from 'node:crypto';

import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withPgTenant } from './pg-tenant.js';
import { bindTenantGuc } from './tenant-guc.js';
import { ensurePgTestStaff, ensurePgTestStudent, ensurePgTestTenant } from './test-fixtures.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'tenant-composite-fks.live.test' });

/** Child tables owned by other lanes; their composite twins are a later wave (255 NOTICEs). */
const EXCLUDED_CHILDREN = [
  'admission_enquiries',
  'admission_applications',
  'control_plane_documents',
  'transport_driver_assignments',
  'transport_student_assignments',
  'transport_vehicles',
  'transport_routes',
  'transport_stops',
  'transport_gps_pings',
  'transport_bus_attendance',
  'transport_vehicle_devices',
  'exam_sessions',
  'library_items',
  'library_loans',
  'library_fines',
  'report_card_jobs',
  'section_meetings',
  'bell_periods',
  'grading_schemes',
  'grading_scale_bands',
  'notifications',
  'workflow_ui_approvals',
  'parent_consents',
];

const PARENTS = [
  'students',
  'staff',
  'institutions',
  'fee_structures',
  'parent_fee_invoices',
  'classes',
  'grades',
  'academic_periods',
  'subjects',
  'syllabus_units',
];

interface SisFixture {
  tenantId: string;
  institutionId: string;
  academicPeriodId: string;
  gradeId: string;
  classId: string;
  studentId: string;
  staffId: string;
  subjectId: string;
  feeStructureId: string;
  invoiceId: string;
}

async function seedTenant(pool: pg.Pool): Promise<SisFixture> {
  const tenantId = randomUUID();
  const suffix = tenantId.slice(0, 8);
  const fx: SisFixture = {
    tenantId,
    institutionId: randomUUID(),
    academicPeriodId: randomUUID(),
    gradeId: randomUUID(),
    classId: randomUUID(),
    studentId: randomUUID(),
    staffId: randomUUID(),
    subjectId: randomUUID(),
    feeStructureId: randomUUID(),
    invoiceId: randomUUID(),
  };
  await ensurePgTestTenant(pool, tenantId);
  await ensurePgTestStudent(pool, tenantId, fx.studentId);
  await ensurePgTestStaff(pool, tenantId, fx.staffId);
  const areaId = randomUUID();
  await withPgTenant(pool, tenantId, async (client) => {
    await client.query(
      `INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
       VALUES ($1, $2, 'Root', 'ROOT', 0, NULL, '/', 1, 2)`,
      [areaId, tenantId],
    );
    await client.query(
      `INSERT INTO institutions (id, tenant_id, name, code, area_id, type, sector, ownership, status)
       VALUES ($1, $2, 'Composite FK School', $3, $4, 'SCHOOL', 'PUBLIC', 'GOVERNMENT', 'active')`,
      [fx.institutionId, tenantId, `CFK-${suffix}`, areaId],
    );
    await client.query(
      `INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date, status)
       VALUES ($1, $2, 'AY 2026-27', $3, '2026-04-01', '2027-03-31', 'active')`,
      [fx.academicPeriodId, tenantId, `AY-${suffix}`],
    );
    await client.query(
      `INSERT INTO grades (id, tenant_id, name, code, "order") VALUES ($1, $2, 'Grade 6', $3, 6)`,
      [fx.gradeId, tenantId, `G6-${suffix}`],
    );
    await client.query(
      `INSERT INTO classes (id, tenant_id, institution_id, grade_id, academic_period_id, name, capacity)
       VALUES ($1, $2, $3, $4, $5, '6-A', 40)`,
      [fx.classId, tenantId, fx.institutionId, fx.gradeId, fx.academicPeriodId],
    );
    await client.query(
      `INSERT INTO subjects (id, tenant_id, name, code) VALUES ($1, $2, 'Mathematics', $3)`,
      [fx.subjectId, tenantId, `MATH-${suffix}`],
    );
    await client.query(
      `INSERT INTO fee_structures (id, tenant_id, category, code, name, amount_cents)
       VALUES ($1, $2, 'tuition', $3, 'Tuition', 1000)`,
      [fx.feeStructureId, tenantId, `FEE-${suffix}`],
    );
    await client.query(
      `INSERT INTO parent_fee_invoices (id, tenant_id, student_id, title, amount_cents)
       VALUES ($1, $2, $3, 'Term 1', 1000)`,
      [fx.invoiceId, tenantId, fx.studentId],
    );
  });
  return fx;
}

describe.skipIf(!DATABASE_URL)('tenant-composite FKs (live)', () => {
  let pool: pg.Pool;
  let a: SisFixture;
  let b: SisFixture;

  /** Run one statement as proctira_app bound to `tenantId`; always rolled back. */
  async function probe(tenantId: string, sql: string, params: unknown[]): Promise<unknown> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await bindTenantGuc(client, tenantId);
      try {
        await client.query(sql, params);
        return null;
      } catch (error) {
        return error;
      }
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  async function expectCrossTenantRejected(
    constraint: string,
    sql: string,
    crossTenantParams: unknown[],
    sameTenantParams: unknown[],
  ): Promise<void> {
    // Control: the same statement against the caller's own parent is accepted.
    expect(await probe(a.tenantId, sql, sameTenantParams)).toBeNull();
    // The defect: pointing at tenant B's parent must be refused by the composite twin.
    expect(await probe(a.tenantId, sql, crossTenantParams)).toMatchObject({
      code: '23503',
      constraint,
    });
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    a = await seedTenant(pool);
    b = await seedTenant(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('catalog: every id-only FK into the parent set has a validated *_tenant_fk twin', async () => {
    const { rows } = await pool.query<{ edge: string }>(
      `SELECT ch.relname || '.' || a.attname || ' -> ' || p.relname AS edge
         FROM pg_constraint c
         JOIN pg_class ch ON ch.oid = c.conrelid AND ch.relkind = 'r'
         JOIN pg_namespace n ON n.oid = ch.relnamespace AND n.nspname = 'public'
         JOIN pg_class p ON p.oid = c.confrelid
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
         JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
         JOIN pg_attribute ct ON ct.attrelid = c.conrelid AND ct.attname = 'tenant_id'
                              AND NOT ct.attisdropped AND ct.atttypid = 'uuid'::regtype
        WHERE c.contype = 'f'
          AND c.conparentid = 0
          AND array_length(c.conkey, 1) = 1
          AND p.relname = ANY ($1::text[])
          AND pa.attname = 'id'
          AND a.attname <> 'tenant_id'
          AND NOT (ch.relname = ANY ($2::text[]))
          AND c.confdeltype <> 'd'
          AND NOT EXISTS (
            SELECT 1
              FROM pg_constraint t
              JOIN pg_attribute k1 ON k1.attrelid = t.conrelid AND k1.attnum = t.conkey[1]
              JOIN pg_attribute k2 ON k2.attrelid = t.conrelid AND k2.attnum = t.conkey[2]
             WHERE t.contype = 'f'
               AND t.conrelid = c.conrelid
               AND t.confrelid = c.confrelid
               AND t.convalidated
               AND t.conname LIKE '%\\_tenant\\_fk'
               AND array_length(t.conkey, 1) = 2
               AND k1.attname = 'tenant_id'
               AND k2.attname = a.attname
          )
        ORDER BY 1`,
      [PARENTS, EXCLUDED_CHILDREN],
    );
    expect(rows.map((r) => r.edge)).toEqual([]);
  });

  describe('PRC-M195 (student PII / money edges)', () => {
    it('student_consents cannot reference another tenant’s student', async () => {
      const sql = `INSERT INTO student_consents (id, tenant_id, student_id, kind, granted, actor_id)
                   VALUES ($1, $2, $3, 'photo', true, 'live-test')`;
      await expectCrossTenantRejected(
        'student_consents_student_id_tenant_fk',
        sql,
        [randomUUID(), a.tenantId, b.studentId],
        [randomUUID(), a.tenantId, a.studentId],
      );
    });

    it('student_discipline_incidents cannot reference another tenant’s student', async () => {
      const sql = `INSERT INTO student_discipline_incidents (
                     id, tenant_id, student_id, incident_type, severity, description,
                     reporter_id, incident_date
                   ) VALUES ($1, $2, $3, 'conduct', 'low', 'live-test', 'live-test', CURRENT_DATE)`;
      await expectCrossTenantRejected(
        'student_discipline_incidents_student_id_tenant_fk',
        sql,
        [randomUUID(), a.tenantId, b.studentId],
        [randomUUID(), a.tenantId, a.studentId],
      );
    });

    it('parent_fee_payments cannot reference another tenant’s invoice', async () => {
      const sql = `INSERT INTO parent_fee_payments (id, invoice_id, tenant_id, payer_user_id, amount_cents)
                   VALUES ($1, $2, $3, 'live-test', 100)`;
      await expectCrossTenantRejected(
        'parent_fee_payments_invoice_id_tenant_fk',
        sql,
        [randomUUID(), b.invoiceId, a.tenantId],
        [randomUUID(), a.invoiceId, a.tenantId],
      );
    });
  });

  describe('PRC-M208 (staff / fee-structure edges)', () => {
    it('staff_contracts cannot reference another tenant’s staff member', async () => {
      const sql = `INSERT INTO staff_contracts (
                     id, tenant_id, staff_id, contract_type, start_date, salary_band, status
                   ) VALUES ($1, $2, $3, 'permanent', CURRENT_DATE, 'A', 'active')`;
      await expectCrossTenantRejected(
        'staff_contracts_staff_id_tenant_fk',
        sql,
        [randomUUID(), a.tenantId, b.staffId],
        [randomUUID(), a.tenantId, a.staffId],
      );
    });

    it('transport_fee_structures cannot reference another tenant’s fee structure', async () => {
      const sql = `INSERT INTO transport_fee_structures (id, tenant_id, name, amount_cents, fees_structure_id)
                   VALUES ($1, $2, 'Bus', 500, $3)`;
      await expectCrossTenantRejected(
        'transport_fee_structures_fees_structure_id_tenant_fk',
        sql,
        [randomUUID(), a.tenantId, b.feeStructureId],
        [randomUUID(), a.tenantId, a.feeStructureId],
      );
    });
  });

  describe('PRC-L095 (sibling / photo / document edges)', () => {
    it('student_siblings cannot link a sibling from another tenant', async () => {
      const otherA = randomUUID();
      await ensurePgTestStudent(pool, a.tenantId, otherA);
      const sql = `INSERT INTO student_siblings (id, tenant_id, student_id, sibling_id)
                   VALUES ($1, $2, $3, $4)`;
      await expectCrossTenantRejected(
        'student_siblings_sibling_id_tenant_fk',
        sql,
        [randomUUID(), a.tenantId, a.studentId, b.studentId],
        [randomUUID(), a.tenantId, a.studentId, otherA],
      );
    });

    it('student_photos and student_documents carry validated composite twins', async () => {
      const { rows } = await pool.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
          WHERE conname IN ('student_photos_student_id_tenant_fk',
                            'student_documents_student_id_tenant_fk')
            AND convalidated
          ORDER BY conname`,
      );
      expect(rows.map((r) => r.conname)).toEqual([
        'student_documents_student_id_tenant_fk',
        'student_photos_student_id_tenant_fk',
      ]);
    });
  });

  describe('PRC-M548 (enrollment placement edges)', () => {
    it('enrollments cannot place a student in another tenant’s class', async () => {
      const sql = `INSERT INTO enrollments (
                     id, tenant_id, student_id, institution_id, grade_id, class_id,
                     academic_period_id, status, enrolled_at
                   ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ENROLLED', '2026-04-01'::date)`;
      const base = (classId: string) => [
        randomUUID(),
        a.tenantId,
        a.studentId,
        a.institutionId,
        a.gradeId,
        classId,
        a.academicPeriodId,
      ];
      await expectCrossTenantRejected(
        'enrollments_class_id_tenant_fk',
        sql,
        base(b.classId),
        base(a.classId),
      );
    });
  });

  describe('PRC-L289 (curriculum edges)', () => {
    it('syllabus_units cannot reference another tenant’s subject (new edge)', async () => {
      const sql = `INSERT INTO syllabus_units (
                     id, tenant_id, subject_id, grade_id, academic_period_id, code, name
                   ) VALUES ($1, $2, $3, $4, $5, $6, 'Unit 1')`;
      await expectCrossTenantRejected(
        'syllabus_units_subject_id_tenant_fk',
        sql,
        [randomUUID(), a.tenantId, b.subjectId, a.gradeId, a.academicPeriodId, 'U-X'],
        [randomUUID(), a.tenantId, a.subjectId, a.gradeId, a.academicPeriodId, 'U-A'],
      );
    });

    it('syllabus_units rejects a subject id that exists nowhere (new edge)', async () => {
      const error = await probe(
        a.tenantId,
        `INSERT INTO syllabus_units (
           id, tenant_id, subject_id, grade_id, academic_period_id, code, name
         ) VALUES ($1, $2, $3, $4, $5, 'U-Z', 'Unit Z')`,
        [randomUUID(), a.tenantId, randomUUID(), a.gradeId, a.academicPeriodId],
      );
      expect(error).toMatchObject({
        code: '23503',
        constraint: 'syllabus_units_subject_id_tenant_fk',
      });
    });

    it('learning_outcomes cannot reference another tenant’s subject (new edge)', async () => {
      const sql = `INSERT INTO learning_outcomes (id, tenant_id, subject_id, code, statement)
                   VALUES ($1, $2, $3, 'LO-1', 'Statement')`;
      await expectCrossTenantRejected(
        'learning_outcomes_subject_id_tenant_fk',
        sql,
        [randomUUID(), a.tenantId, b.subjectId],
        [randomUUID(), a.tenantId, a.subjectId],
      );
    });
  });
});
