/**
 * W1-DATA-15 — static contract for cross-domain FK migrations
 * (wave-1 + campus residual + staff/ops + Prisma NOT VALID-only).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');
const ADD = join(ROOT, 'db/sql/071_cross_domain_fk_constraints.sql');
const VALIDATE = join(ROOT, 'db/sql/072_validate_cross_domain_fk_constraints.sql');
const ADD_CAMPUS = join(ROOT, 'db/sql/073_cross_domain_fk_campus_ops.sql');
const VALIDATE_CAMPUS = join(ROOT, 'db/sql/074_validate_cross_domain_fk_campus_ops.sql');
const ADD_STAFF = join(ROOT, 'db/sql/085_cross_domain_fk_staff_ops.sql');
const VALIDATE_STAFF = join(ROOT, 'db/sql/086_validate_cross_domain_fk_staff_ops.sql');
const ADD_PRISMA = join(ROOT, 'db/sql/087_cross_domain_fk_prisma_not_valid.sql');
const AUDIT_FKS = join(ROOT, 'docs/audits/DATA_W1_DATA_15_FKS.md');
const AUDIT_DANGLES = join(ROOT, 'docs/audits/DATA_W1_DATA_15_DANGLES.md');
const AUDIT_COMPLETE = join(ROOT, 'docs/audits/DATA_W1_DATA_15_COMPLETE.md');

describe('W1-DATA-15 cross-domain FKs', () => {
  it('ships wave-1 NOT VALID + VALIDATE SQL and FKS audit', () => {
    expect(existsSync(ADD)).toBe(true);
    expect(existsSync(VALIDATE)).toBe(true);
    expect(existsSync(AUDIT_FKS)).toBe(true);

    const addSql = readFileSync(ADD, 'utf8');
    const valSql = readFileSync(VALIDATE, 'utf8');
    const audit = readFileSync(AUDIT_FKS, 'utf8');

    expect(addSql).toMatch(/NOT VALID/);
    expect(addSql).toMatch(/parent_fee_invoices_student_id_fkey/);
    expect(addSql).toMatch(/transfer_records_source_enrollment_id_fkey/);
    expect(addSql).toMatch(/fee_ledger_entries_invoice_id_fkey/);
    expect(addSql).toMatch(/admission_offers_grade_id_fkey/);
    expect(addSql).not.toMatch(/student_attendance_student_id_fkey/);
    expect(addSql).not.toMatch(/assessment_results_student_id_fkey/);

    expect(valSql).toMatch(/VALIDATE CONSTRAINT/);
    expect(valSql).toMatch(/parent_fee_invoices_student_id_fkey/);

    expect(audit).toMatch(/W1-DATA-15/);
    expect(audit).toMatch(/Residuals/);
  });

  it('ships residual campus/ops NOT VALID + VALIDATE SQL and DANGLES audit', () => {
    expect(existsSync(ADD_CAMPUS)).toBe(true);
    expect(existsSync(VALIDATE_CAMPUS)).toBe(true);
    expect(existsSync(AUDIT_DANGLES)).toBe(true);

    const addSql = readFileSync(ADD_CAMPUS, 'utf8');
    const valSql = readFileSync(VALIDATE_CAMPUS, 'utf8');
    const audit = readFileSync(AUDIT_DANGLES, 'utf8');

    expect(addSql).toMatch(/NOT VALID/);
    expect(addSql).toMatch(/hostel_assignments_student_id_fkey/);
    expect(addSql).toMatch(/library_loans_student_id_fkey/);
    expect(addSql).toMatch(/lms_submissions_student_id_fkey/);
    expect(addSql).toMatch(/transport_student_assignments_student_id_fkey/);
    expect(addSql).toMatch(/health_nurse_incidents_student_id_fkey/);
    expect(addSql).toMatch(/exam_seating_student_id_fkey/);
    expect(addSql).not.toMatch(/student_attendance_student_id_fkey/);
    expect(addSql).not.toMatch(/assessment_results_student_id_fkey/);

    expect(valSql).toMatch(/VALIDATE CONSTRAINT/);
    expect(valSql).toMatch(/hostel_assignments_student_id_fkey/);
    expect(valSql).toMatch(/library_loans_student_id_fkey/);
    expect(valSql).toMatch(/074_validate_cross_domain_fk_campus_ops/);

    expect(audit).toMatch(/W1-DATA-15/);
    expect(audit).toMatch(/073_cross_domain_fk_campus_ops/);
    expect(audit).toMatch(/Residuals/);
    expect(audit).toMatch(/dangling/);
  });

  it('ships staff/ops NOT VALID + VALIDATE and COMPLETE audit (076/077)', () => {
    expect(existsSync(ADD_STAFF)).toBe(true);
    expect(existsSync(VALIDATE_STAFF)).toBe(true);
    expect(existsSync(AUDIT_COMPLETE)).toBe(true);

    const addSql = readFileSync(ADD_STAFF, 'utf8');
    const valSql = readFileSync(VALIDATE_STAFF, 'utf8');
    const audit = readFileSync(AUDIT_COMPLETE, 'utf8');

    expect(addSql).toMatch(/NOT VALID/);
    expect(addSql).toMatch(/staff_contracts_staff_id_fkey/);
    expect(addSql).toMatch(/staff_leave_requests_staff_id_fkey/);
    expect(addSql).toMatch(/hr_appraisals_staff_id_fkey/);
    expect(addSql).toMatch(/exam_invigilators_staff_id_fkey/);
    expect(addSql).toMatch(/transport_fee_links_fees_invoice_id_fkey/);
    expect(addSql).not.toMatch(/student_attendance_student_id_fkey/);

    expect(valSql).toMatch(/VALIDATE CONSTRAINT/);
    expect(valSql).toMatch(/staff_contracts_staff_id_fkey/);
    expect(valSql).toMatch(/086_validate_cross_domain_fk_staff_ops/);

    expect(audit).toMatch(/W1-DATA-15/);
    expect(audit).toMatch(/085_cross_domain_fk_staff_ops/);
    expect(audit).toMatch(/087_cross_domain_fk_prisma_not_valid/);
    expect(audit).toMatch(/Residuals/);
  });

  it('ships Prisma FORCE-RLS NOT VALID-only safe pattern (078, no VALIDATE)', () => {
    expect(existsSync(ADD_PRISMA)).toBe(true);
    expect(
      existsSync(join(ROOT, 'db/sql/079_validate_cross_domain_fk_prisma.sql')),
    ).toBe(false);

    const addSql = readFileSync(ADD_PRISMA, 'utf8');
    expect(addSql).toMatch(/NOT VALID/);
    expect(addSql).toMatch(/student_attendance_student_id_fkey/);
    expect(addSql).toMatch(/assessment_results_student_id_fkey/);
    expect(addSql).toMatch(/examination_candidates_student_id_fkey/);
    expect(addSql).toMatch(/staff_attendance_staff_id_fkey/);
    expect(addSql).not.toMatch(/VALIDATE CONSTRAINT/);
    expect(addSql).toMatch(/Do NOT ship a VALIDATE companion/);
  });
});
