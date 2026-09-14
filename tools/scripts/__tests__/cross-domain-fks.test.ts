/**
 * W1-DATA-15 — static contract for cross-domain FK migrations (wave-1 + residual).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');
const ADD = join(ROOT, 'db/sql/071_cross_domain_fk_constraints.sql');
const VALIDATE = join(ROOT, 'db/sql/072_validate_cross_domain_fk_constraints.sql');
const ADD_CAMPUS = join(ROOT, 'db/sql/073_cross_domain_fk_campus_ops.sql');
const VALIDATE_CAMPUS = join(ROOT, 'db/sql/074_validate_cross_domain_fk_campus_ops.sql');
const AUDIT_FKS = join(ROOT, 'docs/audits/DATA_W1_DATA_15_FKS.md');
const AUDIT_DANGLES = join(ROOT, 'docs/audits/DATA_W1_DATA_15_DANGLES.md');

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
});
